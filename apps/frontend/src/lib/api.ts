import { PUBLIC_API_BASE_URL } from '$env/static/public'
import {
  ballotFormSchema,
  castBallotResponseSchema,
  revealStateSchema,
  type ApiError,
  type ApiErrorCode,
  type BallotForm,
  type CastBallotRequest,
  type CastBallotResponse,
  type RevealState,
} from '@vote/contract'

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiFailure'
  }
}

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  INVALID_ACCESS_CODE: '통행코드를 다시 확인해주세요.',
  ACCESS_CODE_ALREADY_USED: '이미 사용된 통행코드입니다.',
  ALREADY_VOTED: '이미 투표를 완료했습니다.',
  POLL_NOT_OPEN: '지금은 투표 기간이 아닙니다.',
  BUDGET_EXCEEDED: '항목별 합계가 상한을 넘었습니다.',
  TOO_MANY_ATTEMPTS: '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (raw: unknown) => T,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${PUBLIC_API_BASE_URL}/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    })
  } catch (cause) {
    throw new ApiFailure('NETWORK', '서버에 연결할 수 없습니다.', cause)
  }

  const raw: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const err = raw as Partial<ApiError> | null
    const code = (err?.code ?? 'NOT_FOUND') as ApiErrorCode
    throw new ApiFailure(code, MESSAGES[code] ?? err?.message ?? '요청에 실패했습니다.', err?.details)
  }

  return parse(raw)
}

export const verifyAccessCode = (pollId: string, code: string): Promise<BallotForm> =>
  request(
    `/polls/${pollId}/access-codes/verify`,
    { method: 'POST', body: JSON.stringify({ code }) },
    (raw) => ballotFormSchema.parse(raw),
  )

/**
 * 표 제출.
 *
 * 2xx 를 받았다면 서버는 이미 커밋했다. 이 시점에 응답 본문 형식이 계약과
 * 어긋난다고 해서 "실패"로 표시하면, 표는 저장됐는데 사용자는 실패로 알고
 * 다시 누르게 된다. 재시도는 ALREADY_VOTED 로 막히므로 두 번 제출된 것처럼 보인다.
 *
 * ballotId 는 화면에서 쓰지 않으므로, 파싱 실패는 경고만 남기고 성공으로 넘긴다.
 */
export const castBallot = (
  pollId: string,
  ballotToken: string,
  body: CastBallotRequest,
): Promise<CastBallotResponse> =>
  request(
    `/polls/${pollId}/ballots`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${ballotToken}` },
      body: JSON.stringify(body),
    },
    (raw) => {
      const parsed = castBallotResponseSchema.safeParse(raw)
      if (parsed.success) return parsed.data
      console.warn('[castBallot] 응답 형식이 계약과 다릅니다', parsed.error.flatten())
      return { ballotId: '', submittedAt: new Date().toISOString() }
    },
  )

export const fetchRevealState = (pollId: string): Promise<RevealState> =>
  request(`/polls/${pollId}/reveal`, { method: 'GET' }, (raw) => revealStateSchema.parse(raw))

/** 관리자 전용. 사회자 화면에서만 쓴다. */
export const adminAdvanceReveal = (
  pollId: string,
  adminKey: string,
): Promise<RevealState> =>
  request(
    `/admin/polls/${pollId}/reveal/advance`,
    { method: 'POST', headers: { 'x-admin-key': adminKey } },
    (raw) => revealStateSchema.parse(raw),
  )

interface ClosePollResult {
  frozenCount: number
  totalRanks: number
  /** 공개해야 할 칸 수 = 팀 수 × 항목 수. 사회자가 누를 횟수다. */
  totalCells: number
}

export const adminClosePoll = (
  pollId: string,
  adminKey: string,
): Promise<ClosePollResult> =>
  request(
    `/admin/polls/${pollId}/close`,
    { method: 'POST', headers: { 'x-admin-key': adminKey } },
    (raw) => raw as ClosePollResult,
  )
