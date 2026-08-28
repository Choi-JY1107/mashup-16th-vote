import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import {
  castBallotRequestSchema,
  verifyAccessCodeRequestSchema,
  type BallotForm,
  type CastBallotRequest,
  type CastBallotResponse,
  type VerifyAccessCodeRequest,
} from '@vote/contract'
import { POLL_ID_PIPE } from '../../../shared/http/poll-id.pipe.js'
import { unwrapOrThrow } from '../../../shared/http/http-result.js'
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js'
import { CastBallotUseCase } from '../application/cast-ballot.usecase.js'
import { VerifyAccessCodeUseCase } from '../application/verify-access-code.usecase.js'

const bearer = (header: string | undefined): string => {
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token === '') {
    throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '권한이 없습니다.' })
  }
  return token
}

@Controller('polls/:pollId')
export class BallotController {
  constructor(
    @Inject(VerifyAccessCodeUseCase) private readonly verifyAccessCode: VerifyAccessCodeUseCase,
    @Inject(CastBallotUseCase) private readonly castBallot: CastBallotUseCase,
  ) {}

  /**
   * 통행코드 검증.
   *
   * 코드가 6자라 무차별 대입이 현실적인 위협이다. IP 당 분당 10회로 제한한다.
   */
  @Post('access-codes/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(
    @Param('pollId', POLL_ID_PIPE) pollId: string,
    @Body(new ZodValidationPipe(verifyAccessCodeRequestSchema))
    body: VerifyAccessCodeRequest,
  ): Promise<BallotForm> {
    return unwrapOrThrow(await this.verifyAccessCode.execute({ pollId, code: body.code }))
  }

  /** 표 제출. pollId 는 토큰 안의 값을 신뢰하므로 경로 값과 별개로 검증된다. */
  @Post('ballots')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async cast(
    @Param('pollId', POLL_ID_PIPE) _pollId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(castBallotRequestSchema)) body: CastBallotRequest,
  ): Promise<CastBallotResponse> {
    return unwrapOrThrow(
      await this.castBallot.execute({ ballotToken: bearer(authorization), request: body }),
    )
  }
}
