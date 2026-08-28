import { Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common'
import type { RevealState } from '@vote/contract'
import { POLL_ID_PIPE } from '../../../shared/http/poll-id.pipe.js'
import { unwrapOrThrow } from '../../../shared/http/http-result.js'
import { ClosePollUseCase, type ClosePollOutput } from '../application/close-poll.usecase.js'
import {
  AdvanceRevealUseCase,
  GetRevealStateUseCase,
} from '../application/reveal.usecase.js'
import { AdminGuard } from './admin.guard.js'

@Controller('admin/polls/:pollId')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @Inject(ClosePollUseCase) private readonly closePoll: ClosePollUseCase,
    @Inject(AdvanceRevealUseCase) private readonly advanceReveal: AdvanceRevealUseCase,
    @Inject(GetRevealStateUseCase) private readonly getRevealState: GetRevealStateUseCase,
  ) {}

  /** 투표 마감 + 집계 확정 + 공개 단계 진입. 되돌릴 수 없다. */
  @Post('close')
  async close(@Param('pollId', POLL_ID_PIPE) pollId: string): Promise<ClosePollOutput> {
    return unwrapOrThrow(await this.closePoll.execute({ pollId }))
  }

  /** 사회자가 누르는 버튼. 한 칸 공개하고 Realtime 으로 브로드캐스트된다. */
  @Post('reveal/advance')
  async advance(@Param('pollId', POLL_ID_PIPE) pollId: string): Promise<RevealState> {
    return unwrapOrThrow(await this.advanceReveal.execute({ pollId }))
  }

  @Get('reveal')
  async reveal(@Param('pollId', POLL_ID_PIPE) pollId: string): Promise<RevealState> {
    return unwrapOrThrow(await this.getRevealState.execute({ pollId }))
  }
}
