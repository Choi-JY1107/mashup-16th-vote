<script lang="ts">
  import '../styles/tokens.css'
  import '../styles/global.css'
  import '../styles/shell.css'
  import { page } from '$app/state'

  let { children } = $props()

  /**
   * 시상식 화면은 프로젝터에 띄우므로 표를 최대한 크게 쓴다.
   * 헤더·푸터와 720px 폭 제한을 걷어내고 화면 전체를 표에 준다.
   */
  const wide = $derived(page.route.id?.startsWith('/live') ?? false)
</script>

<div class="shell">
  {#if !wide}
    <header class="shell__header">
      <a class="shell__brand" href="/">
        <span class="shell__logo" aria-hidden="true"></span>
        <span class="shell__brand-text">Mash-Up <strong>16기</strong></span>
      </a>
      <span class="shell__tagline">SEEKING VALUE FOR GROWTH</span>
    </header>
  {/if}

  <main class="shell__main" class:shell__main--wide={wide}>
    {@render children?.()}
  </main>

  {#if !wide}
    <footer class="shell__footer">
      <img class="shell__mascot" src="/mashong.png" alt="매숑이" width="56" height="58" />
      <p class="shell__footer-text">Mash-Up 16기 프로젝트 투표</p>
    </footer>
  {/if}
</div>
