<script lang="ts">
  import '../../../styles/mock.css'
  import {
    buildRevealScript,
    finalizedAt,
    openedCells,
    rowOrderAt,
    type Platform,
    type RevealAction,
    type RevealCriterion,
    type RevealState,
    type RevealTeam,
  } from '@vote/contract'
  import RevealBoard from '$lib/components/RevealBoard.svelte'

  /**
   * 백엔드 없이 시상식 화면을 확인하는 페이지.
   *
   * /live 와 같은 RevealBoard 를 쓰고, 공개 순서도 서버와 같은 buildRevealOrder() 를
   * 쓴다. 그래서 여기서 본 순서와 움직임이 당일 그대로다.
   *
   * 화면에는 표만 둔다. 조작은 전부 키보드/클릭이다.
   *   클릭 · Space · → · Enter  다음 단계 (칸 공개 → 순위 갱신 → 칸 공개 → ...)
   *   ←                         한 단계 되돌리기
   *   R                         처음부터
   *   1 / 2 / 3                 시나리오 전환 (일반 / 동점 / 전원 동점)
   */

  const CRITERIA: RevealCriterion[] = [
    { key: 'collaboration', name: '협업', weight: 1 },
    { key: 'completeness', name: '완성도', weight: 1 },
    { key: 'ideation', name: '기획·아이디어', weight: 1 },
    { key: 'presentation', name: '발표·전달력', weight: 1 },
  ]

  /** 실제 16기 팀. DB 의 candidates.display_order 와 같은 순서다. */
  const TEAM_ROWS: { name: string; slug: string; platform: Platform }[] = [
    { name: '팀장은 연경이', slug: 'app-1', platform: 'APP' },
    { name: '상정', slug: 'app-2', platform: 'APP' },
    { name: '민호야 잘하자', slug: 'app-3', platform: 'APP' },
    { name: '우두머리❤️', slug: 'web-1', platform: 'WEB' },
    { name: '너 정말 **핵심**을 찔렀어', slug: 'web-2', platform: 'WEB' },
    { name: '프로미스나인 (Promise.9)', slug: 'web-3', platform: 'WEB' },
  ]

  /**
   * TEAM_ROWS 순서(= 화면 초기 순서)와 순위가 일부러 어긋나게 넣었다.
   * 그래야 행이 위아래로 움직이는 모습을 확인할 수 있다.
   */
  const SCENARIOS: Record<string, number[][]> = {
    // '민호야 잘하자' 1위, '너 정말 핵심을 찔렀어' 2위. 표시 순서와 순위가 크게 다르다.
    normal: [
      [22.7, 23.4, 22.1, 22.3],
      [14.1, 13.6, 14.4, 13.6],
      [28.4, 29.1, 27.6, 27.1],
      [9.8, 9.2, 9.9, 9.7],
      [25.2, 24.8, 24.1, 24.2],
      [18.2, 18.9, 17.8, 18.1],
    ],
    // 2·3번째 팀이 동점 → 공동 2위, 3위는 존재하지 않는다 (1, 2, 2, 4)
    tie: [
      [28.4, 29.1, 27.6, 27.1],
      [24.0, 25.0, 23.5, 23.5],
      [23.5, 23.5, 25.0, 24.0],
      [18.2, 18.9, 17.8, 18.1],
      [14.1, 13.6, 14.4, 13.6],
      [9.8, 9.2, 9.9, 9.7],
    ],
    // 전원 같은 총점 → 모두 공동 1위
    'all-tie': [
      [20, 20, 20, 20],
      [20, 20, 20, 20],
      [20, 20, 20, 20],
      [20, 20, 20, 20],
      [20, 20, 20, 20],
      [20, 20, 20, 20],
    ],
  }

  const SCENARIO_KEYS = ['normal', 'tie', 'all-tie']

  const round2 = (n: number) => Math.round(n * 100) / 100

  /** uuid 모양이어야 계약 스키마를 통과한다. */
  const mockId = (index: number) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`

  let scenarioKey = $state('normal')
  let revealedSteps = $state(0)

  const scores = $derived(SCENARIOS[scenarioKey] ?? SCENARIOS.normal!)

  const teams = $derived<RevealTeam[]>(
    TEAM_ROWS.map((row, i) => ({
      candidateId: mockId(i),
      candidateName: row.name,
      candidateSlug: row.slug,
      platform: row.platform,
      displayOrder: i + 1,
    })),
  )

  /** 총점 → 순위. 동점은 같은 순위 + 다음 순위 스킵 (1, 2, 2, 4). */
  const ranked = $derived.by(() => {
    const rows = teams.map((team, i) => ({
      team,
      perCriterion: Object.fromEntries(CRITERIA.map((c, j) => [c.key, scores[i]![j]!])),
      total: round2(CRITERIA.reduce((sum, c, j) => sum + scores[i]![j]! * c.weight, 0)),
    }))

    rows.sort(
      (a, b) => b.total - a.total || a.team.candidateId.localeCompare(b.team.candidateId),
    )

    let rank = 0
    let previous: number | null = null
    return rows.map((row, index) => {
      if (previous === null || row.total !== previous) {
        rank = index + 1
        previous = row.total
      }
      return { ...row, rank }
    })
  })

  /** 서버와 같은 함수로 대본을 만든다. 이 페이지가 연출을 왜곡하지 않는 이유다. */
  const script = $derived(
    buildRevealScript(
      ranked.map((r) => ({
        candidateId: r.team.candidateId,
        displayOrder: r.team.displayOrder,
        perCriterion: r.perCriterion,
      })),
      CRITERIA.map((c, i) => ({ key: c.key, displayOrder: i + 1, weight: c.weight })),
    ),
  )

  const totalSteps = $derived(script.steps.length)

  /** 서버가 보내는 payload 와 같은 모양을 만든다. */
  const revealState = $derived.by<RevealState>(() => {
    const refs = openedCells(script, revealedSteps)
    const resultOf = new Map(ranked.map((r) => [r.team.candidateId, r]))
    const nextStep = script.steps[revealedSteps] ?? null

    return {
      pollId: mockId(999),
      totalRanks: Math.max(...ranked.map((r) => r.rank)),
      totalCells: script.totalCells,
      revealedCells: refs.length,
      totalSteps,
      revealedSteps,
      nextAction: (nextStep === null ? 'NONE' : nextStep.kind) as RevealAction,
      criteria: CRITERIA,
      teams,
      rowOrder: [...rowOrderAt(script, revealedSteps)],
      cells: refs.map((ref) => ({
        ...ref,
        score: resultOf.get(ref.candidateId)?.perCriterion[ref.criterionKey] ?? 0,
      })),
      // 확정된 팀만. 대본이 준 확정 순서(최하위 → 상위)를 그대로 쓴다.
      entries: finalizedAt(script, revealedSteps)
        .map((id) => resultOf.get(id))
        .filter((r) => r !== undefined)
        .map((r) => ({
          rank: r.rank,
          candidateId: r.team.candidateId,
          candidateName: r.team.candidateName,
          candidateSlug: r.team.candidateSlug,
          score: r.total,
          perCriterion: r.perCriterion,
        })),
      cursor: nextStep?.cell ?? null,
      updatedAt: new Date().toISOString(),
    }
  })

  const advance = () => {
    revealedSteps = Math.min(totalSteps, revealedSteps + 1)
  }

  const rewind = () => {
    revealedSteps = Math.max(0, revealedSteps - 1)
  }

  function onKeydown(event: KeyboardEvent) {
    const key = event.key
    if (key === ' ' || key === 'ArrowRight' || key === 'Enter') {
      event.preventDefault()
      advance()
      return
    }
    if (key === 'ArrowLeft') {
      event.preventDefault()
      rewind()
      return
    }
    if (key === 'r' || key === 'R') {
      revealedSteps = 0
      return
    }
    const picked = SCENARIO_KEYS[Number(key) - 1]
    if (picked !== undefined) {
      scenarioKey = picked
      revealedSteps = 0
    }
  }
</script>

<svelte:head>
  <title>시상식 화면 미리보기 (목 데이터)</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onKeydown} onclick={advance} />

<!-- 실제 화면(/live)과 헷갈리면 안 되므로 표식만 아주 작게 남긴다 -->
<span class="mock-tag">MOCK · {scenarioKey} · Space/← /R/1·2·3</span>

<RevealBoard {revealState} />
