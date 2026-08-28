<script lang="ts">
  import '../styles/code-gate.css'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { ApiFailure, verifyAccessCode } from '$lib/api'
  import { ballotSession } from '$lib/ballot-session.svelte'
  import { POLL_ID } from '$lib/config'

  /** 모든 코드가 공유하는 접두어. 화면에 고정 표시하고 입력받지 않는다. */
  const PREFIX = 'MU16'
  const BODY_LENGTH = 6

  /**
   * 입력값에서 뒤 6자만 남긴다.
   *
   * 접두어를 붙여 치거나 전체를 붙여넣는 경로도 살려둔다 (딥링크 ?c=, QR).
   * 접두어를 떼는 조건을 "4자 초과"로 둔 건, 본문 자체가 MU16 으로 시작하면
   * 구분이 안 되기 때문이다 — 발급 시 그런 코드가 없는지 확인한다.
   */
  const normalize = (raw: string) => {
    let s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
    if (s.length > PREFIX.length && s.startsWith(PREFIX)) s = s.slice(PREFIX.length)
    return s.slice(0, BODY_LENGTH)
  }

  // QR / 카톡 딥링크(/v/MU16XXXXXX)로 들어오면 코드가 미리 채워진다.
  let body = $state(normalize($page.url.searchParams.get('c') ?? ''))
  let error = $state<string | null>(null)
  let busy = $state(false)

  const ready = $derived(body.length === BODY_LENGTH)

  function onInput(event: Event) {
    body = normalize((event.currentTarget as HTMLInputElement).value)
    error = null
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!ready || busy) return

    busy = true
    error = null
    try {
      ballotSession.start(await verifyAccessCode(POLL_ID, PREFIX + body))
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
    받으신 통행코드의 뒤 6자를 입력해주세요.<br />
    한 코드로 한 번만 투표할 수 있습니다.
  </p>

  <form class="code-gate__form" onsubmit={submit}>
    <label class="code-gate__label" for="access-code">
      통행코드 — MU16- 뒤의 6자만 입력하세요
    </label>
    <div
      class="code-gate__field"
      class:code-gate__field--invalid={error !== null}
    >
      <span class="code-gate__prefix" aria-hidden="true">{PREFIX}-</span>
      <input
        class="code-gate__input"
        id="access-code"
        inputmode="text"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        maxlength="6"
        placeholder="XXXXXX"
        value={body}
        oninput={onInput}
        aria-describedby={error !== null ? 'access-code-error' : undefined}
        aria-invalid={error !== null}
      />
    </div>

    {#if error !== null}
      <p class="code-gate__error" id="access-code-error" role="alert">{error}</p>
    {/if}

    <button class="code-gate__submit" type="submit" disabled={!ready || busy}>
      {busy ? '확인 중...' : '투표 시작'}
    </button>
  </form>
</section>
