import type { PollStatus } from '@vote/contract'
import { AccessCode } from '../access-code.js'
import { Candidate } from '../candidate.js'
import { Criterion } from '../criterion.js'
import { Poll } from '../poll.js'

export const CRITERION_KEYS = [
  'collaboration',
  'completeness',
  'ideation',
  'presentation',
] as const

export const buildCriteria = (weights?: Partial<Record<string, number>>): Criterion[] =>
  CRITERION_KEYS.map((key, i) =>
    Criterion.rehydrate({
      id: `crit-${key}`,
      key,
      name: key,
      description: '',
      weight: weights?.[key] ?? 1,
      displayOrder: i + 1,
    }),
  )

/** 기본 6팀. 실제 16기 규모와 같게 둔다. */
export const buildCandidates = (count = 6): Candidate[] =>
  Array.from({ length: count }, (_, i) =>
    Candidate.rehydrate({
      id: `team-${i + 1}`,
      slug: `team-${i + 1}`,
      name: `팀${i + 1}`,
      description: '',
      thumbnailUrl: null,
      displayOrder: i + 1,
    }),
  )

export const buildPoll = (
  overrides: { status?: PollStatus; pointsPerCriterion?: number; excludeOwnTeam?: boolean } = {},
): Poll =>
  Poll.rehydrate({
    id: 'poll-1',
    title: 'Mash-Up 16기 프로젝트 투표',
    status: overrides.status ?? 'OPEN',
    rules: {
      pointsPerCriterion: overrides.pointsPerCriterion ?? 100,
      excludeOwnTeam: overrides.excludeOwnTeam ?? true,
    },
  })

export const buildAccessCode = (
  overrides: { teamId?: string | null; usedAt?: Date | null } = {},
): AccessCode =>
  AccessCode.rehydrate({
    id: 'code-1',
    pollId: 'poll-1',
    teamId: overrides.teamId === undefined ? 'team-1' : overrides.teamId,
    label: 'MU16-T1-01',
    usedAt: overrides.usedAt ?? null,
  })

/**
 * 주어진 팀들에 점수를 나눠 담은 배분표를 만든다.
 * points 를 생략하면 항목별 합계가 정확히 100 이 되도록 채운다.
 */
export const buildAllocations = (
  candidateIds: readonly string[],
  pointsByCandidate?: readonly number[],
) =>
  buildCriteria().map((c) => ({
    criterionId: c.id,
    scores: candidateIds.map((candidateId, i) => ({
      candidateId,
      points:
        pointsByCandidate?.[i] ??
        // 5팀이면 20,20,20,20,20 / 6팀이면 17,17,17,17,16,16
        Math.floor(100 / candidateIds.length) +
          (i < 100 % candidateIds.length ? 1 : 0),
    })),
  }))
