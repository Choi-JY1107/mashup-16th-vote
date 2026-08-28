<script lang="ts">
  import '../../styles/team-name.css'
  import { parseTeamName } from '@vote/contract'

  interface Props {
    name: string
  }

  let { name }: Props = $props()

  const segments = $derived(parseTeamName(name))
</script>

<!-- `**...**` 구간만 굵게. 별표는 표시되지 않는다. -->
{#each segments as segment, i (i)}{#if segment.emphasis}<strong class="team-name__strong"
      >{segment.text}</strong
    >{:else}{segment.text}{/if}{/each}
