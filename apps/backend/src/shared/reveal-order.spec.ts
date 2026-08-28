import { buildRevealScript, finalizedAt, openedCells, rowOrderAt } from '@vote/contract'
import { describe, expect, it } from 'vitest'

/**
 * 공개 대본 규칙. 클릭 한 번은 셋 중 정확히 하나를 한다.
 *
 *   OPEN    화면 맨 아래(순서상 마지막) 미확정 팀의 다음 칸을 연다. 행은 안 움직인다.
 *   SETTLE  총점을 반영해 행 순서를 다시 매긴다. 순서가 실제로 바뀔 때만 들어간다.
 *   RANK    화면 맨 아래 미확정 팀에 열 칸이 없을 때 그 팀의 등수를 박는다.
 */

const columns = (keys: readonly string[]) =>
  keys.map((key, i) => ({ key, displayOrder: i + 1, weight: 1 }))

const team = (
  id: string,
  displayOrder: number,
  scores: readonly number[],
  keys: readonly string[],
) => ({
  candidateId: id,
  displayOrder,
  perCriterion: Object.fromEntries(keys.map((k, i) => [k, scores[i]!])),
})

const label = (script: ReturnType<typeof buildRevealScript>) =>
  script.steps.map((s) => {
    if (s.kind === 'OPEN') return `${s.cell!.candidateId}${s.cell!.criterionKey}`
    if (s.kind === 'RANK') return `RANK:${s.finalized.at(-1)}`
    return 'SETTLE'
  })

/** 각 단계 직전의 상태. 0단계 직전은 대본의 시작 상태다. */
const before = (script: ReturnType<typeof buildRevealScript>, i: number) =>
  i === 0
    ? { rowOrder: script.initialRowOrder, finalized: [] as readonly string[] }
    : script.steps[i - 1]!

describe('buildRevealScript', () => {
  it('OPEN 은 팀 수 × 항목 수, RANK 는 팀 수만큼이다', () => {
    const keys = ['a', 'b', 'c', 'd']
    const teams = Array.from({ length: 6 }, (_, i) =>
      team(`t${i}`, i + 1, [1, 2, 3, 4], keys),
    )
    const script = buildRevealScript(teams, columns(keys))

    expect(script.totalCells).toBe(24)
    expect(script.steps.filter((s) => s.kind === 'OPEN')).toHaveLength(24)
    expect(script.steps.filter((s) => s.kind === 'RANK')).toHaveLength(6)
  })

  it('점수 공개 · 행 이동 · 등수 공개가 각각 별개의 단계다', () => {
    const keys = ['a', 'b']
    // B 는 첫 칸에서 100점을 받아 A 위로 올라간다 → 그 이동이 SETTLE 로 분리된다.
    const script = buildRevealScript(
      [team('A', 1, [1, 1], keys), team('B', 2, [100, 100], keys)],
      columns(keys),
    )

    expect(label(script)).toEqual([
      'Ba', // 동점(0)이면 displayOrder 큰 쪽이 맨 아래
      'SETTLE', // B 가 A 위로 올라간다
      'Aa', // 이제 A 가 맨 아래. 1점을 받아도 순서는 그대로다
      'Ab', // 그래서 SETTLE 이 없다 — 빈 클릭을 만들지 않는다
      'RANK:A', // A 에 열 칸이 없어졌다. 이 클릭이 A 의 등수를 박는다
      'Bb', // 맨 아래는 이제 B
      'RANK:B', // 마지막 클릭에 1위가 나온다
    ])
  })

  it('마지막 칸이 열리는 클릭에 등수가 같이 나오지 않는다', () => {
    const keys = ['a', 'b']
    const script = buildRevealScript(
      [team('A', 1, [1, 1], keys), team('B', 2, [100, 100], keys)],
      columns(keys),
    )

    script.steps.forEach((step, i) => {
      if (step.kind !== 'OPEN') return
      // 칸을 여는 클릭은 등수를 건드리지 않는다
      expect(step.finalized, `${i}단계 OPEN`).toEqual(before(script, i).finalized)
    })
  })

  it('한 단계가 한 가지만 바꾼다', () => {
    const keys = ['a', 'b', 'c', 'd']
    const teams = [
      team('t1', 1, [3, 30, 2, 1], keys),
      team('t2', 2, [28, 1, 1, 40], keys),
      team('t3', 3, [12, 12, 12, 12], keys),
      team('t4', 4, [1, 1, 1, 90], keys),
      team('t5', 5, [20, 5, 20, 5], keys),
      team('t6', 6, [7, 7, 40, 7], keys),
    ]
    const script = buildRevealScript(teams, columns(keys))

    script.steps.forEach((step, i) => {
      const prev = before(script, i)
      const moved = step.rowOrder.join('>') !== prev.rowOrder.join('>')
      const ranked = step.finalized.length - prev.finalized.length

      if (step.kind === 'OPEN') {
        expect(moved, `${i}단계 OPEN 이 행을 움직였다`).toBe(false)
        expect(ranked, `${i}단계 OPEN 이 등수를 박았다`).toBe(0)
      } else if (step.kind === 'SETTLE') {
        // SETTLE 은 반드시 순서를 바꾼다. 안 바꾸면 빈 클릭이다.
        expect(moved, `${i}단계 SETTLE 이 아무것도 안 바꿨다`).toBe(true)
        expect(ranked, `${i}단계 SETTLE 이 등수를 박았다`).toBe(0)
      } else {
        expect(moved, `${i}단계 RANK 가 행을 움직였다`).toBe(false)
        expect(ranked, `${i}단계 RANK`).toBe(1)
      }
    })
  })

  it('SETTLE 은 항상 OPEN 바로 뒤에만 온다', () => {
    const keys = ['a', 'b']
    const script = buildRevealScript(
      [
        team('x', 1, [5, 5], keys),
        team('y', 2, [5, 5], keys),
        team('z', 3, [5, 5], keys),
      ],
      columns(keys),
    )

    script.steps.forEach((step, i) => {
      if (step.kind !== 'SETTLE') return
      expect(script.steps[i - 1]?.kind, `${i}단계 SETTLE 앞`).toBe('OPEN')
    })
  })

  it('전원 동점이면 RANK 가 연달아 나온다 (공동 1위 발표)', () => {
    const keys = ['a', 'b']
    const script = buildRevealScript(
      [
        team('x', 1, [5, 5], keys),
        team('y', 2, [5, 5], keys),
        team('z', 3, [5, 5], keys),
      ],
      columns(keys),
    )

    // 다 같은 점수라 세 팀이 동시에 꽉 찬다. 그 뒤 세 클릭이 각각 한 팀씩 발표한다.
    // 빈 클릭은 아니다 — 클릭마다 등수 하나가 새로 뜬다.
    expect(label(script).slice(-3)).toEqual(['RANK:z', 'RANK:y', 'RANK:x'])
  })

  it('여는 팀 · 등수 박는 팀은 그 시점 화면의 맨 아래 미확정 팀이다', () => {
    const keys = ['a', 'b', 'c']
    const teams = [
      team('t1', 1, [3, 30, 2], keys),
      team('t2', 2, [28, 1, 1], keys),
      team('t3', 3, [12, 12, 12], keys),
      team('t4', 4, [1, 1, 90], keys),
    ]
    const script = buildRevealScript(teams, columns(keys))
    const opened = new Map(teams.map((t) => [t.candidateId, 0]))

    script.steps.forEach((step, i) => {
      if (step.kind === 'SETTLE') return
      const prev = before(script, i)
      const done = new Set(prev.finalized)
      const bottom = [...prev.rowOrder].reverse().find((id) => !done.has(id))

      if (step.kind === 'RANK') {
        expect(step.finalized.at(-1), `${i}단계 RANK`).toBe(bottom)
        // 등수는 그 팀의 칸이 전부 열린 뒤에만 박힌다
        expect(opened.get(bottom!)).toBe(keys.length)
        return
      }

      expect(step.cell!.candidateId, `${i}단계 OPEN`).toBe(bottom)
      // 한 팀 안에서는 표시 순서대로 열린다
      expect(step.cell!.criterionKey).toBe(keys[opened.get(bottom!)!])
      opened.set(bottom!, opened.get(bottom!)! + 1)
    })
  })

  it('확정은 아래에서 위로 올라오고, 1위가 마지막 단계다', () => {
    const keys = ['a', 'b']
    const teams = [
      team('low', 1, [1, 1], keys),
      team('mid', 2, [10, 10], keys),
      team('top', 3, [50, 50], keys),
    ]
    const script = buildRevealScript(teams, columns(keys))

    expect(script.steps.at(-1)?.kind).toBe('RANK')
    expect(script.steps.at(-1)?.finalized).toEqual(['low', 'mid', 'top'])
  })

  it('시작 순서는 displayOrder 오름차순 (총점이 전부 0)', () => {
    const keys = ['a']
    const script = buildRevealScript(
      [team('c', 3, [1], keys), team('a', 1, [1], keys), team('b', 2, [1], keys)],
      columns(keys),
    )

    expect(script.initialRowOrder).toEqual(['a', 'b', 'c'])
  })

  it('입력 순서가 달라도 결과가 같다 (재현 가능)', () => {
    const keys = ['a', 'b']
    const teams = [
      team('x', 1, [7, 3], keys),
      team('y', 2, [4, 9], keys),
      team('z', 3, [1, 1], keys),
    ]

    expect(buildRevealScript(teams, columns(keys))).toEqual(
      buildRevealScript([...teams].reverse(), columns(keys)),
    )
  })

  it('항목이나 팀이 없으면 빈 대본이다', () => {
    expect(buildRevealScript([], columns(['a'])).steps).toEqual([])
    expect(buildRevealScript([team('a', 1, [1], ['a'])], []).steps).toEqual([])
  })
})

describe('커서 투영', () => {
  const keys = ['a', 'b']
  // 대본: Ba, SETTLE, Aa, Ab, RANK:A, Bb, RANK:B
  const script = buildRevealScript(
    [team('A', 1, [1, 1], keys), team('B', 2, [100, 100], keys)],
    columns(keys),
  )

  it('openedCells 는 커서 이전의 OPEN 만 모은다', () => {
    expect(openedCells(script, 0)).toEqual([])
    // 0: OPEN Ba, 1: SETTLE → 커서 2 에서도 열린 칸은 1개다
    expect(openedCells(script, 2)).toEqual([{ candidateId: 'B', criterionKey: 'a' }])
    expect(openedCells(script, script.steps.length)).toHaveLength(4)
  })

  it('rowOrderAt 은 커서 0 에서 시작 순서를 준다', () => {
    expect(rowOrderAt(script, 0)).toEqual(script.initialRowOrder)
    expect(rowOrderAt(script, -5)).toEqual(script.initialRowOrder)
    // 커서를 넘겨 잡아도 마지막 순서로 고정된다
    expect(rowOrderAt(script, 999)).toEqual(script.steps.at(-1)!.rowOrder)
  })

  it('finalizedAt 은 커서 시점의 확정 팀을 확정 순서로 준다', () => {
    expect(finalizedAt(script, 0)).toEqual([])
    // A 의 칸 2개가 다 열린 뒤(커서 4)에도 아직 등수는 안 박혔다
    expect(finalizedAt(script, 4)).toEqual([])
    // 5번째 클릭(RANK:A)이 지나야 박힌다
    expect(finalizedAt(script, 5)).toEqual(['A'])
    expect(finalizedAt(script, 999)).toEqual(['A', 'B'])
  })
})
