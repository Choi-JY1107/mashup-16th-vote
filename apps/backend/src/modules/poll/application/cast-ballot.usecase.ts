import { Inject, Injectable } from '@nestjs/common'
import type { CastBallotRequest, CastBallotResponse } from '@vote/contract'
import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import { Ballot } from '../domain/ballot.js'
import {
  ACCESS_CODE_REPOSITORY,
  BALLOT_REPOSITORY,
  BALLOT_TOKEN_ISSUER,
  CLOCK,
  POLL_REPOSITORY,
  type AccessCodeRepository,
  type BallotRepository,
  type BallotTokenIssuer,
  type Clock,
  type PollRepository,
} from '../domain/ports.js'

/**
 * 표 제출. 검증은 전부 Ballot.create() 안에 있고 여기는 조립과 저장만 한다.
 *
 * 중복 투표는 3중으로 막힌다.
 *   1. AccessCode.isUsed()          (도메인)
 *   2. existsByAccessCode()         (선행 조회)
 *   3. UNIQUE(poll_id, access_code_id)  (DB — 동시 제출의 최종 방어선)
 */
@Injectable()
export class CastBallotUseCase {
  constructor(
    @Inject(POLL_REPOSITORY) private readonly polls: PollRepository,
    @Inject(ACCESS_CODE_REPOSITORY) private readonly accessCodes: AccessCodeRepository,
    @Inject(BALLOT_REPOSITORY) private readonly ballots: BallotRepository,
    @Inject(BALLOT_TOKEN_ISSUER) private readonly tokens: BallotTokenIssuer,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: {
    ballotToken: string
    request: CastBallotRequest
  }): Promise<Result<CastBallotResponse>> {
    const claims = await this.tokens.verify(input.ballotToken)
    if (claims === null) return Err(DomainErrors.unauthorized())

    const [poll, accessCode] = await Promise.all([
      this.polls.findById(claims.pollId),
      this.accessCodes.findById(claims.accessCodeId),
    ])

    if (poll === null) return Err(DomainErrors.notFound('투표'))
    if (accessCode === null || accessCode.pollId !== poll.id) {
      return Err(DomainErrors.invalidAccessCode())
    }

    if (await this.ballots.existsByAccessCode(poll.id, accessCode.id)) {
      return Err(DomainErrors.alreadyVoted())
    }

    const [criteria, candidates] = await Promise.all([
      this.polls.findCriteria(poll.id),
      this.polls.findCandidates(poll.id),
    ])

    const ballot = Ballot.create({
      poll,
      accessCode,
      criteria,
      candidates,
      allocations: input.request.allocations,
      now: this.clock.now(),
    })
    if (!ballot.ok) return ballot

    const saved = await this.ballots.save(ballot.value)
    if (!saved.ok) return saved

    return Ok({
      ballotId: saved.value.ballotId,
      submittedAt: ballot.value.submittedAt.toISOString(),
    })
  }
}
