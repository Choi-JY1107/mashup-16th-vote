import { z } from 'zod'

/**
 * FE/BE 공유 계약. 여기가 유일한 진실 공급원이고, 양쪽 모두 이 스키마로 파싱한다.
 */

export const POLL_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'REVEALING', 'FINISHED'] as const
export const pollStatusSchema = z.enum(POLL_STATUSES)
export type PollStatus = z.infer<typeof pollStatusSchema>

const uuid = z.string().uuid()

/**
 * 투표 id. uuid 가 아니라 짧은 슬러그다.
 *
 * URL 과 PUBLIC_POLL_ID 에 그대로 노출되는 값이고 비밀이 아니다. 판이 하나뿐인
 * 행사용이라 36자 uuid 를 손으로 옮겨적을 이유가 없다.
 * 다른 id(후보·항목·표)는 그대로 uuid 다 — 그쪽은 사람이 안 만진다.
 *
 * DB 쪽에도 같은 형식 검사가 걸려 있다 (polls.id 의 check 제약).
 */
export const pollIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,31}$/, '소문자·숫자·하이픈 2~32자여야 합니다')
export type PollId = z.infer<typeof pollIdSchema>

// ── 투표 규칙 ────────────────────────────────────────────────
export const pollRulesSchema = z.object({
  /** 한 항목에서 배분할 수 있는 총점 상한 (합계는 이 값 이하) */
  pointsPerCriterion: z.number().int().positive(),
  /** 자기 팀 평가 제외 여부 */
  excludeOwnTeam: z.boolean(),
})
export type PollRules = z.infer<typeof pollRulesSchema>

/** 앱 / 웹. 시상식 표에서 색으로만 구분하고 글자로는 쓰지 않는다. */
export const PLATFORMS = ['APP', 'WEB'] as const
export const platformSchema = z.enum(PLATFORMS)
export type Platform = z.infer<typeof platformSchema>

export const criterionSchema = z.object({
  id: uuid,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  weight: z.number().positive(),
  displayOrder: z.number().int(),
})
export type Criterion = z.infer<typeof criterionSchema>

export const candidateSchema = z.object({
  id: uuid,
  slug: z.string().min(1),
  /**
   * 팀명.
   *
   * **...** 로 감싼 구간은 굵게 렌더링한다 (별표는 화면에 나오지 않는다).
   * 서버는 이 문자열을 그대로 보관하고, 표시 규칙은 웹의 team-name.ts 한 곳에 있다.
   */
  name: z.string().min(1),
  description: z.string(),
  thumbnailUrl: z.string().url().nullable(),
  platform: platformSchema.nullable(),
  displayOrder: z.number().int(),
})
export type Candidate = z.infer<typeof candidateSchema>

// ── 통행코드 검증 ────────────────────────────────────────────
/**
 * MU16 + Crockford Base32 (0/O, 1/I/L 제외) 6자.
 *
 * 발급은 서버가 하지 않는다 — 로컬에서 만들어 DB 에 직접 넣는다.
 * 이 스키마는 검증에만 쓰인다. 형식을 바꾸면 이미 배포된 코드가 전부 막힌다.
 */
export const accessCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[^0-9A-Z]/g, ''))
  .pipe(z.string().regex(/^MU16[0-9A-HJKMNP-TV-Z]{6}$/, '통행코드 형식이 올바르지 않습니다'))

export const verifyAccessCodeRequestSchema = z.object({ code: accessCodeSchema })
export type VerifyAccessCodeRequest = z.infer<typeof verifyAccessCodeRequestSchema>

export const ballotFormSchema = z.object({
  /** 투표 제출에 사용할 단기 토큰 */
  ballotToken: z.string().min(1),
  poll: z.object({
    // 투표 id 는 uuid 가 아니라 슬러그다. revealStateSchema 와 같은 규칙을 쓴다.
    id: pollIdSchema,
    title: z.string(),
    status: pollStatusSchema,
    rules: pollRulesSchema,
  }),
  criteria: z.array(criterionSchema).min(1),
  /** 자기 팀이 이미 제외된 평가 대상 목록 */
  candidates: z.array(candidateSchema).min(1),
  /** 소속 팀 (없으면 null) — UI 안내용 */
  ownTeamId: uuid.nullable(),
})
export type BallotForm = z.infer<typeof ballotFormSchema>

// ── 투표 제출 ────────────────────────────────────────────────
export const scoreEntrySchema = z.object({
  candidateId: uuid,
  points: z.number().int().min(0),
})

export const criterionAllocationSchema = z.object({
  criterionId: uuid,
  scores: z.array(scoreEntrySchema).min(1),
})

export const castBallotRequestSchema = z.object({
  allocations: z.array(criterionAllocationSchema).min(1),
})
export type CastBallotRequest = z.infer<typeof castBallotRequestSchema>

export const castBallotResponseSchema = z.object({
  ballotId: uuid,
  submittedAt: z.string().datetime(),
})
export type CastBallotResponse = z.infer<typeof castBallotResponseSchema>

// ── 결과 공개 ────────────────────────────────────────────────
// 프로그래밍 대회 리졸버 방식. 클릭 한 번은 두 종류 중 하나다.
//
//   OPEN    화면 맨 아래 팀의 다음 칸을 열어 점수를 보여준다. 행은 아직 안 움직인다.
//   SETTLE  올라간 총점을 반영해 순위를 다시 매긴다. 이때 행이 점프한다.
//
// 커서는 진행된 단계 수(정수 하나)다. 대본 계산이 결정적이므로 커서만으로 화면을
// 복원할 수 있다. 순위를 커서로 쓰면 동점(1,2,2,4)으로 순위에 구멍이 생겨 존재하지
// 않는 순위에 커서가 닿는 빈 클릭이 발생하지만, 단계 인덱스에는 그 문제가 없다.

/** 표의 열. 한 팀 안에서 칸은 이 순서로 공개된다. */
export const revealCriterionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  weight: z.number().positive(),
})
export type RevealCriterion = z.infer<typeof revealCriterionSchema>

/**
 * 표의 행.
 *
 * 팀 이름은 공개 시작 전부터 노출된다. 후보 6팀이 누구인지는 이미 알려진 정보이고,
 * 행 순서가 순위와 무관한 중립 순서(displayOrder)이므로 순위는 유추할 수 없다.
 */
export const revealTeamSchema = z.object({
  candidateId: uuid,
  /** **...** 구간은 굵게 렌더링한다. */
  candidateName: z.string(),
  candidateSlug: z.string(),
  platform: platformSchema.nullable(),
  displayOrder: z.number().int(),
})
export type RevealTeam = z.infer<typeof revealTeamSchema>

/** 공개된 칸 하나. score 는 평가자 1인당 평균이다. */
export const revealCellSchema = z.object({
  candidateId: uuid,
  criterionKey: z.string().min(1),
  score: z.number(),
})
export type RevealCell = z.infer<typeof revealCellSchema>

/** 항목 전부가 공개돼 순위가 확정된 팀. */
export const revealEntrySchema = z.object({
  rank: z.number().int().positive(),
  candidateId: uuid,
  candidateName: z.string(),
  candidateSlug: z.string(),
  score: z.number(),
  perCriterion: z.record(z.string(), z.number()),
})
export type RevealEntry = z.infer<typeof revealEntrySchema>

/** 다음에 열릴 칸. 사회자·관객 모두 여기를 주목한다. */
export const revealCursorSchema = z.object({
  candidateId: uuid,
  criterionKey: z.string().min(1),
})
export type RevealCursor = z.infer<typeof revealCursorSchema>

/**
 * 다음 클릭이 할 일. NONE 이면 전부 끝났다.
 *
 *   OPEN    맨 아래 팀의 다음 칸을 연다 (행은 안 움직인다)
 *   SETTLE  올라간 총점을 반영해 행 순서를 다시 매긴다
 *   RANK    맨 아래 팀의 등수를 박는다
 */
export const REVEAL_ACTIONS = ['OPEN', 'SETTLE', 'RANK', 'NONE'] as const
export const revealActionSchema = z.enum(REVEAL_ACTIONS)
export type RevealAction = z.infer<typeof revealActionSchema>

export const revealStateSchema = z.object({
  pollId: pollIdSchema,
  totalRanks: z.number().int().min(0),
  /** 열어야 할 칸 총 개수 = 팀 수 × 항목 수 */
  totalCells: z.number().int().min(0),
  /** 지금까지 열린 칸 개수 */
  revealedCells: z.number().int().min(0),
  /** 전체 클릭 수 (칸 공개 + 순서 갱신 + 등수 공개). 순서가 바뀌는 횟수에 따라 달라진다. */
  totalSteps: z.number().int().min(0),
  /** 지금까지 진행된 클릭 수. 이 값이 곧 공개 커서다. */
  revealedSteps: z.number().int().min(0),
  nextAction: revealActionSchema,
  criteria: z.array(revealCriterionSchema),
  teams: z.array(revealTeamSchema),
  /**
   * 화면 행 순서 (위 → 아래). candidateId 목록.
   *
   * 정렬을 서버가 정한다. 클라이언트가 따로 정렬하면 "다음에 열릴 칸은 맨 아래 팀의 칸"
   * 이라는 규칙이 서버와 어긋날 수 있고, SETTLE 전의 대기 상태도 표현할 수 없다.
   */
  rowOrder: z.array(uuid),
  /** 열린 칸만 담긴다. 열린 순서 그대로. */
  cells: z.array(revealCellSchema),
  /** 등수가 박힌 팀만 담긴다. 확정 순서(최하위 → 상위) 그대로다. */
  entries: z.array(revealEntrySchema),
  /** nextAction === 'OPEN' 일 때만 채워진다. */
  cursor: revealCursorSchema.nullable(),
  updatedAt: z.string().datetime(),
})
export type RevealState = z.infer<typeof revealStateSchema>

// ── 에러 ─────────────────────────────────────────────────────
export const API_ERROR_CODES = [
  'POLL_NOT_OPEN',
  'POLL_NOT_REVEALING',
  'INVALID_ACCESS_CODE',
  'ACCESS_CODE_ALREADY_USED',
  'CRITERIA_MISMATCH',
  'CANDIDATES_MISMATCH',
  'BUDGET_EXCEEDED',
  'INVALID_POINTS',
  'ALREADY_VOTED',
  'REVEAL_EXHAUSTED',
  'RESULTS_NOT_FROZEN',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'TOO_MANY_ATTEMPTS',
] as const
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES)
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
})
export type ApiError = z.infer<typeof apiErrorSchema>
