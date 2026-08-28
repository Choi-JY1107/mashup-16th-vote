import { pollIdSchema } from '@vote/contract'
import { ZodValidationPipe } from './zod-validation.pipe.js'

/**
 * URL 의 :pollId 를 계약 스키마로 검증한다.
 *
 * 예전에는 Nest 의 ParseUUIDPipe 를 썼는데, 투표 id 가 짧은 슬러그로 바뀌면서
 * 형식이 uuid 가 아니게 됐다. 검사 규칙은 pollIdSchema 한 곳에만 두고
 * DB 의 polls.id check 제약이 같은 형식을 다시 막는다.
 *
 * 인스턴스를 하나만 만들어 공유한다 — 상태가 없다.
 */
export const POLL_ID_PIPE = new ZodValidationPipe(pollIdSchema)
