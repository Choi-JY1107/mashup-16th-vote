/**
 * 도메인은 예외를 던지지 않는다. 실패를 값으로 반환해서 호출자가 반드시 다루게 한다.
 */
export type Result<T, E = DomainFailure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface DomainFailure {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

/**
 * code 를 리터럴 타입으로 보존한다.
 * 이래야 DomainErrors 가 contract 의 ApiErrorCode 만 쓰는지 컴파일 타임에 검사된다.
 */
export const fail = <C extends string>(
  code: C,
  message: string,
  details?: unknown,
): DomainFailure & { code: C } =>
  details === undefined ? { code, message } : { code, message, details }

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`unwrap on Err: ${r.error.code} ${r.error.message}`)
  return r.value
}
