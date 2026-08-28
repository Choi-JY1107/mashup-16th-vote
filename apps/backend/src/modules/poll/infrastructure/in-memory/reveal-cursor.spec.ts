import { describe, expect, it } from 'vitest'
import { Candidate } from '../../domain/candidate.js'
import { Criterion } from '../../domain/criterion.js'
import { Poll } from '../../domain/poll.js'
import type { RankedCandidate } from '../../domain/ranking-policy.js'
import { AdvanceRevealUseCase } from '../../application/reveal.usecase.js'
import { InMemoryPollRepository, InMemoryRevealAdapter } from './in-memory.repositories.js'
import { InMemoryStore } from './store.js'

/**
 * 공개 커서 회귀 테스트.
 *
 * 클릭 한 번은 칸 공개(OPEN) · 행 순서 갱신(SETTLE) · 등수 공개(RANK) 중 하나다.
 *
 * 두 가지 불변식을 클릭 단위로 검사한다.
 *   1. 모든 클릭이 화면을 반드시 바꾼다 (빈 클릭 없음)
 *   2. 한 클릭이 두 가지를 같이 하지 않는다
 *
 * 시상식에서 사회자가 눌렀는데 화면이 안 바뀌거나, 마지막 칸이 열리는 순간 등수까지
 * 같이 나와버리는 상황을 구조적으로 막는 것이 목적이다.
 */

const CRITERION_KEYS = ['collaboration', 'completeness', 'ideation', 'presentation']

const criteria = (): Criterion[] =>
  CRITERION_KEYS.map((key, i) =>
    Criterion.rehydrate({
      id: `criterion-${i + 1}`,
      key,
      name: key,
      description: '',
      weight: 1,
      displayOrder: i + 1,
    }),
  )

const ranked = (ranks: readonly number[]): RankedCandidate[] =>
  ranks.map((rank, i) => ({
    candidateId: `team-${i + 1}`,
    rank,
    normalizedScore: 100 - rank,
    // 항목별 점수는 순위에 따라 다르게 준다. 어떤 칸이 열렸는지 값으로 구분할 수 있어야 한다.
    perCriterion: Object.fromEntries(
      CRITERION_KEYS.map((key, j) => [key, 30 - rank - j]),
    ),
    voterCount: 5,
  }))

const setup = (ranks: readonly number[]) => {
  const store = new InMemoryStore()
  const poll = Poll.rehydrate({
    id: 'poll-1',
    title: 't',
    status: 'REVEALING',
    rules: { pointsPerCriterion: 100, excludeOwnTeam: true },
  })
  store.polls.set(poll.id, poll)
  store.candidates.set(
    poll.id,
    ranks.map((_, i) =>
      Candidate.rehydrate({
        id: `team-${i + 1}`,
        slug: `team-${i + 1}`,
        name: `팀${i + 1}`,
        description: '',
        thumbnailUrl: null,
        // 동점일 때 어느 행이 아래인지 가르는 기준이므로 반드시 서로 달라야 한다
        displayOrder: i + 1,
      }),
    ),
  )
  store.criteria.set(poll.id, criteria())
  store.results.set(poll.id, ranked(ranks))

  const adapter = new InMemoryRevealAdapter(store)
  const polls = new InMemoryPollRepository(store)
  return { store, poll, adapter, useCase: new AdvanceRevealUseCase(polls, adapter) }
}

interface Click {
  revealedSteps: number
  revealedCells: number
  rowOrder: string
  /** 이 클릭으로 새로 확정된 순위. 없으면 null */
  finalizedRank: number | null
  nextAction: string
  entryCount: number
}

/** 소진될 때까지 눌러서 클릭별로 무엇이 일어났는지 기록한다. */
const drain = async (ranks: readonly number[]) => {
  const { adapter, poll } = setup(ranks)
  const clicks: Click[] = []
  let previousEntries = 0

  for (let guard = 0; guard < 500; guard += 1) {
    const result = await adapter.advance('poll-1')
    if (!result.ok) {
      return { clicks, finalError: result.error.code, status: poll.status }
    }
    const state = result.value
    const finalized =
      state.entries.length > previousEntries ? (state.entries.at(-1)?.rank ?? null) : null

    clicks.push({
      revealedSteps: state.revealedSteps,
      revealedCells: state.revealedCells,
      rowOrder: state.rowOrder.join('>'),
      finalizedRank: finalized,
      nextAction: state.nextAction,
      entryCount: state.entries.length,
    })
    previousEntries = state.entries.length
  }
  throw new Error('공개가 끝나지 않음')
}

/** 클릭마다 정확히 한 가지가 바뀌었는지 검사한다. */
const assertOneChangePerClick = (clicks: readonly Click[], initialRowOrder: string) => {
  let cells = 0
  let order = initialRowOrder
  let entries = 0

  clicks.forEach((click, i) => {
    const changes = [
      click.revealedCells !== cells,
      click.rowOrder !== order,
      click.entryCount !== entries,
    ].filter(Boolean).length

    expect(changes, `${i + 1}번째 클릭이 바꾼 것의 개수`).toBe(1)

    cells = click.revealedCells
    order = click.rowOrder
    entries = click.entryCount
  })
}

describe('InMemoryRevealAdapter.advance — 3단 공개 커서', () => {
  const initialOrder = async (ranks: readonly number[]) => {
    const { adapter } = setup(ranks)
    await adapter.initialize('poll-1')
    return (await adapter.getState('poll-1'))!.rowOrder.join('>')
  }

  it('모든 클릭이 정확히 한 가지만 바꾼다', async () => {
    const ranks = [1, 2, 3, 4, 5, 6]
    const { clicks, finalError } = await drain(ranks)

    assertOneChangePerClick(clicks, await initialOrder(ranks))
    expect(finalError).toBe('REVEAL_EXHAUSTED')
  })

  it('칸은 팀 수 × 항목 수, 등수는 팀 수만큼 공개된다', async () => {
    const { clicks } = await drain([1, 2, 3, 4, 5, 6])

    expect(clicks.at(-1)?.revealedCells).toBe(24)
    expect(clicks.at(-1)?.entryCount).toBe(6)
    // 칸 24 + 등수 6 은 고정이고, 행 순서 갱신 횟수만 데이터에 따라 달라진다
    expect(clicks.length).toBeGreaterThanOrEqual(30)
  })

  it('마지막 칸이 열리는 클릭에 등수가 같이 나오지 않는다', async () => {
    const { clicks } = await drain([1, 2, 3, 4, 5, 6])

    let cells = 0
    let entries = 0
    for (const [i, click] of clicks.entries()) {
      const openedCell = click.revealedCells !== cells
      const ranked = click.entryCount !== entries
      expect(openedCell && ranked, `${i + 1}번째 클릭에서 둘이 같이 일어났다`).toBe(false)
      cells = click.revealedCells
      entries = click.entryCount
    }
  })

  it('확정 순서는 최하위 → 상위이고 1위가 마지막이다', async () => {
    const { clicks } = await drain([1, 2, 3, 4, 5, 6])

    const finalized = clicks
      .filter((c) => c.finalizedRank !== null)
      .map((c) => c.finalizedRank)
    expect(finalized).toEqual([6, 5, 4, 3, 2, 1])
  })

  it('진행 중인 팀의 순위는 payload 에 담기지 않는다', async () => {
    const { clicks } = await drain([1, 2, 3, 4, 5, 6])

    const firstFinalized = clicks.findIndex((c) => c.finalizedRank !== null)
    expect(firstFinalized).toBeGreaterThanOrEqual(3)
    expect(clicks.slice(0, firstFinalized).every((c) => c.entryCount === 0)).toBe(true)

    // 확정된 팀 수는 줄어들지 않는다
    const counts = clicks.map((c) => c.entryCount)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
  })

  it('마지막 클릭 뒤에만 nextAction 이 NONE 이다', async () => {
    const { clicks } = await drain([1, 2, 3, 4, 5, 6])

    expect(clicks.slice(0, -1).every((c) => c.nextAction !== 'NONE')).toBe(true)
    expect(clicks.at(-1)?.nextAction).toBe('NONE')
  })

  it('동점으로 순위에 구멍이 있어도 빈 클릭이 없고 전원 확정된다', async () => {
    // 3위가 존재하지 않는다
    const ranks = [1, 2, 2, 4, 5, 6]
    const { clicks, finalError } = await drain(ranks)

    assertOneChangePerClick(clicks, await initialOrder(ranks))
    expect(clicks.at(-1)?.revealedCells).toBe(24)
    expect(clicks.filter((c) => c.finalizedRank !== null).map((c) => c.finalizedRank)).toEqual(
      [6, 5, 4, 2, 2, 1],
    )
    expect(finalError).toBe('REVEAL_EXHAUSTED')
  })

  it('전원 동점이어도 빈 클릭 없이 전부 공동 1위로 확정된다', async () => {
    const ranks = [1, 1, 1, 1, 1, 1]
    const { clicks } = await drain(ranks)

    assertOneChangePerClick(clicks, await initialOrder(ranks))
    expect(clicks.at(-1)?.revealedCells).toBe(24)
    expect(clicks.filter((c) => c.finalizedRank !== null).map((c) => c.finalizedRank)).toEqual(
      [1, 1, 1, 1, 1, 1],
    )
  })

  it('한 팀을 몰아서 열지 않고 매 칸마다 맨 아래 팀으로 옮겨간다', async () => {
    const { adapter } = setup([1, 2, 3, 4, 5, 6])
    // 첫 6칸이 열릴 때까지 누른다 (사이에 행 순서 갱신 클릭이 끼어든다)
    for (let i = 0; i < 40; i += 1) {
      const state = await adapter.getState('poll-1')
      if ((state?.revealedCells ?? 0) >= 6) break
      await adapter.advance('poll-1')
    }

    const state = await adapter.getState('poll-1')
    const ids = state?.cells.map((c) => c.candidateId) ?? []

    expect(ids).toHaveLength(6)
    // 6칸이 열렸는데 같은 팀이 두 번 나오지 않는다
    expect(new Set(ids).size).toBe(6)
    // 첫 칸은 총점 동점(0)에서 displayOrder 가 가장 큰 팀 = 화면 맨 아래
    expect(ids[0]).toBe('team-6')
    // 아직 아무도 4칸을 채우지 못했으므로 확정된 팀이 없다
    expect(state?.entries).toEqual([])
  })

  it('항목이 없으면 거부한다', async () => {
    const { adapter, store } = setup([1, 2])
    store.criteria.delete('poll-1')

    const result = await adapter.advance('poll-1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('RESULTS_NOT_FROZEN')
  })

  it('집계가 확정되지 않았으면 거부한다', async () => {
    const { adapter, store } = setup([1, 2])
    store.results.delete('poll-1')

    const result = await adapter.advance('poll-1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('RESULTS_NOT_FROZEN')
  })

  it('initialize 는 한 단계도 진행되지 않은 빈 표를 만든다', async () => {
    const { adapter } = setup([1, 2, 3, 4, 5, 6])
    await adapter.initialize('poll-1')

    const state = await adapter.getState('poll-1')
    expect(state?.revealedSteps).toBe(0)
    expect(state?.revealedCells).toBe(0)
    expect(state?.totalCells).toBe(24)
    expect(state?.totalSteps).toBeGreaterThanOrEqual(30)
    expect(state?.cells).toEqual([])
    expect(state?.entries).toEqual([])
    // 표의 뼈대(행·열)는 처음부터 있어야 한다
    expect(state?.criteria).toHaveLength(4)
    expect(state?.teams).toHaveLength(6)
    // 시작 순서는 displayOrder 오름차순
    expect(state?.rowOrder).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
      'team-5',
      'team-6',
    ])
    expect(state?.nextAction).toBe('OPEN')
  })
})

/**
 * 상태 전이는 Poll 엔티티의 규칙이고, 유즈케이스가 그것을 집행한다.
 * 예전에는 DB 함수 advance_reveal() 안에도 같은 검사가 있었다.
 */
describe('AdvanceRevealUseCase — 상태 전이', () => {
  it('REVEALING 상태가 아니면 거부한다', async () => {
    const { useCase, store } = setup([1, 2])
    store.polls.set(
      'poll-1',
      Poll.rehydrate({
        id: 'poll-1',
        title: 't',
        status: 'OPEN',
        rules: { pointsPerCriterion: 100, excludeOwnTeam: true },
      }),
    )

    const result = await useCase.execute({ pollId: 'poll-1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('POLL_NOT_REVEALING')
  })

  it('투표가 없으면 거부한다', async () => {
    const { useCase, store } = setup([1, 2])
    store.polls.delete('poll-1')

    const result = await useCase.execute({ pollId: 'poll-1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('마지막 클릭에 FINISHED 로 넘어가고, 그 뒤로는 거부한다', async () => {
    const { useCase, poll } = setup([1, 2, 3, 4, 5, 6])

    for (let guard = 0; guard < 500; guard += 1) {
      const result = await useCase.execute({ pollId: 'poll-1' })
      if (!result.ok) break
      // 끝나기 전까지는 REVEALING 이어야 한다
      if (result.value.nextAction !== 'NONE') expect(poll.status).toBe('REVEALING')
    }

    expect(poll.status).toBe('FINISHED')

    // 종료된 뒤에는 커서 소진이 아니라 상태로 막힌다
    const after = await useCase.execute({ pollId: 'poll-1' })
    expect(after.ok).toBe(false)
    if (after.ok) return
    expect(after.error.code).toBe('POLL_NOT_REVEALING')
  })
})
