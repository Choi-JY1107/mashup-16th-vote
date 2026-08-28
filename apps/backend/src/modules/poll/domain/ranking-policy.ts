import type { Criterion } from './criterion.js'

export interface RawScore {
  readonly candidateId: string
  readonly criterionId: string
  readonly points: number
}

export interface RankedCandidate {
  readonly candidateId: string
  readonly rank: number
  readonly normalizedScore: number
  /** criterion.key 별 평가자 1인당 평균 점수 */
  readonly perCriterion: Record<string, number>
  readonly voterCount: number
}

export interface RankingInput {
  readonly criteria: readonly Criterion[]
  readonly candidateIds: readonly string[]
  readonly scores: readonly RawScore[]
  /** 후보별로 그 후보를 평가한 표 수. 자기 팀 제외 때문에 후보마다 다르다. */
  readonly voterCountByCandidate: ReadonlyMap<string, number>
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4

/**
 * 평가자 1인당 평균으로 정규화한다.
 *
 * 자기 팀 제외 규칙 때문에 팀원이 많은 팀은 자기를 평가해준 사람이 더 적다.
 * 단순 합계로 순위를 내면 사람 많은 팀이 구조적으로 불리해지므로 평균을 쓴다.
 *
 * 동점은 같은 순위를 주고 다음 순위를 건너뛴다 (1, 2, 2, 4).
 */
export class MeanPerVoterRankingPolicy {
  rank(input: RankingInput): RankedCandidate[] {
    const { criteria, candidateIds, scores, voterCountByCandidate } = input

    const key = (candidateId: string, criterionId: string) => candidateId + '|' + criterionId

    const sums = new Map<string, number>()
    for (const s of scores) {
      const k = key(s.candidateId, s.criterionId)
      sums.set(k, (sums.get(k) ?? 0) + s.points)
    }

    const scored = candidateIds.map((candidateId) => {
      const voterCount = voterCountByCandidate.get(candidateId) ?? 0
      const perCriterion: Record<string, number> = {}
      let normalizedScore = 0

      for (const criterion of criteria) {
        const sum = sums.get(key(candidateId, criterion.id)) ?? 0
        // 아무도 평가하지 않은 후보는 0점. 0으로 나누지 않는다.
        const mean = voterCount === 0 ? 0 : sum / voterCount
        perCriterion[criterion.key] = round4(mean)
        normalizedScore += mean * criterion.weight
      }

      return {
        candidateId,
        normalizedScore: round4(normalizedScore),
        perCriterion,
        voterCount,
      }
    })

    // 점수 내림차순. 동점은 candidateId 로 안정 정렬해서 결과가 재현 가능하게 한다.
    scored.sort(
      (a, b) =>
        b.normalizedScore - a.normalizedScore ||
        a.candidateId.localeCompare(b.candidateId),
    )

    const ranked: RankedCandidate[] = []
    let currentRank = 0
    let previousScore: number | null = null

    scored.forEach((s, index) => {
      if (previousScore === null || s.normalizedScore !== previousScore) {
        currentRank = index + 1
        previousScore = s.normalizedScore
      }
      ranked.push({ ...s, rank: currentRank })
    })

    return ranked
  }
}
