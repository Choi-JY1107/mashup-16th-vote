import type { SupabaseClient } from '@supabase/supabase-js'
import { revealStateSchema, type Platform, type RevealState } from '@vote/contract'
import { DomainErrors } from '../../../shared/kernel/domain-error.js'
import { Err, Ok, type Result } from '../../../shared/kernel/result.js'
import { Candidate } from '../domain/candidate.js'
import { Criterion } from '../domain/criterion.js'
import type { RevealPort } from '../domain/ports.js'
import type { RankedCandidate } from '../domain/ranking-policy.js'
import {
  isFrozen,
  projectRevealState,
  revealScriptOf,
  type RevealSnapshot,
} from '../domain/reveal-projection.js'

interface RevealRow {
  poll_id: string
  revealed_steps: number
  total_steps: number
  total_cells: number
  total_ranks: number
  payload: unknown
  updated_at: string
}

const COLUMNS =
  'poll_id, revealed_steps, total_steps, total_cells, total_ranks, payload, updated_at'

/**
 * 커서는 컬럼에, 그 커서로 투영한 화면은 payload 에 들어 있다.
 * 계약 스키마로 한 번에 검증해서, 형식이 어긋난 payload 가 시상식 화면까지 흘러가지 않게 한다.
 */
const toDomain = (r: RevealRow): RevealState =>
  revealStateSchema.parse({
    ...(typeof r.payload === 'object' && r.payload !== null ? r.payload : {}),
    pollId: r.poll_id,
    revealedSteps: r.revealed_steps,
    totalSteps: r.total_steps,
    totalCells: r.total_cells,
    totalRanks: r.total_ranks,
    updatedAt: new Date(r.updated_at).toISOString(),
  })

const rowOf = (pollId: string, state: RevealState) => ({
  poll_id: pollId,
  revealed_steps: state.revealedSteps,
  total_steps: state.totalSteps,
  total_cells: state.totalCells,
  total_ranks: state.totalRanks,
  payload: state,
  updated_at: state.updatedAt,
})

/**
 * 공개 상태를 Supabase 에 보관한다.
 *
 * 화면 계산은 DB 함수가 아니라 domain/reveal-projection.ts 에서 한다. 규칙이 SQL 과
 * TypeScript 두 곳에 있으면 한쪽만 고치게 되고, 검증도 한쪽에만 걸린다.
 * payload 를 누가 만들었는지는 Realtime 이 신경 쓰지 않으므로 공개 중 READ 0건은 그대로다.
 *
 * 동시 클릭은 조건부 UPDATE(compare-and-swap)로 막는다. `where revealed_steps = <읽은 값>`
 * 이 안 맞으면 그 사이 누가 눌렀다는 뜻이고, 그때는 남의 결과를 그대로 돌려준다.
 * 사회자가 두 번 눌러도 한 단계만 움직인다.
 */
export class SupabaseRevealAdapter implements RevealPort {
  constructor(private readonly db: SupabaseClient) {}

  async initialize(pollId: string): Promise<void> {
    const snapshot = await this.snapshot(pollId)
    if (!isFrozen(snapshot)) return

    const state = this.project(pollId, snapshot, 0)
    // 이미 공개가 진행된 판을 0으로 되돌리지 않는다.
    const { error } = await this.db
      .from('reveal_state')
      .upsert(rowOf(pollId, state), { onConflict: 'poll_id', ignoreDuplicates: true })

    if (error) throw error
  }

  async advance(pollId: string): Promise<Result<RevealState>> {
    const snapshot = await this.snapshot(pollId)
    if (!isFrozen(snapshot)) return Err(DomainErrors.resultsNotFrozen())

    const totalSteps = revealScriptOf(snapshot).steps.length

    // 커서를 읽기 전에 행이 있어야 한다. 마감을 거쳤으면 이미 있다.
    await this.initialize(pollId)

    const current = await this.readCursor(pollId)
    if (current === null) return Err(DomainErrors.notFound('공개 상태'))
    if (current >= totalSteps) return Err(DomainErrors.revealExhausted())

    const next = this.project(pollId, snapshot, current + 1)

    const { data, error } = await this.db
      .from('reveal_state')
      .update(rowOf(pollId, next))
      .eq('poll_id', pollId)
      // 이 사이에 누가 눌렀으면 여기서 어긋나 0행이 된다.
      .eq('revealed_steps', current)
      .select(COLUMNS)

    if (error) throw error

    const updated = (data ?? []) as RevealRow[]
    if (updated.length > 0) return Ok(toDomain(updated[0]!))

    // 경합에서 밀렸다. 이미 반영된 상태를 그대로 돌려준다 — 두 번 눌러도 한 단계다.
    const latest = await this.getState(pollId)
    return latest === null ? Err(DomainErrors.revealExhausted()) : Ok(latest)
  }

  async getState(pollId: string): Promise<RevealState | null> {
    const { data, error } = await this.db
      .from('reveal_state')
      .select(COLUMNS)
      .eq('poll_id', pollId)
      .maybeSingle<RevealRow>()

    if (error) throw error
    return data === null ? null : toDomain(data)
  }

  private project(
    pollId: string,
    snapshot: RevealSnapshot,
    revealedSteps: number,
  ): RevealState {
    return projectRevealState({ pollId, snapshot, revealedSteps, updatedAt: new Date() })
  }

  private async readCursor(pollId: string): Promise<number | null> {
    const { data, error } = await this.db
      .from('reveal_state')
      .select('revealed_steps')
      .eq('poll_id', pollId)
      .maybeSingle<{ revealed_steps: number }>()

    if (error) throw error
    return data === null ? null : data.revealed_steps
  }

  /** 마감 시점에 확정된 것들. 인메모리 어댑터는 같은 것을 스토어에서 읽는다. */
  private async snapshot(pollId: string): Promise<RevealSnapshot> {
    const [criteria, candidates, ranked] = await Promise.all([
      this.loadCriteria(pollId),
      this.loadCandidates(pollId),
      this.loadResults(pollId),
    ])
    return { criteria, candidates, ranked }
  }

  private async loadCriteria(pollId: string): Promise<Criterion[]> {
    interface Row {
      id: string
      key: string
      name: string
      description: string
      weight: number
      display_order: number
    }

    const { data, error } = await this.db
      .from('criteria')
      .select('id, key, name, description, weight, display_order')
      .eq('poll_id', pollId)
      .order('display_order')
      .returns<Row[]>()

    if (error) throw error
    return (data ?? []).map((r) =>
      Criterion.rehydrate({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        weight: Number(r.weight),
        displayOrder: r.display_order,
      }),
    )
  }

  private async loadCandidates(pollId: string): Promise<Candidate[]> {
    interface Row {
      id: string
      slug: string
      name: string
      description: string
      thumbnail_url: string | null
      platform: Platform | null
      display_order: number
    }

    const { data, error } = await this.db
      .from('candidates')
      .select('id, slug, name, description, thumbnail_url, platform, display_order')
      .eq('poll_id', pollId)
      .order('display_order')
      .returns<Row[]>()

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

  private async loadResults(pollId: string): Promise<RankedCandidate[]> {
    interface Row {
      candidate_id: string
      rank: number
      normalized_score: number
      per_criterion: Record<string, number>
      voter_count: number
    }

    const { data, error } = await this.db
      .from('poll_results')
      .select('candidate_id, rank, normalized_score, per_criterion, voter_count')
      .eq('poll_id', pollId)
      .order('rank')
      .returns<Row[]>()

    if (error) throw error
    return (data ?? []).map((r) => ({
      candidateId: r.candidate_id,
      rank: r.rank,
      normalizedScore: Number(r.normalized_score),
      perCriterion: r.per_criterion,
      voterCount: r.voter_count,
    }))
  }
}
