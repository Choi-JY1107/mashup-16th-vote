import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public'
import { revealStateSchema, type RevealState } from '@vote/contract'
import { fetchRevealState } from './api'

interface RevealRow {
  poll_id: string
  revealed_steps: number
  total_steps: number
  total_cells: number
  total_ranks: number
  payload: unknown
  updated_at: string
}

/**
 * 커서는 컬럼에, 그 커서로 투영한 화면은 payload 에 들어 있다.
 * 계약 스키마로 한 번에 검증한다 — 형식이 어긋난 payload 가 시상식 화면에 닿으면 안 된다.
 */
const toState = (row: RevealRow): RevealState =>
  revealStateSchema.parse({
    ...(typeof row.payload === 'object' && row.payload !== null ? row.payload : {}),
    pollId: row.poll_id,
    revealedSteps: row.revealed_steps,
    totalSteps: row.total_steps,
    totalCells: row.total_cells,
    totalRanks: row.total_ranks,
    updatedAt: new Date(row.updated_at).toISOString(),
  })

/** Supabase 설정이 비어 있으면 로컬 데모 모드로 본다. */
const configured = PUBLIC_SUPABASE_URL !== '' && PUBLIC_SUPABASE_ANON_KEY !== ''

export type RevealStatus = 'connecting' | 'live' | 'polling' | 'error'

/**
 * 순위 공개를 구독한다.
 *
 * 브로드캐스트 payload 에 공개된 순위 전체가 실려 오므로 콜백에서 서버를 다시 부르지 않는다.
 * 관객이 100명이든 500명이든 공개 순간의 API 요청은 0건이다.
 *
 * Supabase 가 설정되지 않은 로컬 데모에서는 폴링으로 대체한다.
 * 폴링은 관객 수만큼 요청이 곱해지므로 프로덕션 경로가 아니다.
 */
export function subscribeReveal(
  pollId: string,
  onChange: (revealState: RevealState) => void,
  onStatus?: (status: RevealStatus) => void,
): () => void {
  onStatus?.('connecting')

  if (!configured) {
    onStatus?.('polling')
    let stopped = false
    const timer = setInterval(() => {
      if (stopped) return
      fetchRevealState(pollId)
        .then(onChange)
        .catch(() => {})
    }, 1500)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  // anon 키는 RLS 정책상 reveal_state SELECT 권한만 가진다.
  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 5 } },
  })

  const channel = supabase
    .channel(`reveal:${pollId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reveal_state',
        filter: `poll_id=eq.${pollId}`,
      },
      (message) => {
        const row = message.new as RevealRow | undefined
        if (row === undefined || row.poll_id === undefined) return
        try {
          onChange(toState(row))
        } catch {
          // 스키마가 안 맞는 payload 는 무시한다. 시상식 중에 화면이 죽는 것이 최악이다.
          onStatus?.('error')
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus?.('live')
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('error')
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}
