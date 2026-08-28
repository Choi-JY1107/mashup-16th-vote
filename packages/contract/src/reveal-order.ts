/**
 * 공개 대본(script).
 *
 * 프로그래밍 대회 리졸버 방식이다. 클릭 한 번은 아래 세 가지 중 정확히 하나를 한다.
 *
 *   OPEN    화면 맨 아래 팀의 다음 칸을 열어 점수를 보여준다. 행은 움직이지 않는다.
 *   SETTLE  올라간 총점을 반영해 순서를 다시 매긴다. 이때 행이 점프한다.
 *   RANK    화면 맨 아래 팀의 등수를 박는다. 칸도 순서도 그대로다.
 *
 * 한 클릭에 두 가지가 같이 일어나지 않는다. 점수를 보여주고, "이제 어디로 가나"를
 * 한 번 더 눌러 만들고, "그래서 몇 위"를 또 한 번 눌러 만든다.
 *
 * ── 루프 ───────────────────────────────────────────────────
 *
 * 매번 화면 맨 아래에서 아직 등수가 안 박힌 팀을 본다.
 *
 *   그 팀에 열 칸이 남아 있으면  → 한 칸 열고(OPEN), 순서가 바뀌면 SETTLE
 *   그 팀에 열 칸이 없으면        → 등수를 박는다(RANK)
 *
 * 판단이 먼저이고 등수 박기가 그 결과다. "칸을 열었더니 그 팀이 다 열렸네"로 등수를
 * 박으면 마지막 칸이 열리는 클릭에 등수까지 같이 나와버린다.
 *
 * 맨 아래 팀에 열 칸이 없다면 그 팀의 총점은 확정이고 위에 있는 팀들은 총점이 더
 * 오를 수만 있다. 그러니 그 팀이 남은 팀 중 최하위임이 확정된다. 확정은 항상 아래에서
 * 위로 올라오고, 1위는 마지막 클릭에 나온다.
 *
 * 커서는 정수 하나(진행된 단계 수)다. 이 계산이 결정적이므로 커서만 있으면 언제든
 * 같은 화면을 복원할 수 있다.
 *
 * 서버(공개의 진실 공급원)와 /live/mock(연출 미리보기)이 같은 함수를 써야 하므로
 * 도메인이 아니라 공유 패키지에 둔다. **이 규칙의 구현은 이 파일 하나뿐이다.**
 * 예전에는 plpgsql 이 같은 규칙을 두 번째로 구현하고 있었는데, 규칙이 두 곳에 있으면
 * 한쪽만 고치게 되고 검증도 한쪽에만 걸려서 코드로 걷어냈다.
 */

export interface RevealOrderTeam {
  readonly candidateId: string
  /** 동점일 때 어느 행이 위인지 가르는 기준 */
  readonly displayOrder: number
  /** criterion.key → 평가자 1인당 평균 점수 */
  readonly perCriterion: Record<string, number>
}

export interface RevealOrderColumn {
  readonly key: string
  readonly displayOrder: number
  readonly weight: number
}

export interface RevealCellRef {
  readonly candidateId: string
  readonly criterionKey: string
}

export const REVEAL_STEP_KINDS = ['OPEN', 'SETTLE', 'RANK'] as const
export type RevealStepKind = (typeof REVEAL_STEP_KINDS)[number]

export interface RevealScriptStep {
  readonly kind: RevealStepKind
  /** OPEN 일 때만 채워진다. */
  readonly cell: RevealCellRef | null
  /** 이 단계가 끝난 뒤 화면에 표시될 행 순서 (위 → 아래). */
  readonly rowOrder: readonly string[]
  /**
   * 이 단계가 끝난 뒤 등수가 확정된 팀. 확정된 순서(최하위 → 상위)로 쌓인다.
   *
   * 누적값이다. 커서만으로 화면을 복원해야 하므로 "지금까지 전부"를 들고 있어야 한다.
   */
  readonly finalized: readonly string[]
}

export interface RevealScript {
  /** 한 단계도 진행되지 않은 상태의 행 순서. */
  readonly initialRowOrder: readonly string[]
  readonly steps: readonly RevealScriptStep[]
  /** 열어야 할 칸 수 = 팀 수 × 항목 수. 단계 수와 다르다. */
  readonly totalCells: number
}

/** 표의 열 순서. 한 팀 안에서 칸은 이 순서로 열린다. */
export const byColumn = (a: RevealOrderColumn, b: RevealOrderColumn): number =>
  a.displayOrder - b.displayOrder || a.key.localeCompare(b.key)

// 부동소수 누적 오차로 동점 판정이 흔들리면 순서가 달라진다. 매 단계에서 자른다.
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4

interface BoardRow {
  candidateId: string
  displayOrder: number
  perCriterion: Record<string, number>
  opened: number
  total: number
}

/** 화면 순서 = 공개된 총점 내림차순, 동점은 displayOrder 오름차순. */
const sortRows = (board: readonly BoardRow[]): string[] =>
  [...board]
    .sort((a, b) => b.total - a.total || a.displayOrder - b.displayOrder)
    .map((row) => row.candidateId)

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i])

/**
 * 공개 대본을 만든다.
 *
 * OPEN 은 항상 팀 수 × 항목 수개, RANK 는 항상 팀 수개다.
 * SETTLE 개수만 데이터에 따라 달라진다 (0 ~ 칸 수).
 */
export function buildRevealScript(
  teams: readonly RevealOrderTeam[],
  criteria: readonly RevealOrderColumn[],
): RevealScript {
  const columns = [...criteria].sort(byColumn)
  const totalCells = teams.length * columns.length

  if (columns.length === 0 || teams.length === 0) {
    return { initialRowOrder: [], steps: [], totalCells: 0 }
  }

  const board: BoardRow[] = teams.map((team) => ({
    candidateId: team.candidateId,
    displayOrder: team.displayOrder,
    perCriterion: team.perCriterion,
    opened: 0,
    total: 0,
  }))
  const byId = new Map(board.map((row) => [row.candidateId, row]))

  const initialRowOrder = sortRows(board)
  let rowOrder = initialRowOrder
  const steps: RevealScriptStep[] = []

  // 등수가 박힌 팀. 확정 순서(최하위 → 상위)를 그대로 유지한다.
  const finalized: string[] = []
  const isFinalized = new Set<string>()

  /** 화면 맨 아래부터 올라오며, 아직 등수가 안 박힌 첫 팀. */
  const bottomRow = (): BoardRow | undefined => {
    for (let i = rowOrder.length - 1; i >= 0; i -= 1) {
      const row = byId.get(rowOrder[i]!)
      if (row !== undefined && !isFinalized.has(row.candidateId)) return row
    }
    return undefined
  }

  // 한 바퀴에 칸 하나를 열거나 등수 하나를 박는다. 그래서 최대 (칸 수 + 팀 수) 바퀴다.
  const maxRounds = totalCells + board.length
  for (let round = 0; round < maxRounds; round += 1) {
    const bottom = bottomRow()
    if (bottom === undefined) break

    // 맨 아래 팀에 열 칸이 없다 → 이 클릭은 등수를 박는다.
    if (bottom.opened >= columns.length) {
      finalized.push(bottom.candidateId)
      isFinalized.add(bottom.candidateId)
      steps.push({ kind: 'RANK', cell: null, rowOrder, finalized: [...finalized] })
      continue
    }

    const column = columns[bottom.opened]!
    steps.push({
      kind: 'OPEN',
      cell: { candidateId: bottom.candidateId, criterionKey: column.key },
      // 점수만 보여주는 단계다. 행도 등수도 그대로 둔다.
      rowOrder,
      finalized: [...finalized],
    })

    bottom.total = round4(
      bottom.total + (bottom.perCriterion[column.key] ?? 0) * column.weight,
    )
    bottom.opened += 1

    const settled = sortRows(board)
    // 순서가 그대로면 SETTLE 을 넣지 않는다. 넣으면 빈 클릭이 된다.
    if (!sameOrder(rowOrder, settled)) {
      rowOrder = settled
      steps.push({ kind: 'SETTLE', cell: null, rowOrder, finalized: [...finalized] })
    }
  }

  return { initialRowOrder, steps, totalCells }
}

/** 커서 위치에서 지금까지 열린 칸들. */
export function openedCells(
  script: RevealScript,
  revealedSteps: number,
): RevealCellRef[] {
  const cells: RevealCellRef[] = []
  for (const step of script.steps.slice(0, Math.max(0, revealedSteps))) {
    if (step.cell !== null) cells.push(step.cell)
  }
  return cells
}

/** 커서 위치에서 화면에 표시할 행 순서. */
export function rowOrderAt(script: RevealScript, revealedSteps: number): readonly string[] {
  if (revealedSteps <= 0) return script.initialRowOrder
  return script.steps[Math.min(revealedSteps, script.steps.length) - 1]?.rowOrder
    ?? script.initialRowOrder
}

/** 커서 위치에서 등수가 확정된 팀. 확정 순서(최하위 → 상위)다. */
export function finalizedAt(
  script: RevealScript,
  revealedSteps: number,
): readonly string[] {
  if (revealedSteps <= 0) return []
  return script.steps[Math.min(revealedSteps, script.steps.length) - 1]?.finalized ?? []
}
