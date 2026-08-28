import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import type { Candidate } from './candidate.js'

export class AccessCode {
  private constructor(
    readonly id: string,
    readonly pollId: string,
    /** 소속 팀. null 이면 전 팀 평가 (회장단) */
    readonly teamId: string | null,
    readonly label: string,
    private _usedAt: Date | null,
  ) {}

  static rehydrate(props: {
    id: string
    pollId: string
    teamId: string | null
    label: string
    usedAt: Date | null
  }): AccessCode {
    return new AccessCode(props.id, props.pollId, props.teamId, props.label, props.usedAt)
  }

  get usedAt(): Date | null {
    return this._usedAt
  }

  isUsed(): boolean {
    return this._usedAt !== null
  }

  markUsed(at: Date): Result<Date> {
    if (this.isUsed()) return Err(DomainErrors.accessCodeAlreadyUsed())
    this._usedAt = at
    return Ok(at)
  }

  /**
   * 이 코드 소지자가 평가할 수 있는 팀 목록.
   * 자기 팀 제외 규칙이 켜져 있고 소속 팀이 있으면 그 팀만 빠진다.
   */
  evaluableCandidates(all: readonly Candidate[], excludeOwnTeam: boolean): Candidate[] {
    if (!excludeOwnTeam || this.teamId === null) return [...all]
    return all.filter((c) => c.id !== this.teamId)
  }
}
