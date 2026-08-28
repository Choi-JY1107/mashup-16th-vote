# @vote/frontend

Mash-Up 16기 프로젝트 투표 웹. SvelteKit 2 + Svelte 5 (runes) + TypeScript.

투표자용 화면(코드 입력 → 배점 → 제출)과 시상식용 순위 공개 화면을 담는다.
서버 상태를 직접 만들지 않는다 — 모든 데이터는 백엔드 API 에서 오고,
`packages/contract` 의 zod 스키마로 파싱한 뒤에 화면에 닿는다.

---

## 실행

```bash
pnpm --filter @vote/frontend dev        # vite dev, :5173
pnpm --filter @vote/frontend build
pnpm --filter @vote/frontend typecheck  # svelte-check
pnpm --filter @vote/frontend lint:css   # stylelint
```

`@vote/contract` 는 빌드 산출물을 참조하므로, 계약을 고쳤으면 먼저
`pnpm --filter @vote/contract build` 를 돌린다. 루트의 `pnpm dev` 는 이걸 알아서 한다.

### 환경변수

`$env/static/public` 으로 읽으므로 **빌드 시점에 고정된다.** 값을 바꾸면 재빌드해야 한다.


| 키                          | 설명                                           |
| -------------------------- | -------------------------------------------- |
| `PUBLIC_API_BASE_URL`      | 백엔드 주소. `/api` 는 코드가 붙인다                     |
| `PUBLIC_POLL_ID`           | 투표 슬러그. 현재 `mu16`                            |
| `PUBLIC_SUPABASE_URL`      | Realtime 구독용                                 |
| `PUBLIC_SUPABASE_ANON_KEY` | publishable 키. `reveal_state` SELECT 권한만 갖는다 |


> ⚠️ `service_role`(secret) 키를 `PUBLIC_` 변수에 넣으면 RLS 가 전부 우회되어
> 통행코드 테이블까지 읽고 쓸 수 있게 된다. publishable 키만 쓴다.

Supabase 두 값이 비어 있으면 Realtime 대신 1.5초 폴링으로 떨어진다 —
로컬 데모용이고 프로덕션 경로가 아니다 (관객 수만큼 요청이 곱해진다).

---

## 구조

```
src/
├── app.d.ts
├── lib/
│   ├── config.ts                POLL_ID. 기수가 바뀌면 이 값만 교체
│   ├── api.ts                   백엔드 호출 전부. ApiFailure 로 에러 통일
│   ├── realtime.ts              subscribeReveal(). Realtime 또는 폴링
│   ├── ballot-session.svelte.ts 코드 검증 결과. 메모리에만 둔다
│   └── components/
│       ├── RevealBoard.svelte   시상식 표. flip 애니메이션
│       └── TeamName.svelte      **...** 구간만 굵게
├── routes/
│   ├── +layout.svelte           셸. /live 에서는 헤더·푸터·폭 제한을 걷는다
│   ├── +page.svelte             통행코드 입력
│   ├── v/[code]/+page.ts        딥링크 → /?c=CODE 리다이렉트
│   ├── vote/+page.svelte        배점 화면
│   ├── live/+page.svelte        시상식 화면 (프로젝터)
│   ├── live/mock/+page.svelte   공개 대본 리허설. 서버 없이 돈다
│   └── admin/+page.svelte       사회자 콘솔
└── styles/                      전역 CSS. 컴포넌트가 필요한 파일을 import
```

스타일은 컴포넌트 안에 두지 않고 `src/styles/*.css` 로 모아 각 컴포넌트가
필요한 파일만 `import` 한다. `tokens.css` 가 색·간격·타이포 토큰이다.

---

## 화면

### `/` — 통행코드 입력

10자 코드를 받는다. 코드는 서버가 발급하지 않는다 — 로컬에서 만들어 DB 에
직접 넣은 값이다 (`apps/backend/README.md` 의 "통행코드" 참고). 입력을 정규화해서 소문자·하이픈·공백을 알아서 정리하고
10자에서 멈춘다 (`mu16 a7k2qm` 도 통과). 표시할 때만 `MU16-XXXXXX` 로 하이픈을 그린다.

`?c=<code>` 쿼리로 들어오면 입력칸이 미리 채워진다. QR·카톡 DM 은 `/v/<code>`
를 쓰고, 그 경로가 여기로 302 리다이렉트한다.

검증 성공 → `ballotSession.start(form)` → `/vote`.

### `/vote` — 배점

`ballotSession` 이 비어 있으면 `/` 로 되돌린다 (`replaceState`). 새로고침하면
코드 입력부터 다시다 — 의도한 동작이다.

평가 항목 하나가 한 스텝이다. 항목별로 `pointsPerCriterion` 총점을 팀들에게
나눠준다. 남은 점수를 넘기는 입력은 **서버에 보내기 전에** 클램프하고 해당
팀 행을 잠깐 강조한다. 자기 팀은 서버가 이미 목록에서 빼놨으므로 여기서
필터링하지 않는다.

제출 후 `ballotSession.complete()` 가 토큰을 버린다 — 뒤로 가기로 재제출을
시도할 수 없다.

### `/live` — 시상식 화면

프로젝터용. 최초 진입에서 `GET /api/polls/:id/reveal` 로 현재 상태를 복원하고,
이후는 `subscribeReveal()` 이 Realtime 으로 받는다. **브로드캐스트 payload 에
공개된 순위 전체가 실려 오므로 갱신 때 서버를 다시 부르지 않는다.**

행 순서는 서버의 `rowOrder` 를 그대로 쓴다. 클라이언트가 다시 정렬하면
"다음에 열릴 칸은 맨 아래 팀의 칸"이라는 규칙이 서버와 어긋나고, SETTLE 전의
대기 상태를 표현할 수 없다. 순서 변경은 Svelte 의 `flip` 으로 애니메이션되고
`prefers-reduced-motion` 을 따른다.

스키마가 안 맞는 payload 는 무시하고 상태만 `error` 로 바꾼다 — 시상식 중에
화면이 죽는 것이 최악이다.

### `/live/mock` — 리허설

백엔드·Supabase 없이 공개 대본만 돌려본다. `packages/contract` 의
`buildRevealScript()` 를 그대로 쓰므로 실제 순서와 같다.

키보드로만 조작한다 — `Space`·`→`·`Enter` 로 한 단계 진행, `←` 로 되돌리기,
`R` 로 처음부터. 시나리오 `normal` / `tie` / `all-tie` 는 숫자키 `1`·`2`·`3`.
동점 처리를 눈으로 확인하는 용도다.

### `/admin` — 사회자 콘솔

페이지 자체는 공개돼 있고, 실제 동작은 관리자 키로 막혀 있다. 키는
`localStorage['mu16-admin-key']` 에 둔다.

- **투표 마감** — 2단 확인. 되돌릴 수 없다
- **다음 공개** — `nextAction` 에 따라 버튼 문구가 바뀐다 (열 칸 이름 / 순서 갱신 / 등수). 다음에 무슨 일이 일어나는지 누르기 전에 보인다
- `/live` 를 새 탭으로 여는 링크

---

## 데이터 흐름

```
+page ──verifyAccessCode()──► POST /api/polls/:id/access-codes/verify
   │                                    │
   └──ballotSession.start(form)◄─────────┘  ballotToken + criteria + candidates
   │
/vote ──castBallot()────────► POST /api/polls/:id/ballots   (Bearer ballotToken)

/live ──fetchRevealState()──► GET  /api/polls/:id/reveal    (최초 1회)
      ──subscribeReveal()───► Supabase Realtime: reveal_state (이후 갱신)

/admin ─adminClosePoll()────► POST /api/admin/polls/:id/close          (x-admin-key)
       ─adminAdvanceReveal()► POST /api/admin/polls/:id/reveal/advance (x-admin-key)
```

`lib/api.ts` 가 백엔드와 닿는 유일한 파일이다. 컴포넌트는 `fetch` 를 직접
쓰지 않는다.

### 에러

백엔드 에러는 전부 `ApiFailure` 로 바뀐다. `code` 는 `ApiErrorCode` 또는
네트워크 실패를 뜻하는 `'NETWORK'`. 사용자에게 보여줄 문구는 `api.ts` 의
`MESSAGES` 에서 코드별로 덮어쓰고, 없으면 서버 메시지를 그대로 쓴다.

**표 제출은 예외적으로 다르게 다룬다.** 2xx 를 받았다면 서버는 이미 커밋했다.
이 시점에 응답 본문이 계약과 어긋난다고 "실패"로 표시하면, 표는 저장됐는데
사용자는 실패로 알고 다시 누른다. 재시도는 `ALREADY_VOTED` 로 막히므로 두 번
제출된 것처럼 보인다. 그래서 `castBallot` 만 파싱 실패를 경고로 남기고
성공으로 넘긴다.

### 세션

`ballot-session.svelte.ts` 는 일부러 메모리에만 둔다. `localStorage` 에 두면
남의 기기에 토큰이 남고, 새로고침으로 되살아난 화면이 이미 제출된 표를 다시
보여줄 수 있다.

---

## 배포 (Vercel)

`@sveltejs/adapter-vercel`, `nodejs22.x`, 리전 `icn1`.
Vercel 프로젝트의 **Root Directory 를 `apps/frontend`** 로 잡고 `PUBLIC_*`
환경변수를 넣는다. 모노레포 루트에서 빌드하면 `@vote/contract` 를 못 찾는다.