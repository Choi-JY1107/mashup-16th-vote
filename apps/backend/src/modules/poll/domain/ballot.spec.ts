import { describe, expect, it } from 'vitest'
import { Ballot } from './ballot.js'
import {
  buildAccessCode,
  buildAllocations,
  buildCandidates,
  buildCriteria,
  buildPoll,
} from './__fixtures__/build.js'

const criteria = buildCriteria()
const candidates = buildCandidates(6)
const now = new Date('2026-09-01T12:00:00.000Z')

/** 팀1 소속 투표자가 평가하는 대상 = 팀2..팀6 */
const evaluableIds = ['team-2', 'team-3', 'team-4', 'team-5', 'team-6']

const create = (input: {
  allocations: ReturnType<typeof buildAllocations>
  poll?: ReturnType<typeof buildPoll>
  accessCode?: ReturnType<typeof buildAccessCode>
}) =>
  Ballot.create({
    poll: input.poll ?? buildPoll(),
    accessCode: input.accessCode ?? buildAccessCode(),
    criteria,
    candidates,
    allocations: input.allocations,
    now,
  })

const errorOf = (r: ReturnType<typeof create>) => (r.ok ? null : r.error.code)

describe('Ballot.create', () => {
  describe('통과하는 표', () => {
    it('항목별 합계가 정확히 100이면 통과한다', () => {
      const result = create({ allocations: buildAllocations(evaluableIds) })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      // 4항목 × 5팀 = 20개 점수
      expect(result.value.scores).toHaveLength(20)
      expect([...result.value.totalByCriterion().values()]).toEqual([100, 100, 100, 100])
    })

    it('항목별 합계가 100 미만이어도 통과한다 (상한 규칙이므로)', () => {
      const result = create({
        allocations: buildAllocations(evaluableIds, [10, 10, 10, 10, 10]),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect([...result.value.totalByCriterion().values()]).toEqual([50, 50, 50, 50])
    })

    it('전부 0점이어도 통과한다', () => {
      const result = create({ allocations: buildAllocations(evaluableIds, [0, 0, 0, 0, 0]) })
      expect(result.ok).toBe(true)
    })

    it('한 팀에 100점을 몰아줘도 통과한다 (개별 상한 규칙 없음)', () => {
      const result = create({
        allocations: buildAllocations(evaluableIds, [100, 0, 0, 0, 0]),
      })
      expect(result.ok).toBe(true)
    })

    it('소속 팀이 없는 투표자(회장단)는 6팀 전부를 평가한다', () => {
      const staffCode = buildAccessCode({ teamId: null })
      const allIds = candidates.map((c) => c.id)

      const result = create({
        accessCode: staffCode,
        allocations: buildAllocations(allIds),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.scores).toHaveLength(24)
      // 100 은 6으로 나눠지지 않으므로 17,17,17,17,16,16 으로 채워진다
      expect([...result.value.totalByCriterion().values()]).toEqual([100, 100, 100, 100])
    })
  })

  describe('배분 상한', () => {
    it('합계가 101이면 BUDGET_EXCEEDED', () => {
      const result = create({
        allocations: buildAllocations(evaluableIds, [21, 20, 20, 20, 20]),
      })

      expect(errorOf(result)).toBe('BUDGET_EXCEEDED')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ total: 101, limit: 100 })
    })

    it('한 항목만 초과해도 전체가 거부된다', () => {
      const allocations = buildAllocations(evaluableIds)
      // 세 번째 항목만 초과시킨다
      allocations[2] = {
        criterionId: allocations[2]!.criterionId,
        scores: evaluableIds.map((candidateId) => ({ candidateId, points: 30 })),
      }

      const result = create({ allocations })
      expect(errorOf(result)).toBe('BUDGET_EXCEEDED')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ criterionId: 'crit-ideation', total: 150 })
    })
  })

  describe('평가 항목 집합', () => {
    it('항목이 누락되면 CRITERIA_MISMATCH', () => {
      const allocations = buildAllocations(evaluableIds).slice(0, 3)
      const result = create({ allocations })

      expect(errorOf(result)).toBe('CRITERIA_MISMATCH')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ missing: ['crit-presentation'] })
    })

    it('없는 항목이 추가되면 CRITERIA_MISMATCH', () => {
      const allocations = [
        ...buildAllocations(evaluableIds),
        {
          criterionId: 'crit-injected',
          scores: evaluableIds.map((candidateId) => ({ candidateId, points: 20 })),
        },
      ]
      const result = create({ allocations })

      expect(errorOf(result)).toBe('CRITERIA_MISMATCH')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ unexpected: ['crit-injected'] })
    })

    it('같은 항목이 두 번 오면 CRITERIA_MISMATCH', () => {
      const allocations = buildAllocations(evaluableIds)
      const result = create({ allocations: [...allocations, allocations[0]!] })

      expect(errorOf(result)).toBe('CRITERIA_MISMATCH')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ reason: 'duplicated' })
    })
  })

  describe('평가 대상 팀 집합', () => {
    it('자기 팀을 포함시키면 CANDIDATES_MISMATCH', () => {
      const withOwnTeam = ['team-1', ...evaluableIds]
      const result = create({ allocations: buildAllocations(withOwnTeam) })

      expect(errorOf(result)).toBe('CANDIDATES_MISMATCH')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ unexpected: ['team-1'] })
    })

    it('팀이 누락되면 CANDIDATES_MISMATCH', () => {
      const result = create({ allocations: buildAllocations(evaluableIds.slice(0, 4)) })

      expect(errorOf(result)).toBe('CANDIDATES_MISMATCH')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ missing: ['team-6'] })
    })

    it('같은 팀이 두 번 오면 CANDIDATES_MISMATCH', () => {
      // 합계는 100 이지만 팀2가 두 번 등장한다
      const result = create({
        allocations: buildAllocations(
          ['team-2', 'team-2', 'team-3', 'team-4', 'team-5'],
          [20, 20, 20, 20, 20],
        ),
      })

      expect(errorOf(result)).toBe('CANDIDATES_MISMATCH')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ reason: 'duplicated' })
    })

    it('excludeOwnTeam 이 꺼져 있으면 자기 팀도 평가 대상이다', () => {
      const poll = buildPoll({ excludeOwnTeam: false })
      const allIds = candidates.map((c) => c.id)

      const result = create({ poll, allocations: buildAllocations(allIds) })
      expect(result.ok).toBe(true)
    })
  })

  describe('점수 값', () => {
    it('음수는 INVALID_POINTS', () => {
      const result = create({
        allocations: buildAllocations(evaluableIds, [-1, 25, 25, 25, 26]),
      })

      expect(errorOf(result)).toBe('INVALID_POINTS')
      if (result.ok) return
      expect(result.error.details).toMatchObject({ points: -1 })
    })

    it('소수점은 INVALID_POINTS', () => {
      const result = create({
        allocations: buildAllocations(evaluableIds, [20.5, 19.5, 20, 20, 20]),
      })
      expect(errorOf(result)).toBe('INVALID_POINTS')
    })

    it('NaN 은 INVALID_POINTS', () => {
      const result = create({
        allocations: buildAllocations(evaluableIds, [Number.NaN, 20, 20, 20, 20]),
      })
      expect(errorOf(result)).toBe('INVALID_POINTS')
    })
  })

  describe('투표 가능 상태', () => {
    it.each(['DRAFT', 'CLOSED', 'REVEALING', 'FINISHED'] as const)(
      '%s 상태에서는 POLL_NOT_OPEN',
      (status) => {
        const result = create({
          poll: buildPoll({ status }),
          allocations: buildAllocations(evaluableIds),
        })
        expect(errorOf(result)).toBe('POLL_NOT_OPEN')
      },
    )

    it('이미 사용된 통행코드는 ACCESS_CODE_ALREADY_USED', () => {
      const result = create({
        accessCode: buildAccessCode({ usedAt: new Date('2026-09-01T11:00:00.000Z') }),
        allocations: buildAllocations(evaluableIds),
      })
      expect(errorOf(result)).toBe('ACCESS_CODE_ALREADY_USED')
    })

    it('상태 검사가 형식 검사보다 먼저 실행된다', () => {
      // 마감된 투표에 잘못된 표를 던지면 형식 오류가 아니라 마감 오류가 나와야 한다
      const result = create({
        poll: buildPoll({ status: 'CLOSED' }),
        allocations: buildAllocations(['team-2'], [999]),
      })
      expect(errorOf(result)).toBe('POLL_NOT_OPEN')
    })
  })
})
