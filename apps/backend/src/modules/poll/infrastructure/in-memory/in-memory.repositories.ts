import type { RevealState } from '@vote/contract'
import { DomainErrors } from '../../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../../shared/kernel/result.js'
import type { AccessCode } from '../../domain/access-code.js'
import type { Ballot } from '../../domain/ballot.js'
import type { Candidate } from '../../domain/candidate.js'
import type { Criterion } from '../../domain/criterion.js'
import type { Poll } from '../../domain/poll.js'
import type {
  AccessCodeRepository,
  BallotRepository,
  PollRepository,
  PollResultRepository,
  RevealPort,
} from '../../domain/ports.js'
import {
  isFrozen,
  projectRevealState,
  revealScriptOf,
  type RevealSnapshot,
} from '../../domain/reveal-projection.js'
import type { RankedCandidate, RawScore } from '../../domain/ranking-policy.js'
import { InMemoryStore } from './store.js'

export class InMemoryPollRepository implements PollRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(pollId: string): Promise<Poll | null> {
    return this.store.polls.get(pollId) ?? null
  }

  async findCriteria(pollId: string): Promise<Criterion[]> {
    return [...(this.store.criteria.get(pollId) ?? [])]
  }

  async findCandidates(pollId: string): Promise<Candidate[]> {
    return [...(this.store.candidates.get(pollId) ?? [])]
  }

  async saveStatus(poll: Poll): Promise<void> {
    // Poll 인스턴스를 그대로 보관하므로 상태 변경이 이미 반영돼 있다.
    this.store.polls.set(poll.id, poll)
  }
}

export class InMemoryAccessCodeRepository implements AccessCodeRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findByHash(codeHash: string): Promise<AccessCode | null> {
    return this.store.accessCodesByHash.get(codeHash) ?? null
  }

  async findById(accessCodeId: string): Promise<AccessCode | null> {
    return this.store.accessCodesById.get(accessCodeId) ?? null
  }
}

export class InMemoryBallotRepository implements BallotRepository {
  constructor(private readonly store: InMemoryStore) {}

  async save(ballot: Ballot): Promise<Result<{ ballotId: string }>> {
    const duplicated = this.store.ballots.some(
      (b) => b.pollId === ballot.pollId && b.accessCodeId === ballot.accessCodeId,
    )
    if (duplicated) return Err(DomainErrors.alreadyVoted())

    const accessCode = this.store.accessCodesById.get(ballot.accessCodeId)
    if (accessCode === undefined) return Err(DomainErrors.invalidAccessCode())

    const marked = accessCode.markUsed(ballot.submittedAt)
    if (!marked.ok) return marked

    const id = this.store.newId()
    this.store.ballots.push({
      id,
      pollId: ballot.pollId,
      accessCodeId: ballot.accessCodeId,
      scores: ballot.scores,
    })
    return Ok({ ballotId: id })
  }

  async existsByAccessCode(pollId: string, accessCodeId: string): Promise<boolean> {
    return this.store.ballots.some(
      (b) => b.pollId === pollId && b.accessCodeId === accessCodeId,
    )
  }

  async findAllScores(pollId: string): Promise<RawScore[]> {
    return this.store.ballots
      .filter((b) => b.pollId === pollId)
      .flatMap((b) =>
        b.scores.map((s) => ({
          candidateId: s.candidateId,
          criterionId: s.criterionId,
          points: s.points,
        })),
      )
  }

  async countVotersByCandidate(pollId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    for (const ballot of this.store.ballots) {
      if (ballot.pollId !== pollId) continue
      // 한 표 안에서 같은 후보가 여러 항목에 등장하므로 후보당 1회만 센다.
      for (const candidateId of new Set(ballot.scores.map((s) => s.candidateId))) {
        counts.set(candidateId, (counts.get(candidateId) ?? 0) + 1)
      }
    }
    return counts
  }
}

export class InMemoryPollResultRepository implements PollResultRepository {
  constructor(private readonly store: InMemoryStore) {}

  async freeze(pollId: string, ranked: readonly RankedCandidate[]): Promise<void> {
    this.store.results.set(pollId, [...ranked])
  }

  async count(pollId: string): Promise<number> {
    return this.store.results.get(pollId)?.length ?? 0
  }
}

/**
 * 로컬 데모용 공개 상태 저장소.
 *
 * 화면 계산은 Supabase 어댑터와 **똑같이** domain/reveal-projection.ts 를 쓴다.
 * 그래서 /live/mock 에서 본 연출이 당일 연출과 어긋날 수 없다.
 */
export class InMemoryRevealAdapter implements RevealPort {
  constructor(private readonly store: InMemoryStore) {}

  /** 마감 시점에 확정된 것들. Supabase 어댑터는 같은 것을 DB 에서 읽는다. */
  private snapshot(pollId: string): RevealSnapshot {
    return {
      candidates: this.store.candidates.get(pollId) ?? [],
      criteria: this.store.criteria.get(pollId) ?? [],
      ranked: this.store.results.get(pollId) ?? [],
    }
  }

  private project(pollId: string, snapshot: RevealSnapshot, steps: number): RevealState {
    return projectRevealState({
      pollId,
      snapshot,
      revealedSteps: steps,
      updatedAt: new Date(),
    })
  }

  async initialize(pollId: string): Promise<void> {
    if (this.store.reveal.has(pollId)) return
    const snapshot = this.snapshot(pollId)
    if (!isFrozen(snapshot)) return
    this.store.reveal.set(pollId, this.project(pollId, snapshot, 0))
  }

  async advance(pollId: string): Promise<Result<RevealState>> {
    const snapshot = this.snapshot(pollId)
    if (!isFrozen(snapshot)) return Err(DomainErrors.resultsNotFrozen())

    const totalSteps = revealScriptOf(snapshot).steps.length
    const current = this.store.reveal.get(pollId)?.revealedSteps ?? 0
    if (current >= totalSteps) return Err(DomainErrors.revealExhausted())

    const state = this.project(pollId, snapshot, current + 1)
    this.store.reveal.set(pollId, state)
    return Ok(state)
  }

  async getState(pollId: string): Promise<RevealState | null> {
    const existing = this.store.reveal.get(pollId)
    if (existing !== undefined) return existing

    const snapshot = this.snapshot(pollId)
    if (!isFrozen(snapshot)) return null

    // 아직 한 칸도 공개되지 않은 상태. 표의 뼈대만 알려준다.
    return this.project(pollId, snapshot, 0)
  }
}
