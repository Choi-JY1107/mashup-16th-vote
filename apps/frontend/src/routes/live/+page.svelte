<script lang="ts">
  import '../../styles/live.css'
  import type { RevealState } from '@vote/contract'
  import { fetchRevealState } from '$lib/api'
  import RevealBoard from '$lib/components/RevealBoard.svelte'
  import { POLL_ID } from '$lib/config'
  import { subscribeReveal, type RevealStatus } from '$lib/realtime'

  let revealState = $state<RevealState | null>(null)
  let status = $state<RevealStatus>('connecting')

  $effect(() => {
    // 최초 1회만 서버에서 가져온다. 새로고침해도 지금까지 공개된 칸이 복원된다.
    fetchRevealState(POLL_ID)
      .then((initial) => {
        revealState = initial
      })
      .catch(() => {
        // 아직 공개가 시작되지 않았을 수 있다. 구독은 계속 유지한다.
      })

    // 이후 갱신은 Realtime payload 로만 온다. 공개 순간의 API 요청은 0건이다.
    return subscribeReveal(
      POLL_ID,
      (next) => {
        revealState = next
      },
      (s) => {
        status = s
      },
    )
  })
</script>

<svelte:head>
  <title>시상식 · Mash-Up 16기</title>
</svelte:head>

<!--
  연결 상태 문구는 화면에서 뺐다. 다만 연결이 끊긴 것을 아무도 모르는 상태는 위험하다
  (사회자가 눌러도 관객 화면이 안 바뀐다). 오류일 때만 이 배너가 뜬다.
-->
{#if status === 'error'}
  <p class="live__alert" role="alert">연결이 끊겼습니다. 새로고침해주세요.</p>
{/if}

<RevealBoard {revealState} />
