import type { SupabaseClient } from '@supabase/supabase-js'
import type { Platform, PollStatus } from '@vote/contract'
import { Candidate } from '../domain/candidate.js'
import { Criterion } from '../domain/criterion.js'
import { Poll } from '../domain/poll.js'
import type { PollRepository } from '../domain/ports.js'

interface PollRow {
  id: string
  title: string
  status: PollStatus
  points_per_criterion: number
  exclude_own_team: boolean
}

interface CriterionRow {
  id: string
  key: string
  name: string
  description: string
  weight: number | string
  display_order: number
}

interface CandidateRow {
  id: string
  slug: string
  name: string
  description: string
  thumbnail_url: string | null
  platform: Platform | null
  display_order: number
}

export class SupabasePollRepository implements PollRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findById(pollId: string): Promise<Poll | null> {
    const { data, error } = await this.db
      .from('polls')
      .select('id, title, status, points_per_criterion, exclude_own_team')
      .eq('id', pollId)
      .maybeSingle<PollRow>()

    if (error) throw error
    if (data === null) return null

    return Poll.rehydrate({
      id: data.id,
      title: data.title,
      status: data.status,
      rules: {
        pointsPerCriterion: data.points_per_criterion,
        excludeOwnTeam: data.exclude_own_team,
      },
    })
  }

  async findCriteria(pollId: string): Promise<Criterion[]> {
    const { data, error } = await this.db
      .from('criteria')
      .select('id, key, name, description, weight, display_order')
      .eq('poll_id', pollId)
      .order('display_order', { ascending: true })
      .returns<CriterionRow[]>()

    if (error) throw error
    return (data ?? []).map((r) =>
      Criterion.rehydrate({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        // numeric 은 드라이버가 문자열로 줄 수 있다.
        weight: Number(r.weight),
        displayOrder: r.display_order,
      }),
    )
  }

  async findCandidates(pollId: string): Promise<Candidate[]> {
    const { data, error } = await this.db
      .from('candidates')
      .select('id, slug, name, description, thumbnail_url, platform, display_order')
      .eq('poll_id', pollId)
      .order('display_order', { ascending: true })
      .returns<CandidateRow[]>()

    if (error) throw error
    return (data ?? []).map((r) =>
      Candidate.rehydrate({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        thumbnailUrl: r.thumbnail_url,
        platform: r.platform,
        displayOrder: r.display_order,
      }),
    )
  }

  async saveStatus(poll: Poll): Promise<void> {
    const patch: Record<string, unknown> = { status: poll.status }
    if (poll.status === 'OPEN') patch['opened_at'] = new Date().toISOString()
    if (poll.status === 'CLOSED') patch['closed_at'] = new Date().toISOString()

    const { error } = await this.db.from('polls').update(patch).eq('id', poll.id)
    if (error) throw error
  }
}
