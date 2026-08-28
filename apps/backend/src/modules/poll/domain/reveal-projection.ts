import {
  buildRevealScript,
  byColumn,
  finalizedAt,
  openedCells,
  rowOrderAt,
  type RevealAction,
  type RevealScript,
  type RevealState,
} from '@vote/contract'
import type { Candidate } from './candidate.js'
import type { Criterion } from './criterion.js'
import type { RankedCandidate } from './ranking-policy.js'

/**
 * 커서 하나(진행된 단계 수)로 시상식 화면 전체를 만든다.
 *
 * 순수 계산이다. 같은 스냅샷 + 같은 커서면 언제 어디서 계산해도 같은 화면이 나온다.
 * 그래서 새로고침해도, Realtime payload 로 받아도, 인메모리로 돌려도 결과가 같다.
 *
 * 이 계산이 DB 함수가 아니라 코드에 있는 이유:
 * 예전에는 plpgsql 의 reveal_script() 가 같은 규칙을 두 번째로 구현하고 있었다.
 * 규칙이 두 곳에 있으면 한쪽만 고치게 되고, 검증은 한쪽에만 걸린다.
 * payload 를 누가 만드는지는 Realtime 과 무관하다 — Realtime 은 reveal_state 행이
 * 바뀌면 그 행을 브로드캐스트할 뿐이다. 그래서 공개 중 READ 0건은 그대로 유지된다.
 */

/** 마감 시점에 확정된 것들. 공개 계산에 필요한 입력 전부다. */
export interface RevealSnapshot {
  readonly candidates: readonly Candidate[]
  readonly criteria: readonly Criterion[]
  readonly ranked: readonly RankedCandidate[]
}

/** 집계가 확정되지 않았으면 공개할 것이 없다. */
export const isFrozen = (snapshot: RevealSnapshot): boolean =>
  snapshot.ranked.length > 0 && snapshot.criteria.length > 0

/** 공개 대본. 규칙은 @vote/contract 한 곳에만 있다. */
export function revealScriptOf(snapshot: RevealSnapshot): RevealScript {
  const orderOf = new Map(snapshot.candidates.map((c) => [c.id, c.displayOrder]))

  return buildRevealScript(
    snapshot.ranked.map((r) => ({
      candidateId: r.candidateId,
      // 동점일 때 어느 행이 위인지 가르는 기준
      displayOrder: orderOf.get(r.candidateId) ?? 0,
      perCriterion: r.perCriterion,
    })),
    [...snapshot.criteria].sort(byColumn),
  )
}

export function projectRevealState(input: {
  pollId: string
  snapshot: RevealSnapshot
  revealedSteps: number
  updatedAt: Date
}): RevealState {
  const { pollId, snapshot, updatedAt } = input
  const columns = [...snapshot.criteria].sort(byColumn)
  const meta = new Map(snapshot.candidates.map((c) => [c.id, c]))
  const resultOf = new Map(snapshot.ranked.map((r) => [r.candidateId, r]))

  const script = revealScriptOf(snapshot)
  const cursor = Math.min(Math.max(input.revealedSteps, 0), script.steps.length)

  const refs = openedCells(script, cursor)
  const nextStep = script.steps[cursor] ?? null
  const nextAction: RevealAction = nextStep === null ? 'NONE' : nextStep.kind

  return {
    pollId,
    totalRanks:
      snapshot.ranked.length === 0 ? 0 : Math.max(...snapshot.ranked.map((r) => r.rank)),
    totalCells: script.totalCells,
    revealedCells: refs.length,
    totalSteps: script.steps.length,
    revealedSteps: cursor,
    nextAction,
    criteria: columns.map((c) => ({ key: c.key, name: c.name, weight: c.weight })),

    // 표의 행은 마감 시점에 결정된다. 화면 순서는 rowOrder 가 따로 정한다.
    teams: snapshot.ranked
      .map((r) => {
        const c = meta.get(r.candidateId)
        return {
          candidateId: r.candidateId,
          candidateName: c?.name ?? r.candidateId,
          candidateSlug: c?.slug ?? r.candidateId,
          platform: c?.platform ?? null,
          displayOrder: c?.displayOrder ?? 0,
        }
      })
      .sort((a, b) => a.displayOrder - b.displayOrder),

    rowOrder: [...rowOrderAt(script, cursor)],

    // 열린 칸만. 열린 순서 그대로다.
    cells: refs.map((ref) => ({
      candidateId: ref.candidateId,
      criterionKey: ref.criterionKey,
      score: resultOf.get(ref.candidateId)?.perCriterion[ref.criterionKey] ?? 0,
    })),

    // 등수가 박힌 팀만. 칸이 다 열렸어도 아직 확정 안 된 팀은 여기 없다.
    // 대본이 확정 순서(최하위 → 상위)를 들고 있으므로 그 순서를 그대로 쓴다.
    entries: finalizedAt(script, cursor)
      .map((candidateId) => resultOf.get(candidateId))
      .filter((r): r is RankedCandidate => r !== undefined)
      .map((r) => ({
        rank: r.rank,
        candidateId: r.candidateId,
        candidateName: meta.get(r.candidateId)?.name ?? r.candidateId,
        candidateSlug: meta.get(r.candidateId)?.slug ?? r.candidateId,
        score: Math.round(r.normalizedScore * 100) / 100,
        perCriterion: r.perCriterion,
      })),

    cursor: nextStep?.cell ?? null,
    updatedAt: updatedAt.toISOString(),
  }
}
