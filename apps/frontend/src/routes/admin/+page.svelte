<script lang="ts">
  import '../../styles/admin.css'
  import type { RevealState } from '@vote/contract'
  import { plainTeamName } from '@vote/contract'
  import { adminAdvanceReveal, adminClosePoll, ApiFailure, fetchRevealState } from '$lib/api'
  import { POLL_ID } from '$lib/config'

  const KEY_STORAGE = 'mu16-admin-key'

  let adminKey = $state('')
  let revealState = $state<RevealState | null>(null)
  let message = $state<string | null>(null)
  let error = $state<string | null>(null)
  let busy = $state(false)
  let confirmingClose = $state(false)

  $effect(() => {
    // 시상식 중 새로고침해도 키를 다시 입력하지 않게 탭 세션에만 담아둔다.
    adminKey = sessionStorage.getItem(KEY_STORAGE) ?? ''
    fetchRevealState(POLL_ID)
      .then((s) => {
        revealState = s
      })
      .catch(() => {})
  })

  $effect(() => {
    if (adminKey !== '') sessionStorage.setItem(KEY_STORAGE, adminKey)
  })

  const exhausted = $derived(revealState !== null && revealState.nextAction === 'NONE')

  const nameOf = (candidateId: string | undefined) =>
    plainTeamName(
      revealState?.teams.find((t) => t.candidateId === candidateId)?.candidateName ?? '?',
    )

  /** RANK 차례에 등수가 박힐 팀. 화면 맨 아래에서 아직 확정 안 된 첫 팀이다. */
  const rankingTeamId = $derived.by(() => {
    if (revealState === null || revealState.nextAction !== 'RANK') return null
    const done = new Set(revealState.entries.map((e) => e.candidateId))
    return [...revealState.rowOrder].reverse().find((id) => !done.has(id)) ?? null
  })

  /** 다음 클릭이 무엇을 하는지. 사회자가 읽어야 하는 문구다. */
  const nextLabel = $derived.by(() => {
    if (revealState === null) return null

    if (revealState.nextAction === 'RANK') {
      // 등수는 아직 payload 에 없다. 누르는 순간 나온다.
      return `등수 공개 — ${nameOf(rankingTeamId ?? undefined)}`
    }

    if (revealState.nextAction === 'SETTLE') {
      // 방금 칸이 열린 팀이 아직 제자리에 있다. 이 클릭이 그 행을 움직인다.
      return `순서 갱신 — ${nameOf(revealState.cells.at(-1)?.candidateId)} 이동`
    }

    const cursor = revealState.cursor
    if (cursor === null) return null
    const criterion = revealState.criteria.find((c) => c.key === cursor.criterionKey)
    return `점수 공개 — ${nameOf(cursor.candidateId)} · ${criterion?.name ?? '?'}`
  })

  const buttonLabel = $derived.by(() => {
    if (revealState?.nextAction === 'RANK') return '등수 공개'
    if (revealState?.nextAction === 'SETTLE') return '순서 갱신'
    return '다음 칸 공개'
  })

  async function run<T>(action: () => Promise<T>, onDone: (result: T) => void) {
    if (busy || adminKey === '') return
    busy = true
    error = null
    message = null
    try {
      onDone(await action())
    } catch (cause) {
      error = cause instanceof ApiFailure ? cause.message : '요청에 실패했습니다.'
    } finally {
      busy = false
    }
  }

  const close = () =>
    run(
      () => adminClosePoll(POLL_ID, adminKey),
      (result) => {
        confirmingClose = false
        message =
          `집계 확정 완료 — ${result.frozenCount}팀, 순위 ${result.totalRanks}단계, ` +
          `공개할 칸 ${result.totalCells}개`
        // 총 클릭 수는 순위가 바뀌는 횟수에 따라 달라지므로 공개 상태에서 다시 읽는다.
        fetchRevealState(POLL_ID)
          .then((s) => {
            revealState = s
          })
          .catch(() => {})
      },
    )

  const advance = () =>
    run(
      () => adminAdvanceReveal(POLL_ID, adminKey),
      (next) => {
        const before = revealState
        revealState = next

        // 이 클릭으로 순위가 확정된 팀이 있으면 그것을 먼저 알린다.
        const finalized = next.entries.find(
          (e) => !(before?.entries ?? []).some((b) => b.candidateId === e.candidateId),
        )
        if (finalized !== undefined) {
          message = `${finalized.rank}위 확정 — ${plainTeamName(finalized.candidateName)} (${finalized.score.toFixed(2)}점)`
          return
        }

        // 칸 수가 그대로면 이번 클릭은 행 순서 갱신이었다.
        if (before !== null && next.revealedCells === before.revealedCells) {
          message = '행 순서 갱신됨'
          return
        }

        // cells 는 열린 순서 그대로이므로 마지막 원소가 방금 열린 칸이다.
        const cell = next.cells.at(-1)
        if (cell === undefined) {
          message = '공개됨'
          return
        }
        const team = next.teams.find((t) => t.candidateId === cell.candidateId)
        const criterion = next.criteria.find((c) => c.key === cell.criterionKey)
        message = `${plainTeamName(team?.candidateName ?? '?')} · ${criterion?.name ?? '?'} = ${cell.score.toFixed(1)}`
      },
    )
</script>

<svelte:head>
  <title>관리자 · Mash-Up 16기</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<section class="admin">
  <h1 class="admin__title">시상식 진행</h1>

  <div class="admin__field">
    <label class="admin__label" for="admin-key">관리자 키</label>
    <input
      class="admin__input"
      id="admin-key"
      type="password"
      autocomplete="off"
      bind:value={adminKey}
      placeholder="x-admin-key"
    />
  </div>

  <section class="admin__block">
    <h2 class="admin__block-title">1. 투표 마감 및 집계 확정</h2>
    <p class="admin__hint">
      되돌릴 수 없습니다. 이 시점의 순위가 스냅샷으로 고정되고, 이후 들어오는 표는 반영되지
      않습니다.
    </p>

    {#if confirmingClose}
      <div class="admin__confirm">
        <p class="admin__confirm-text">정말 마감하시겠습니까?</p>
        <button
          class="admin__button admin__button--danger"
          type="button"
          disabled={busy}
          onclick={close}
        >
          마감 확정
        </button>
        <button
          class="admin__button admin__button--ghost"
          type="button"
          onclick={() => (confirmingClose = false)}
        >
          취소
        </button>
      </div>
    {:else}
      <button
        class="admin__button admin__button--ghost"
        type="button"
        disabled={adminKey === ''}
        onclick={() => (confirmingClose = true)}
      >
        투표 마감하기
      </button>
    {/if}
  </section>

  <section class="admin__block">
    <h2 class="admin__block-title">2. 순위 공개</h2>
    <p class="admin__hint">
      클릭 하나가 한 가지만 합니다 — 칸 하나를 열거나, 행 순서를 갱신하거나, 등수를
      박습니다. 다음에 무엇이 일어나는지 아래에 표시됩니다.
    </p>

    {#if revealState === null}
      <p class="admin__hint">아직 집계가 확정되지 않았습니다.</p>
    {:else}
      <p class="admin__hint">
        칸 {revealState.revealedCells} / {revealState.totalCells} · 클릭 {revealState.revealedSteps}
        / {revealState.totalSteps}
      </p>
      <p
        class="admin__next"
        class:admin__next--settle={revealState.nextAction === 'SETTLE'}
        class:admin__next--rank={revealState.nextAction === 'RANK'}
      >
        {exhausted ? '전부 공개됨' : (nextLabel ?? '-')}
      </p>
    {/if}

    <button
      class="admin__button admin__button--primary"
      class:admin__button--settle={revealState?.nextAction === 'SETTLE'}
      type="button"
      disabled={busy || adminKey === '' || exhausted}
      onclick={advance}
    >
      {busy ? '진행 중...' : buttonLabel}
    </button>
  </section>

  {#if message !== null}
    <p class="admin__message" role="status">{message}</p>
  {/if}
  {#if error !== null}
    <p class="admin__error" role="alert">{error}</p>
  {/if}

  <a class="admin__link" href="/live" target="_blank" rel="noreferrer">
    시상식 화면 열기 (프로젝터용)
  </a>
</section>
