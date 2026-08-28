import type { PollStatus } from '@vote/contract'
import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'

export interface PollRules {
  /** 한 항목에서 배분 가능한 총점 상한. 합계는 이 값 이하. */
  readonly pointsPerCriterion: number
  readonly excludeOwnTeam: boolean
}

/** 허용된 상태 전이만 정의한다. 표에 없는 전이는 전부 거부된다. */
const TRANSITIONS: Readonly<Record<PollStatus, readonly PollStatus[]>> = {
  DRAFT: ['OPEN'],
  OPEN: ['CLOSED'],
  CLOSED: ['REVEALING'],
  REVEALING: ['FINISHED'],
  FINISHED: [],
}

export class Poll {
  private constructor(
    readonly id: string,
    readonly title: string,
    private _status: PollStatus,
    readonly rules: PollRules,
  ) {}

  static rehydrate(props: {
    id: string
    title: string
    status: PollStatus
    rules: PollRules
  }): Poll {
    return new Poll(props.id, props.title, props.status, props.rules)
  }

  get status(): PollStatus {
    return this._status
  }

  acceptsBallots(): boolean {
    return this._status === 'OPEN'
  }

  private transitionTo(next: PollStatus): Result<PollStatus> {
    if (!TRANSITIONS[this._status].includes(next)) {
      return Err(
        DomainErrors.notFound(`${this._status} → ${next} 상태 전이는 허용되지 않습니다. 대상`),
      )
    }
    this._status = next
    return Ok(next)
  }

  open(): Result<PollStatus> {
    return this.transitionTo('OPEN')
  }

  /** 투표 마감. 이 시점 이후에는 표를 받지 않는다. */
  close(): Result<PollStatus> {
    if (this._status !== 'OPEN') return Err(DomainErrors.pollNotOpen())
    return this.transitionTo('CLOSED')
  }

  /** 결과 공개 시작. 집계 확정 후에만 진입할 수 있다. */
  startRevealing(): Result<PollStatus> {
    if (this._status !== 'CLOSED') return Err(DomainErrors.resultsNotFrozen())
    return this.transitionTo('REVEALING')
  }

  /** 1위까지 공개되면 종료된다. */
  finish(): Result<PollStatus> {
    if (this._status !== 'REVEALING') return Err(DomainErrors.pollNotRevealing())
    return this.transitionTo('FINISHED')
  }
}
