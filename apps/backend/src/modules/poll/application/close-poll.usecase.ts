import { Inject, Injectable } from '@nestjs/common'
import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import {
  BALLOT_REPOSITORY,
  POLL_REPOSITORY,
  POLL_RESULT_REPOSITORY,
  REVEAL_PORT,
  type BallotRepository,
  type PollRepository,
  type PollResultRepository,
  type RevealPort,
} from '../domain/ports.js'
import { MeanPerVoterRankingPolicy } from '../domain/ranking-policy.js'

export interface ClosePollOutput {
  frozenCount: number
  totalRanks: number
  /** 공개해야 할 칸 수 = 팀 수 × 항목 수. 사회자가 누를 횟수와 같다. */
  totalCells: number
}

/**
 * 투표를 마감하고 결과를 스냅샷으로 확정한다.
 *
 * 여기서 순위를 못 박아두기 때문에, 공개 도중 늦은 표가 들어와도
 * 이미 발표한 순위가 흔들리는 일이 구조적으로 발생하지 않는다.
 */
@Injectable()
export class ClosePollUseCase {
  private readonly policy = new MeanPerVoterRankingPolicy()

  constructor(
    @Inject(POLL_REPOSITORY) private readonly polls: PollRepository,
    @Inject(BALLOT_REPOSITORY) private readonly ballots: BallotRepository,
    @Inject(POLL_RESULT_REPOSITORY) private readonly results: PollResultRepository,
    @Inject(REVEAL_PORT) private readonly reveal: RevealPort,
  ) {}

  async execute(input: { pollId: string }): Promise<Result<ClosePollOutput>> {
    const poll = await this.polls.findById(input.pollId)
    if (poll === null) return Err(DomainErrors.notFound('투표'))

    const closed = poll.close()
    if (!closed.ok) return closed
    await this.polls.saveStatus(poll)

    const [criteria, candidates, scores, voterCountByCandidate] = await Promise.all([
      this.polls.findCriteria(poll.id),
      this.polls.findCandidates(poll.id),
      this.ballots.findAllScores(poll.id),
      this.ballots.countVotersByCandidate(poll.id),
    ])

    const ranked = this.policy.rank({
      criteria,
      candidateIds: candidates.map((c) => c.id),
      scores,
      voterCountByCandidate,
    })

    await this.results.freeze(poll.id, ranked)

    // 집계가 확정된 뒤에만 공개 단계로 넘어간다.
    const revealing = poll.startRevealing()
    if (!revealing.ok) return revealing
    await this.polls.saveStatus(poll)

    // 한 칸도 공개되지 않은 빈 표를 미리 만들어둔다.
    // 마감 직후부터 /live 가 6팀 × 4항목 격자를 보여줄 수 있다.
    await this.reveal.initialize(poll.id)

    return Ok({
      frozenCount: ranked.length,
      totalRanks: ranked.length === 0 ? 0 : Math.max(...ranked.map((r) => r.rank)),
      totalCells: ranked.length * criteria.length,
    })
  }
}
