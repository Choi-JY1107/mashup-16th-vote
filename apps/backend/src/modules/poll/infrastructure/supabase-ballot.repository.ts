import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import type { Ballot } from '../domain/ballot.js'
import type { BallotRepository } from '../domain/ports.js'
import type { RawScore } from '../domain/ranking-policy.js'

/** DB 함수가 raise 하는 메시지를 도메인 실패로 되돌린다. */
const mapDbError = (message: string) => {
  if (message.includes('ALREADY_VOTED')) return DomainErrors.alreadyVoted()
  if (message.includes('ACCESS_CODE_ALREADY_USED')) return DomainErrors.accessCodeAlreadyUsed()
  if (message.includes('INVALID_ACCESS_CODE')) return DomainErrors.invalidAccessCode()
  return null
}

export class SupabaseBallotRepository implements BallotRepository {
  constructor(private readonly db: SupabaseClient) {}

  async save(ballot: Ballot): Promise<Result<{ ballotId: string }>> {
    const { data, error } = await this.db.rpc('cast_ballot', {
      p_poll_id: ballot.pollId,
      p_access_code_id: ballot.accessCodeId,
      p_scores: ballot.scores.map((s) => ({
        criterionId: s.criterionId,
        candidateId: s.candidateId,
        points: s.points,
      })),
    })

    if (error) {
      const mapped = mapDbError(error.message)
      if (mapped !== null) return Err(mapped)
      throw error
    }
    return Ok({ ballotId: String(data) })
  }

  async existsByAccessCode(pollId: string, accessCodeId: string): Promise<boolean> {
    const { count, error } = await this.db
      .from('ballots')
      .select('id', { count: 'exact', head: true })
      .eq('poll_id', pollId)
      .eq('access_code_id', accessCodeId)

    if (error) throw error
    return (count ?? 0) > 0
  }

  async findAllScores(pollId: string): Promise<RawScore[]> {
    // 표가 많아지면 기본 1000행 제한에 걸린다. 페이지 단위로 전부 끌어온다.
    const PAGE = 1000
    const out: RawScore[] = []

    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from('ballot_scores')
        .select('candidate_id, criterion_id, points, ballots!inner(poll_id)')
        .eq('ballots.poll_id', pollId)
        .range(from, from + PAGE - 1)
        .returns<{ candidate_id: string; criterion_id: string; points: number }[]>()

      if (error) throw error
      const rows = data ?? []
      out.push(
        ...rows.map((r) => ({
          candidateId: r.candidate_id,
          criterionId: r.criterion_id,
          points: r.points,
        })),
      )
      if (rows.length < PAGE) break
    }

    return out
  }

  async countVotersByCandidate(pollId: string): Promise<Map<string, number>> {
    const { data, error } = await this.db.rpc('voter_counts_by_candidate', {
      p_poll_id: pollId,
    })

    if (error) throw error
    const rows = (data ?? []) as { candidate_id: string; voter_count: number | string }[]
    // count(*) 는 bigint 라 드라이버가 문자열로 줄 수 있다.
    return new Map(rows.map((r) => [r.candidate_id, Number(r.voter_count)]))
  }
}
