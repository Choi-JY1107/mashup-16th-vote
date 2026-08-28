import { Inject, Injectable } from '@nestjs/common'
import type { RevealState } from '@vote/contract'
import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import {
  POLL_REPOSITORY,
  REVEAL_PORT,
  type PollRepository,
  type RevealPort,
} from '../domain/ports.js'

/**
 * 공개를 한 단계 진행한다. 한 클릭 = 칸 하나 공개 / 행 순서 갱신 / 등수 하나 공개.
 *
 * 상태 전이 규칙은 Poll 엔티티가 갖고 있다. 예전에는 DB 함수 advance_reveal() 안에도
 * 같은 검사가 있었는데, 규칙이 두 곳에 있으면 한쪽만 고치게 된다.
 *
 * 동시 클릭은 어댑터의 조건부 UPDATE 가 막는다 (커서가 그 사이 움직였으면 반영하지 않는다).
 */
@Injectable()
export class AdvanceRevealUseCase {
  constructor(
    @Inject(POLL_REPOSITORY) private readonly polls: PollRepository,
    @Inject(REVEAL_PORT) private readonly reveal: RevealPort,
  ) {}

  async execute(input: { pollId: string }): Promise<Result<RevealState>> {
    const poll = await this.polls.findById(input.pollId)
    if (poll === null) return Err(DomainErrors.notFound('투표'))
    if (poll.status !== 'REVEALING') return Err(DomainErrors.pollNotRevealing())

    const advanced = await this.reveal.advance(poll.id)
    if (!advanced.ok) return advanced

    // 마지막 단계까지 갔으면 투표를 종료 상태로 넘긴다.
    if (advanced.value.nextAction === 'NONE') {
      const finished = poll.finish()
      if (finished.ok) await this.polls.saveStatus(poll)
    }

    return advanced
  }
}

/** 페이지 최초 진입 시 현재까지 공개된 순위를 가져온다. 이후 갱신은 Realtime 이 담당한다. */
@Injectable()
export class GetRevealStateUseCase {
  constructor(@Inject(REVEAL_PORT) private readonly reveal: RevealPort) {}

  async execute(input: { pollId: string }): Promise<Result<RevealState>> {
    const state = await this.reveal.getState(input.pollId)
    if (state === null) return Err(DomainErrors.notFound('공개 상태'))
    return Ok(state)
  }
}
