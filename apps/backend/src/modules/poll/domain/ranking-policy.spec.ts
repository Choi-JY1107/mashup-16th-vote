import { describe, expect, it } from 'vitest'
import { MeanPerVoterRankingPolicy, type RawScore } from './ranking-policy.js'
import { buildCandidates, buildCriteria } from './__fixtures__/build.js'

const policy = new MeanPerVoterRankingPolicy()
const criteria = buildCriteria()
const candidates = buildCandidates(3)
const candidateIds = candidates.map((c) => c.id)

const score = (candidateId: string, criterionKey: string, points: number): RawScore => ({
  candidateId,
  criterionId: `crit-${criterionKey}`,
  points,
})

describe('MeanPerVoterRankingPolicy', () => {
  it('평가자 수가 다르면 합계가 아니라 평균으로 순위를 낸다', () => {
    // 팀1: 2명이 각각 40점 → 합계 80, 평균 40
    // 팀2: 4명이 각각 30점 → 합계 120, 평균 30
    // 단순 합계라면 팀2가 이기지만, 평균이므로 팀1이 이겨야 한다.
    const scores: RawScore[] = [
      score('team-1', 'collaboration', 40),
      score('team-1', 'collaboration', 40),
      score('team-2', 'collaboration', 30),
      score('team-2', 'collaboration', 30),
      score('team-2', 'collaboration', 30),
      score('team-2', 'collaboration', 30),
    ]

    const ranked = policy.rank({
      criteria: [criteria[0]!],
      candidateIds: ['team-1', 'team-2'],
      scores,
      voterCountByCandidate: new Map([
        ['team-1', 2],
        ['team-2', 4],
      ]),
    })

    expect(ranked.map((r) => [r.candidateId, r.rank, r.normalizedScore])).toEqual([
      ['team-1', 1, 40],
      ['team-2', 2, 30],
    ])
  })

  it('팀원이 많아 평가자가 적은 팀이 불리해지지 않는다', () => {
    // 두 팀 모두 1인당 평균 25점을 받았지만 평가자 수가 다르다.
    const scores: RawScore[] = [
      ...Array.from({ length: 22 }, () => score('team-1', 'collaboration', 25)),
      ...Array.from({ length: 26 }, () => score('team-2', 'collaboration', 25)),
    ]

    const ranked = policy.rank({
      criteria: [criteria[0]!],
      candidateIds: ['team-1', 'team-2'],
      scores,
      voterCountByCandidate: new Map([
        ['team-1', 22],
        ['team-2', 26],
      ]),
    })

    // 동점이어야 한다. 합계로 냈다면 550 vs 650 으로 갈렸을 것이다.
    expect(ranked.every((r) => r.normalizedScore === 25)).toBe(true)
    expect(ranked.every((r) => r.rank === 1)).toBe(true)
  })

  it('항목 가중치를 반영한다', () => {
    const weighted = buildCriteria({ collaboration: 2, completeness: 1 })

    const ranked = policy.rank({
      criteria: [weighted[0]!, weighted[1]!],
      candidateIds: ['team-1', 'team-2'],
      scores: [
        // 팀1은 협업(가중치 2)에 강하다
        score('team-1', 'collaboration', 30),
        score('team-1', 'completeness', 10),
        // 팀2는 완성도(가중치 1)에 강하다
        score('team-2', 'collaboration', 10),
        score('team-2', 'completeness', 30),
      ],
      voterCountByCandidate: new Map([
        ['team-1', 1],
        ['team-2', 1],
      ]),
    })

    // 팀1: 30*2 + 10*1 = 70 / 팀2: 10*2 + 30*1 = 50
    expect(ranked[0]).toMatchObject({ candidateId: 'team-1', rank: 1, normalizedScore: 70 })
    expect(ranked[1]).toMatchObject({ candidateId: 'team-2', rank: 2, normalizedScore: 50 })
  })

  it('동점은 같은 순위를 주고 다음 순위를 건너뛴다 (1, 2, 2, 4)', () => {
    const ranked = policy.rank({
      criteria: [criteria[0]!],
      candidateIds: ['team-1', 'team-2', 'team-3', 'team-4'],
      scores: [
        score('team-1', 'collaboration', 40),
        score('team-2', 'collaboration', 30),
        score('team-3', 'collaboration', 30),
        score('team-4', 'collaboration', 10),
      ],
      voterCountByCandidate: new Map([
        ['team-1', 1],
        ['team-2', 1],
        ['team-3', 1],
        ['team-4', 1],
      ]),
    })

    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4])
  })

  it('전원 동점이면 최대 순위가 1이다', () => {
    const ranked = policy.rank({
      criteria: [criteria[0]!],
      candidateIds,
      scores: candidateIds.map((id) => score(id, 'collaboration', 20)),
      voterCountByCandidate: new Map(candidateIds.map((id) => [id, 1])),
    })

    expect(ranked.every((r) => r.rank === 1)).toBe(true)
    // 이 값이 공개 시작 지점이 된다. 후보 수(3)를 쓰면 빈 클릭이 2번 발생한다.
    expect(Math.max(...ranked.map((r) => r.rank))).toBe(1)
  })

  it('아무도 평가하지 않은 후보는 0으로 나누지 않고 0점 처리한다', () => {
    const ranked = policy.rank({
      criteria: [criteria[0]!],
      candidateIds: ['team-1', 'team-2'],
      scores: [score('team-1', 'collaboration', 50)],
      voterCountByCandidate: new Map([['team-1', 1]]),
    })

    const orphan = ranked.find((r) => r.candidateId === 'team-2')
    expect(orphan?.normalizedScore).toBe(0)
    expect(orphan?.voterCount).toBe(0)
    expect(Number.isNaN(orphan?.normalizedScore)).toBe(false)
  })

  it('항목별 평균을 perCriterion 에 담는다', () => {
    const ranked = policy.rank({
      criteria,
      candidateIds: ['team-1'],
      scores: [
        score('team-1', 'collaboration', 30),
        score('team-1', 'collaboration', 20),
        score('team-1', 'completeness', 10),
        score('team-1', 'completeness', 10),
      ],
      voterCountByCandidate: new Map([['team-1', 2]]),
    })

    expect(ranked[0]?.perCriterion).toEqual({
      collaboration: 25,
      completeness: 10,
      ideation: 0,
      presentation: 0,
    })
  })

  it('동점 순서가 실행마다 흔들리지 않는다', () => {
    const input = {
      criteria: [criteria[0]!],
      candidateIds: ['team-3', 'team-1', 'team-2'],
      scores: ['team-1', 'team-2', 'team-3'].map((id) => score(id, 'collaboration', 20)),
      voterCountByCandidate: new Map([
        ['team-1', 1],
        ['team-2', 1],
        ['team-3', 1],
      ]),
    }

    const a = policy.rank(input).map((r) => r.candidateId)
    const b = policy.rank(input).map((r) => r.candidateId)

    expect(a).toEqual(b)
    expect(a).toEqual(['team-1', 'team-2', 'team-3'])
  })
})
