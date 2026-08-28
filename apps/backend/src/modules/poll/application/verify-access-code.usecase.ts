import { Inject, Injectable } from '@nestjs/common'
import type { BallotForm } from '@vote/contract'
import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import {
  ACCESS_CODE_REPOSITORY,
  BALLOT_TOKEN_ISSUER,
  CODE_HASHER,
  POLL_REPOSITORY,
  type AccessCodeRepository,
  type BallotTokenIssuer,
  type CodeHasher,
  type PollRepository,
} from '../domain/ports.js'

/**
 * 통행코드를 검증하고 투표 화면에 필요한 모든 것을 한 번에 돌려준다.
 * 자기 팀은 여기서 이미 제외되어 나가므로 프론트가 필터링을 책임지지 않는다.
 */
@Injectable()
export class VerifyAccessCodeUseCase {
  constructor(
    @Inject(POLL_REPOSITORY) private readonly polls: PollRepository,
    @Inject(ACCESS_CODE_REPOSITORY) private readonly accessCodes: AccessCodeRepository,
    @Inject(CODE_HASHER) private readonly hasher: CodeHasher,
    @Inject(BALLOT_TOKEN_ISSUER) private readonly tokens: BallotTokenIssuer,
  ) {}

  async execute(input: { pollId: string; code: string }): Promise<Result<BallotForm>> {
    const codeHash = await this.hasher.hash(input.code)
    const accessCode = await this.accessCodes.findByHash(codeHash)

    // 존재하지 않는 코드와 다른 투표의 코드를 같은 에러로 묶는다.
    // 어떤 코드가 유효한지 탐색할 단서를 주지 않는다.
    if (accessCode === null || accessCode.pollId !== input.pollId) {
      return Err(DomainErrors.invalidAccessCode())
    }
    if (accessCode.isUsed()) {
      return Err(DomainErrors.accessCodeAlreadyUsed())
    }

    const poll = await this.polls.findById(input.pollId)
    if (poll === null) return Err(DomainErrors.notFound('투표'))
    if (!poll.acceptsBallots()) return Err(DomainErrors.pollNotOpen())

    const [criteria, candidates] = await Promise.all([
      this.polls.findCriteria(poll.id),
      this.polls.findCandidates(poll.id),
    ])

    const evaluable = accessCode.evaluableCandidates(candidates, poll.rules.excludeOwnTeam)
    if (criteria.length === 0 || evaluable.length === 0) {
      return Err(DomainErrors.notFound('평가 대상'))
    }

    const ballotToken = await this.tokens.issue({
      pollId: poll.id,
      accessCodeId: accessCode.id,
    })

    return Ok({
      ballotToken,
      poll: {
        id: poll.id,
        title: poll.title,
        status: poll.status,
        rules: {
          pointsPerCriterion: poll.rules.pointsPerCriterion,
          excludeOwnTeam: poll.rules.excludeOwnTeam,
        },
      },
      criteria: criteria
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((c) => ({
          id: c.id,
          key: c.key,
          name: c.name,
          description: c.description,
          weight: c.weight,
          displayOrder: c.displayOrder,
        })),
      candidates: evaluable
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          thumbnailUrl: c.thumbnailUrl,
          platform: c.platform,
          displayOrder: c.displayOrder,
        })),
      ownTeamId: accessCode.teamId,
    })
  }
}
