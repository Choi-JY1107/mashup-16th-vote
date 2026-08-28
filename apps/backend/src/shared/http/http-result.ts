import { HttpException, HttpStatus } from '@nestjs/common'
import type { ApiError, ApiErrorCode } from '@vote/contract'
import type { DomainFailure, Result } from '../kernel/result.js'

const STATUS: Record<ApiErrorCode, HttpStatus> = {
  POLL_NOT_OPEN: HttpStatus.CONFLICT,
  POLL_NOT_REVEALING: HttpStatus.CONFLICT,
  INVALID_ACCESS_CODE: HttpStatus.UNAUTHORIZED,
  ACCESS_CODE_ALREADY_USED: HttpStatus.CONFLICT,
  CRITERIA_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  CANDIDATES_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  BUDGET_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_POINTS: HttpStatus.UNPROCESSABLE_ENTITY,
  ALREADY_VOTED: HttpStatus.CONFLICT,
  REVEAL_EXHAUSTED: HttpStatus.CONFLICT,
  RESULTS_NOT_FROZEN: HttpStatus.CONFLICT,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,
}

const toApiError = (f: DomainFailure): ApiError => ({
  code: (f.code in STATUS ? f.code : 'NOT_FOUND') as ApiErrorCode,
  message: f.message,
  ...(f.details === undefined ? {} : { details: f.details }),
})

/**
 * 도메인 실패를 HTTP 로 번역하는 유일한 지점.
 * 컨트롤러는 상태 코드를 몰라도 되고, 도메인은 HTTP 를 몰라도 된다.
 */
export function unwrapOrThrow<T>(result: Result<T>): T {
  if (result.ok) return result.value
  const body = toApiError(result.error)
  throw new HttpException(body, STATUS[body.code])
}
