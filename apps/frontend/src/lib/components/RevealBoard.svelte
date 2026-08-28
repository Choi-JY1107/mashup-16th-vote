<script lang="ts">
  import '../../styles/scoreboard.css'
  import { flip } from 'svelte/animate'
  import { cubicOut } from 'svelte/easing'
  import type { Platform, RevealState } from '@vote/contract'
  import TeamName from './TeamName.svelte'

  interface Props {
    revealState: RevealState | null
  }

  let { revealState = null }: Props = $props()

  let reduceMotion = $state(false)
  $effect(() => {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  const criteria = $derived(revealState?.criteria ?? [])
  const teams = $derived(revealState?.teams ?? [])
  const totalCells = $derived(revealState?.totalCells ?? 0)

  /** 팀 → (항목 → 공개된 점수). 열리지 않은 칸은 키가 없다. */
  const scoresByTeam = $derived.by(() => {
    const grouped = new Map<string, Map<string, number>>()
    for (const cell of revealState?.cells ?? []) {
      let row = grouped.get(cell.candidateId)
      if (row === undefined) {
        row = new Map<string, number>()
        grouped.set(cell.candidateId, row)
      }
      row.set(cell.criterionKey, cell.score)
    }
    return grouped
  })

  /**
   * 등수가 확정된 팀.
   *
   * 칸이 전부 열렸다고 확정되는 것이 아니다. 아래에 아직 안 열린 팀이 남아 있으면
   * 그 팀들이 올라와 자리를 빼앗을 수 있으므로, 서버는 화면 맨 아래 팀에 더 열 칸이
   * 없을 때 그 팀을 확정한다. 그래서 확정은 아래에서 위로 올라온다.
   */
  const finalizedByTeam = $derived(
    new Map((revealState?.entries ?? []).map((e) => [e.candidateId, e])),
  )

  const weightOf = $derived(new Map(criteria.map((c) => [c.key, c.weight])))

  /**
   * 다음 클릭이 건드릴 행.
   *
   *   OPEN  칸이 열릴 팀
   *   RANK  등수가 박힐 팀 — 화면 맨 아래에서 아직 확정 안 된 첫 팀
   */
  const focusTeamId = $derived.by(() => {
    if (revealState === null) return null
    if (revealState.nextAction === 'OPEN') return revealState.cursor?.candidateId ?? null
    if (revealState.nextAction === 'RANK') {
      const done = new Set(revealState.entries.map((e) => e.candidateId))
      return [...revealState.rowOrder].reverse().find((id) => !done.has(id)) ?? null
    }
    return null
  })

  const rows = $derived.by(() =>
    teams.map((team) => {
      const revealed = scoresByTeam.get(team.candidateId) ?? new Map<string, number>()
      const finalized = finalizedByTeam.get(team.candidateId) ?? null

      // 확정된 팀은 서버가 확정한 총점을 쓴다.
      // 진행 중인 팀은 열린 칸만으로 가중합을 낸다 — 이 값이 자라면서 행이 위로 올라간다.
      let running = 0
      for (const [key, score] of revealed) running += score * (weightOf.get(key) ?? 1)

      return {
        team,
        revealed,
        revealedCount: revealed.size,
        total: finalized !== null ? finalized.score : Math.round(running * 100) / 100,
        rank: finalized?.rank ?? null,
        isFinalized: finalized !== null,
        isActive: focusTeamId === team.candidateId,
      }
    }),
  )

  /**
   * 행 순서는 **서버가 정한 것을 그대로 쓴다.**
   *
   * 여기서 다시 정렬하면 두 가지가 깨진다.
   *   1. "다음에 열릴 칸은 화면 맨 아래 팀의 칸" 규칙이 서버와 어긋날 수 있다.
   *   2. 점수는 올라갔지만 아직 순위를 갱신하지 않은 대기 상태를 표현할 수 없다.
   */
  const ordered = $derived.by(() => {
    const byId = new Map(rows.map((row) => [row.team.candidateId, row]))
    const listed = (revealState?.rowOrder ?? [])
      .map((id) => byId.get(id))
      .filter((row): row is (typeof rows)[number] => row !== undefined)
    // rowOrder 에 빠진 팀이 있으면 화면에서 사라지는 것보다 뒤에 붙이는 게 낫다.
    const shown = new Set(listed.map((row) => row.team.candidateId))
    return [...listed, ...rows.filter((row) => !shown.has(row.team.candidateId))]
  })

  /**
   * 점수는 올라갔는데 아직 행이 움직이지 않은 팀.
   *
   * 다음 클릭이 SETTLE 이면, 방금 칸이 열린 팀이 아직 제자리에 서 있다는 뜻이다.
   * 표시를 안 하면 관객도 사회자도 한 번 더 눌러야 하는지 알 수 없다.
   */
  const pendingTeamId = $derived(
    revealState?.nextAction === 'SETTLE'
      ? (revealState.cells.at(-1)?.candidateId ?? null)
      : null,
  )

  /** 공동 순위는 위쪽 한 줄에만 숫자를 찍는다. 정렬상 동점 팀은 항상 인접한다. */
  const displayRows = $derived.by(() => {
    let previousRank: number | null = null
    return ordered.map((row) => {
      const showRank = row.rank !== null && row.rank !== previousRank
      previousRank = row.rank
      return { ...row, showRank }
    })
  })

  const gridStyle = $derived(
    `--cell-columns: repeat(${Math.max(criteria.length, 1)}, minmax(78px, 1fr))`,
  )

  const PLATFORM_LABEL: Record<Platform, string> = { APP: '앱', WEB: '웹' }
  const flipConfig = $derived({ duration: reduceMotion ? 0 : 620, easing: cubicOut })
</script>

<section class="scoreboard">
  {#if totalCells === 0}
    <p class="scoreboard__empty">아직 결과가 공개되지 않았습니다.</p>
  {:else}
    <div class="scoreboard__table">
      <div class="scoreboard__head" style={gridStyle}>
        <span class="scoreboard__head-rank">순위</span>
        <span class="scoreboard__head-team">팀</span>
        {#each criteria as criterion (criterion.key)}
          <span class="scoreboard__head-cell">{criterion.name}</span>
        {/each}
        <span class="scoreboard__head-total">총점</span>
      </div>

      <ol class="scoreboard__list">
        {#each displayRows as row (row.team.candidateId)}
          <li
            class="scoreboard__row"
            class:scoreboard__row--waiting={row.revealedCount === 0}
            class:scoreboard__row--active={row.isActive}
            class:scoreboard__row--finalized={row.isFinalized}
            class:scoreboard__row--pending={row.team.candidateId === pendingTeamId}
            class:scoreboard__row--winner={row.rank === 1}
            style={gridStyle}
            animate:flip={flipConfig}
          >
            <span class="scoreboard__rank">{row.showRank ? `${row.rank}` : ''}</span>
            <span class="scoreboard__team">
              {#if row.team.platform !== null}
                <!-- 앱/웹은 색으로만 구분한다. 글자가 없으므로 라벨은 보조기기에만 준다. -->
                <span
                  class="scoreboard__platform"
                  class:scoreboard__platform--web={row.team.platform === 'WEB'}
                  role="img"
                  aria-label={PLATFORM_LABEL[row.team.platform]}
                ></span>
              {/if}
              <span
                class="scoreboard__name"
                class:scoreboard__name--web={row.team.platform === 'WEB'}
              >
                <TeamName name={row.team.candidateName} />
              </span>
            </span>

            {#each criteria as criterion (criterion.key)}
              {@const score = row.revealed.get(criterion.key)}
              {@const isNext =
                revealState?.nextAction === 'OPEN' &&
                row.isActive &&
                revealState.cursor?.criterionKey === criterion.key}
              <span
                class="scoreboard__cell"
                class:scoreboard__cell--revealed={score !== undefined}
                class:scoreboard__cell--next={isNext}
              >
                {score === undefined ? '' : score.toFixed(1)}
              </span>
            {/each}

            {#key row.revealedCount}
              <span class="scoreboard__total">{row.total.toFixed(2)}</span>
            {/key}
          </li>
        {/each}
      </ol>
    </div>
  {/if}
</section>
