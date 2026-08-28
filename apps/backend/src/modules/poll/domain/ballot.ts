import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import type { AccessCode } from './access-code.js'
import type { Candidate } from './candidate.js'
import type { Criterion } from './criterion.js'
import type { Poll } from './poll.js'

export interface ScoreEntry {
  readonly candidateId: string
  readonly points: number
}

export interface CriterionAllocation {
  readonly criterionId: string
  readonly scores: readonly ScoreEntry[]
}

export interface BallotScore {
  readonly criterionId: string
  readonly candidateId: string
  readonly points: number
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false
  const s = new Set(b)
  return a.every((x) => s.has(x))
}

const diff = (submitted: readonly string[], expected: readonly string[]) => {
  const e = new Set(expected)
  const s = new Set(submitted)
  return {
    missing: expected.filter((x) => !s.has(x)),
    unexpected: submitted.filter((x) => !e.has(x)),
  }
}

/**
 * 한 사람이 제출한 한 장의 표.
 *
 * 이 클래스의 create() 가 이 프로젝트의 핵심이다.
 * 여기를 통과하지 못한 표는 어떤 경로로도 저장되지 않는다.
 */
export class Ballot {
  private constructor(
    readonly pollId: string,
    readonly accessCodeId: string,
    readonly scores: readonly BallotScore[],
    readonly submittedAt: Date,
  ) {}

  static create(input: {
    poll: Poll
    accessCode: AccessCode
    criteria: readonly Criterion[]
    candidates: readonly Candidate[]
    allocations: readonly CriterionAllocation[]
    now: Date
  }): Result<Ballot> {
    const { poll, accessCode, criteria, candidates, allocations, now } = input

    // 1. 투표 기간
    if (!poll.acceptsBallots()) return Err(DomainErrors.pollNotOpen())

    // 2. 통행코드 미사용
    if (accessCode.isUsed()) return Err(DomainErrors.accessCodeAlreadyUsed())

    // 3. 항목 집합이 정확히 일치 (누락도 추가도 불가)
    const expectedCriterionIds = criteria.map((c) => c.id)
    const submittedCriterionIds = allocations.map((a) => a.criterionId)
    if (new Set(submittedCriterionIds).size !== submittedCriterionIds.length) {
      return Err(DomainErrors.criteriaMismatch({ reason: 'duplicated' }))
    }
    if (!sameSet(submittedCriterionIds, expectedCriterionIds)) {
      return Err(
        DomainErrors.criteriaMismatch(diff(submittedCriterionIds, expectedCriterionIds)),
      )
    }

    // 4. 평가 대상 팀 집합이 정확히 일치 (자기 팀은 규칙에 따라 제외됨)
    const expectedCandidateIds = accessCode
      .evaluableCandidates(candidates, poll.rules.excludeOwnTeam)
      .map((c) => c.id)

    const scores: BallotScore[] = []

    for (const allocation of allocations) {
      const submittedCandidateIds = allocation.scores.map((s) => s.candidateId)

      if (new Set(submittedCandidateIds).size !== submittedCandidateIds.length) {
        return Err(
          DomainErrors.candidatesMismatch({
            criterionId: allocation.criterionId,
            reason: 'duplicated',
          }),
        )
      }
      if (!sameSet(submittedCandidateIds, expectedCandidateIds)) {
        return Err(
          DomainErrors.candidatesMismatch({
            criterionId: allocation.criterionId,
            ...diff(submittedCandidateIds, expectedCandidateIds),
          }),
        )
      }

      // 5. 점수는 0 이상의 정수
      let total = 0
      for (const s of allocation.scores) {
        if (!Number.isInteger(s.points) || s.points < 0) {
          return Err(
            DomainErrors.invalidPoints({
              criterionId: allocation.criterionId,
              candidateId: s.candidateId,
              points: s.points,
            }),
          )
        }
        total += s.points
        scores.push({
          criterionId: allocation.criterionId,
          candidateId: s.candidateId,
          points: s.points,
        })
      }

      // 6. 항목별 합계는 상한 이하
      if (total > poll.rules.pointsPerCriterion) {
        return Err(
          DomainErrors.budgetExceeded({
            criterionId: allocation.criterionId,
            total,
            limit: poll.rules.pointsPerCriterion,
          }),
        )
      }
    }

    return Ok(new Ballot(poll.id, accessCode.id, scores, now))
  }

  /** 항목별 배분 합계. 검증용 파생 값. */
  totalByCriterion(): Map<string, number> {
    const m = new Map<string, number>()
    for (const s of this.scores) {
      m.set(s.criterionId, (m.get(s.criterionId) ?? 0) + s.points)
    }
    return m
  }
}
