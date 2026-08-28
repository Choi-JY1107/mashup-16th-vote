import { Controller, Get, Inject, Param } from '@nestjs/common'
import type { RevealState } from '@vote/contract'
import { POLL_ID_PIPE } from '../../../shared/http/poll-id.pipe.js'
import { unwrapOrThrow } from '../../../shared/http/http-result.js'
import { GetRevealStateUseCase } from '../application/reveal.usecase.js'

/**
 * 시상식 화면 최초 진입용. 새로고침해도 지금까지 공개된 순위가 그대로 복원된다.
 * 이후 갱신은 Supabase Realtime 이 payload 를 직접 실어보내므로 이 엔드포인트를 다시 부르지 않는다.
 */
@Controller('polls/:pollId')
export class RevealController {
  constructor(
    @Inject(GetRevealStateUseCase) private readonly getRevealState: GetRevealStateUseCase,
  ) {}

  @Get('reveal')
  async reveal(@Param('pollId', POLL_ID_PIPE) pollId: string): Promise<RevealState> {
    return unwrapOrThrow(await this.getRevealState.execute({ pollId }))
  }
}
