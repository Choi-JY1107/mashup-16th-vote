<script lang="ts">
  import '../styles/code-gate.css'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { ApiFailure, verifyAccessCode } from '$lib/api'
  import { ballotSession } from '$lib/ballot-session.svelte'
  import { POLL_ID } from '$lib/config'

  // QR / 카톡 딥링크(/v/MU16XXXXXX)로 들어오면 코드가 미리 채워진다.
  let code = $state(
    ($page.url.searchParams.get('c') ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10),
  )
  let error = $state<string | null>(null)
  let busy = $state(false)

  // 종이에 인쇄된 코드를 손으로 입력하는 경로가 있어서 하이픈과 소문자를 허용하고 정규화한다.
  const normalize = (raw: string) =>
    raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10)

  const display = $derived(
    code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code,
  )
  const ready = $derived(code.length === 10)

  function onInput(event: Event) {
    code = normalize((event.currentTarget as HTMLInputElement).value)
    error = null
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!ready || busy) return

    busy = true
    error = null
    try {
      ballotSession.start(await verifyAccessCode(POLL_ID, code))
      await goto('/vote')
    } catch (cause) {
      error =
        cause instanceof ApiFailure ? cause.message : '알 수 없는 오류가 발생했습니다.'
    } finally {
      busy = false
    }
  }
</script>

<svelte:head>
  <title>Mash-Up 16기 프로젝트 투표</title>
</svelte:head>

<section class="code-gate">
  <img class="code-gate__mascot" src="/mashong.png" alt="매숑이" width="150" height="156" />

  <h1 class="code-gate__title">16기 프로젝트 투표</h1>
  <p class="code-gate__description">
    받으신 통행코드를 입력해주세요.<br />
    한 코드로 한 번만 투표할 수 있습니다.
  </p>

  <form class="code-gate__form" onsubmit={submit}>
    <label class="code-gate__label" for="access-code">통행코드</label>
    <input
      class="code-gate__input"
      class:code-gate__input--invalid={error !== null}
      id="access-code"
      inputmode="text"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      placeholder="MU16-XXXXXX"
      value={display}
      oninput={onInput}
      aria-describedby={error !== null ? 'access-code-error' : undefined}
      aria-invalid={error !== null}
    />

    {#if error !== null}
      <p class="code-gate__error" id="access-code-error" role="alert">{error}</p>
    {/if}

    <button class="code-gate__submit" type="submit" disabled={!ready || busy}>
      {busy ? '확인 중...' : '투표 시작'}
    </button>
  </form>
</section>
