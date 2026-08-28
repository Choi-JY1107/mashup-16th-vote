import type { RevealState } from '@vote/contract'
import type { Result } from '../../../shared/kernel/result.js'
import type { AccessCode } from './access-code.js'
import type { Ballot } from './ballot.js'
import type { Candidate } from './candidate.js'
import type { Criterion } from './criterion.js'
import type { Poll } from './poll.js'
import type { RankedCandidate, RawScore } from './ranking-policy.js'

/** 도메인이 필요로 하는 바깥 세계. 구현은 infrastructure 에만 존재한다. */

export interface PollRepository {
  findById(pollId: string): Promise<Poll | null>
  findCriteria(pollId: string): Promise<Criterion[]>
  findCandidates(pollId: string): Promise<Candidate[]>
  saveStatus(poll: Poll): Promise<void>
}

/**
 * 통행코드는 읽기만 한다.
 *
 * 발급은 서버의 일이 아니다 — 로컬에서 만들어 DB 에 직접 넣는다.
 * 쓰기 경로가 없으므로 ADMIN_API_KEY 가 새더라도 코드를 새로 찍어낼 수 없다.
 */
export interface AccessCodeRepository {
  findByHash(codeHash: string): Promise<AccessCode | null>
  findById(accessCodeId: string): Promise<AccessCode | null>
}

export interface BallotRepository {
  /** 표와 점수 저장 + 코드 사용 처리를 한 트랜잭션으로 수행한다. */
  save(ballot: Ballot): Promise<Result<{ ballotId: string }>>
  existsByAccessCode(pollId: string, accessCodeId: string): Promise<boolean>
  findAllScores(pollId: string): Promise<RawScore[]>
  /** 후보별로 그 후보를 평가한 표 수 */
  countVotersByCandidate(pollId: string): Promise<Map<string, number>>
}

export interface PollResultRepository {
  freeze(pollId: string, ranked: readonly RankedCandidate[]): Promise<void>
  count(pollId: string): Promise<number>
}

export interface RevealPort {
  /** 마감 직후 표의 뼈대를 만든다. 아직 한 칸도 공개되지 않은 상태다. */
  initialize(pollId: string): Promise<void>
  /** 한 칸 공개를 원자적으로 진행한다. */
  advance(pollId: string): Promise<Result<RevealState>>
  getState(pollId: string): Promise<RevealState | null>
}

export interface CodeHasher {
  hash(plainCode: string): Promise<string>
}

export interface BallotTokenIssuer {
  issue(payload: { pollId: string; accessCodeId: string }): Promise<string>
  verify(token: string): Promise<{ pollId: string; accessCodeId: string } | null>
}

export interface Clock {
  now(): Date
}

export const POLL_REPOSITORY = Symbol('PollRepository')
export const ACCESS_CODE_REPOSITORY = Symbol('AccessCodeRepository')
export const BALLOT_REPOSITORY = Symbol('BallotRepository')
export const POLL_RESULT_REPOSITORY = Symbol('PollResultRepository')
export const REVEAL_PORT = Symbol('RevealPort')
export const CODE_HASHER = Symbol('CodeHasher')
export const BALLOT_TOKEN_ISSUER = Symbol('BallotTokenIssuer')
export const CLOCK = Symbol('Clock')
