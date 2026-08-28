import type { ApiErrorCode } from '@vote/contract'
import { fail, type DomainFailure } from './result.js'

/** contract 의 에러 코드만 도메인 실패로 쓴다. 프론트가 분기할 수 있는 코드가 곧 계약이다. */
export const DomainErrors = {
  pollNotOpen: () => fail('POLL_NOT_OPEN', '지금은 투표 기간이 아닙니다.'),
  pollNotRevealing: () => fail('POLL_NOT_REVEALING', '결과 공개 단계가 아닙니다.'),
  invalidAccessCode: () => fail('INVALID_ACCESS_CODE', '통행코드가 올바르지 않습니다.'),
  accessCodeAlreadyUsed: () =>
    fail('ACCESS_CODE_ALREADY_USED', '이미 사용된 통행코드입니다.'),
  criteriaMismatch: (details?: unknown) =>
    fail('CRITERIA_MISMATCH', '평가 항목이 일치하지 않습니다.', details),
  candidatesMismatch: (details?: unknown) =>
    fail('CANDIDATES_MISMATCH', '평가 대상 팀이 일치하지 않습니다.', details),
  budgetExceeded: (details?: unknown) =>
    fail('BUDGET_EXCEEDED', '항목별 배분 점수 합계가 상한을 초과했습니다.', details),
  invalidPoints: (details?: unknown) =>
    fail('INVALID_POINTS', '점수는 0 이상의 정수여야 합니다.', details),
  alreadyVoted: () => fail('ALREADY_VOTED', '이미 투표를 완료했습니다.'),
  revealExhausted: () => fail('REVEAL_EXHAUSTED', '더 공개할 순위가 없습니다.'),
  resultsNotFrozen: () => fail('RESULTS_NOT_FROZEN', '집계가 확정되지 않았습니다.'),
  notFound: (what = '대상') => fail('NOT_FOUND', `${what}을 찾을 수 없습니다.`),
  unauthorized: () => fail('UNAUTHORIZED', '권한이 없습니다.'),
} satisfies Record<string, (...args: never[]) => DomainFailure & { code: ApiErrorCode }>
