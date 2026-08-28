import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { RevealState } from '@vote/contract'
import type { AccessCode } from '../../domain/access-code.js'
import type { BallotScore } from '../../domain/ballot.js'
import type { Candidate } from '../../domain/candidate.js'
import type { Criterion } from '../../domain/criterion.js'
import type { Poll } from '../../domain/poll.js'
import type { RankedCandidate } from '../../domain/ranking-policy.js'

export interface StoredBallot {
  id: string
  pollId: string
  accessCodeId: string
  scores: readonly BallotScore[]
}

/**
 * 로컬 데모용 저장소. DATA_SOURCE=memory 일 때만 쓴다.
 *
 * 도메인이 포트에만 의존하기 때문에 Supabase 없이도 전체 플로우가 돌아간다.
 * 클린 아키텍처를 택한 실질적인 대가가 여기서 회수된다.
 */
@Injectable()
export class InMemoryStore {
  polls = new Map<string, Poll>()
  criteria = new Map<string, Criterion[]>()
  candidates = new Map<string, Candidate[]>()

  /** codeHash → AccessCode */
  accessCodesByHash = new Map<string, AccessCode>()
  accessCodesById = new Map<string, AccessCode>()

  ballots: StoredBallot[] = []
  results = new Map<string, RankedCandidate[]>()
  reveal = new Map<string, RevealState>()

  /**
   * contract 가 ballotId 를 uuid 로 검증한다.
   * 순번 문자열을 주면 서버는 저장에 성공했는데 클라이언트 응답 파싱이 터진다.
   */
  newId(): string {
    return randomUUID()
  }
}
