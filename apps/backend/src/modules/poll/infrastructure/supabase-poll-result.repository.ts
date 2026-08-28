import type { SupabaseClient } from '@supabase/supabase-js'
import type { PollResultRepository } from '../domain/ports.js'
import type { RankedCandidate } from '../domain/ranking-policy.js'

export class SupabasePollResultRepository implements PollResultRepository {
  constructor(private readonly db: SupabaseClient) {}

  async freeze(pollId: string, ranked: readonly RankedCandidate[]): Promise<void> {
    if (ranked.length === 0) return

    const { error } = await this.db.from('poll_results').upsert(
      ranked.map((r) => ({
        poll_id: pollId,
        candidate_id: r.candidateId,
        rank: r.rank,
        normalized_score: r.normalizedScore,
        per_criterion: r.perCriterion,
        voter_count: r.voterCount,
        frozen_at: new Date().toISOString(),
      })),
      { onConflict: 'poll_id,candidate_id' },
    )
    if (error) throw error
  }

  async count(pollId: string): Promise<number> {
    const { count, error } = await this.db
      .from('poll_results')
      .select('candidate_id', { count: 'exact', head: true })
      .eq('poll_id', pollId)

    if (error) throw error
    return count ?? 0
  }
}
