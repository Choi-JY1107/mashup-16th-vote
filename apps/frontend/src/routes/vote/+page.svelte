<script lang="ts">
  import '../../styles/ballot.css'
  import { plainTeamName } from '@vote/contract'
  import { goto } from '$app/navigation'
  import { ApiFailure, castBallot } from '$lib/api'
  import { ballotSession } from '$lib/ballot-session.svelte'
  import { POLL_ID } from '$lib/config'
  import TeamName from '$lib/components/TeamName.svelte'

  const form = $derived(ballotSession.form)

  // 세션은 메모리에만 있으므로 새로고침하면 코드 입력부터 다시 한다.
  $effect(() => {
    if (form === null && !ballotSession.submitted) void goto('/', { replaceState: true })
  })

  let stepIndex = $state(0)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let done = $state(false)

  /** criterionId → candidateId → 점수 */
  let values = $state<Record<string, Record<string, number>>>({})

  $effect(() => {
    if (form === null) return
    if (Object.keys(values).length > 0) return
    values = Object.fromEntries(
      form.criteria.map((c) => [
        c.id,
        Object.fromEntries(form.candidates.map((t) => [t.id, 0])),
      ]),
    )
  })

  const limit = $derived(form?.poll.rules.pointsPerCriterion ?? 100)
  const criterion = $derived(form?.criteria[stepIndex] ?? null)
  const isLastStep = $derived(form !== null && stepIndex === form.criteria.length - 1)

  const used = $derived(
    criterion === null
      ? 0
      : Object.values(values[criterion.id] ?? {}).reduce((a, b) => a + b, 0),
  )
  const remaining = $derived(limit - used)
  const exceeded = $derived(remaining < 0)

  /** 방금 거절된 행. 흔들림 효과 대상이며 애니메이션이 끝나면 해제된다. */
  let rejectedCandidateId = $state<string | null>(null)
  let rejectTimer: ReturnType<typeof setTimeout> | null = null

  function flagRejected(candidateId: string) {
    if (rejectTimer !== null) clearTimeout(rejectTimer)

    if (rejectedCandidateId === candidateId) {
      // 같은 행을 연속으로 밀면 클래스를 뗐다 붙여야 애니메이션이 다시 시작된다.
      // requestAnimationFrame 은 백그라운드 탭에서 발화하지 않으므로 쓰지 않는다.
      rejectedCandidateId = null
      setTimeout(() => {
        rejectedCandidateId = candidateId
      }, 0)
    } else {
      rejectedCandidateId = candidateId
    }

    rejectTimer = setTimeout(() => {
      rejectedCandidateId = null
      rejectTimer = null
    }, 900)
  }

  /**
   * 슬라이더/숫자 입력을 한 곳에서 처리한다.
   *
   * 요청값이 남은 점수를 넘으면 상태를 올리지 않는 것만으로는 부족하다.
   * DOM 의 value 를 직접 되돌려야 슬라이더 썸이 제자리에 남는다
   * (Svelte 는 상태가 그대로면 value 속성을 다시 쓰지 않는다).
   */
  function onScoreInput(candidateId: string, el: HTMLInputElement) {
    if (criterion === null) return

    const requested = Number(el.value)
    const current = values[criterion.id]?.[candidateId] ?? 0
    const ceiling = Math.max(0, current + remaining)
    const clamped = Number.isFinite(requested)
      ? Math.max(0, Math.min(Math.round(requested), ceiling))
      : current

    // 썸/숫자를 허용된 값으로 되돌린다.
    el.value = String(clamped)

    if (clamped !== requested) flagRejected(candidateId)

    if (clamped !== current) {
      values[criterion.id] = { ...values[criterion.id], [candidateId]: clamped }
    }
  }

  async function submit() {
    if (form === null || busy) return
    busy = true
    error = null
    try {
      await castBallot(POLL_ID, form.ballotToken, {
        allocations: form.criteria.map((c) => ({
          criterionId: c.id,
          scores: form.candidates.map((t) => ({
            candidateId: t.id,
            points: values[c.id]?.[t.id] ?? 0,
          })),
        })),
      })
      ballotSession.complete()
      done = true
    } catch (cause) {
      // 이 코드가 왔다는 건 표가 이미 서버에 있다는 뜻이다.
      // 빨간 에러를 띄우면 사용자는 실패로 알고 계속 다시 누른다.
      if (
        cause instanceof ApiFailure &&
        (cause.code === 'ALREADY_VOTED' || cause.code === 'ACCESS_CODE_ALREADY_USED')
      ) {
        ballotSession.complete()
        done = true
        return
      }
      error = cause instanceof ApiFailure ? cause.message : '제출에 실패했습니다.'
    } finally {
      busy = false
    }
  }
</script>

<svelte:head>
  <title>투표하기 · Mash-Up 16기</title>
</svelte:head>

{#if done}
  <section class="ballot-done">
    <img class="ballot-done__mascot" src="/mashong.png" alt="매숑이" width="140" height="146" />
    <h1 class="ballot-done__title">투표 완료</h1>
    <p class="ballot-done__text">
      소중한 한 표 감사합니다.<br />
      결과는 시상식에서 최하위부터 공개됩니다.
    </p>
    <a class="ballot-done__link" href="/live">시상식 화면 보기</a>
  </section>
{:else if form !== null && criterion !== null}
  <section class="ballot">
    <ol class="ballot__stepper">
      {#each form.criteria as c, i (c.id)}
        <li
          class="ballot__step"
          class:ballot__step--active={i === stepIndex}
          class:ballot__step--done={i < stepIndex}
        >
          <span class="sr-only">{c.name}</span>
        </li>
      {/each}
    </ol>

    <header class="ballot__header">
      <p class="ballot__progress">항목 {stepIndex + 1} / {form.criteria.length}</p>
      <h1 class="ballot__title">{criterion.name}</h1>
      {#if criterion.description !== ''}
        <p class="ballot__description">{criterion.description}</p>
      {/if}
    </header>

    <div
      class="ballot__budget"
      class:ballot__budget--exceeded={exceeded}
      class:ballot__budget--full={remaining === 0}
      role="status"
      aria-live="polite"
    >
      <span class="ballot__budget-label">남은 점수</span>
      <strong class="ballot__budget-value">{remaining}</strong>
      <span class="ballot__budget-limit">/ {limit}</span>
    </div>

    <ul class="score-list">
      {#each form.candidates as team (team.id)}
        {@const value = values[criterion.id]?.[team.id] ?? 0}
        {@const rejected = rejectedCandidateId === team.id}
        <li class="score-row" class:score-row--rejected={rejected}>
          <label class="score-row__team" for={`score-${criterion.id}-${team.id}`}>
            <TeamName name={team.name} />
          </label>

          <input
            class="score-row__slider"
            id={`score-${criterion.id}-${team.id}`}
            type="range"
            min="0"
            max={limit}
            step="1"
            {value}
            oninput={(e) => onScoreInput(team.id, e.currentTarget)}
          />

          <input
            class="score-row__value"
            type="number"
            min="0"
            max={limit}
            step="1"
            {value}
            aria-label={`${plainTeamName(team.name)} 점수`}
            oninput={(e) => onScoreInput(team.id, e.currentTarget)}
          />

          {#if rejected}
            <p class="score-row__notice" role="alert">남은 점수가 없습니다</p>
          {/if}
        </li>
      {/each}
    </ul>

    {#if error !== null}
      <p class="ballot__error" role="alert">{error}</p>
    {/if}

    <nav class="ballot__nav">
      <button
        class="ballot__button ballot__button--ghost"
        type="button"
        disabled={stepIndex === 0}
        onclick={() => (stepIndex -= 1)}
      >
        이전
      </button>

      {#if isLastStep}
        <button
          class="ballot__button ballot__button--primary"
          type="button"
          disabled={busy || exceeded}
          onclick={submit}
        >
          {busy ? '제출 중...' : '제출하기'}
        </button>
      {:else}
        <button
          class="ballot__button ballot__button--primary"
          type="button"
          disabled={exceeded}
          onclick={() => (stepIndex += 1)}
        >
          다음
        </button>
      {/if}
    </nav>
  </section>
{/if}
