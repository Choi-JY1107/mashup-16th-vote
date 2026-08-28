# @vote/backend

Mash-Up 16기 프로젝트 투표 API. NestJS 10 + TypeScript ESM.

투표 접수부터 시상식 순위 공개까지를 담당한다. 클린 아키텍처로 나눠져 있어
데이터 저장소를 Supabase / 인메모리 중 하나로 런타임에 갈아끼울 수 있다.

---

## 실행

```bash
pnpm --filter @vote/backend dev     # tsx watch, .env 자동 로드
pnpm --filter @vote/backend test    # vitest
pnpm --filter @vote/backend build   # tsc → dist/
```

기본 포트 8080. 전역 prefix `api` — 모든 경로가 `/api/...` 로 시작한다.

### 환경변수

| 키 | 필수 | 설명 |
| --- | --- | --- |
| `PORT` | | 기본 8080. Cloud Run 이 주입한다 |
| `CORS_ORIGIN` | | 콤마 구분. 비우면 모든 오리진 허용 |
| `ACCESS_CODE_PEPPER` | ✅ | 통행코드 HMAC 의 서버측 비밀값. 바꾸면 발급된 코드가 전부 무효 |
| `BALLOT_JWT_SECRET` | ✅ | 투표 토큰 서명 키 |
| `ADMIN_API_KEY` | ✅ | 관리자 엔드포인트 `x-admin-key` 값 |
| `DATA_SOURCE` | | `memory` 면 인메모리, 그 외/미지정이면 Supabase |
| `SUPABASE_URL` | △ | Supabase 사용 시 필수. 프로젝트 URL (`/rest/v1` 붙이지 않는다) |
| `SUPABASE_SERVICE_ROLE_KEY` | △ | Supabase 사용 시 필수. **RLS 를 전부 우회하는 키 — 프론트에 절대 노출 금지** |
| `DEMO_SEED_PATH` | △ | `DATA_SOURCE=memory` 일 때 필수. 시드 JSON 경로 |

✅ 없으면 부팅 실패(`getOrThrow`). △ 해당 모드에서만 필수.

> `.env.example` 은 `ACCESS_CODE_PEPPER` / `DATA_SOURCE` 가 빠져 있고
> `PUBLIC_POLL_ID` 를 uuid 라고 적어놨다. 실제 값은 짧은 슬러그(`mu16`)다.

---

## 구조

```
src/
├── main.ts                        부팅. prefix, CORS, listen
├── app.module.ts                  ConfigModule, Throttler, GET /api/health
├── shared/
│   ├── kernel/
│   │   ├── result.ts              Result<T> — 도메인은 예외를 던지지 않는다
│   │   └── domain-error.ts        DomainErrors. contract 의 에러 코드만 쓴다
│   └── http/
│       ├── http-result.ts         Result → HTTP 상태코드 번역 (유일 지점)
│       ├── zod-validation.pipe.ts contract 스키마를 그대로 검증에 쓴다
│       └── poll-id.pipe.ts        :pollId 를 pollIdSchema 로 검증
└── modules/poll/
    ├── domain/                    바깥을 모르는 층. 여기만 테스트가 있다
    │   ├── poll.ts                상태 전이표 (DRAFT→OPEN→CLOSED→REVEALING→FINISHED)
    │   ├── ballot.ts              표 검증 전부. Ballot.create()
    │   ├── access-code.ts         isUsed(), evaluableCandidates()
    │   ├── candidate.ts / criterion.ts
    │   ├── ranking-policy.ts      MeanPerVoterRankingPolicy
    │   ├── reveal-projection.ts   커서 → 화면 상태 투영
    │   └── ports.ts               필요한 바깥 세계의 인터페이스 + DI 심볼
    ├── application/               유즈케이스. 조립과 순서만 담당
    │   ├── verify-access-code.usecase.ts
    │   ├── cast-ballot.usecase.ts
    │   ├── close-poll.usecase.ts
    │   └── reveal.usecase.ts      Advance / GetState
    ├── infrastructure/            포트 구현. 도메인은 이 층을 모른다
    │   ├── code.adapters.ts       HMAC 해셔, JWT 토큰, Clock
    │   ├── supabase.provider.ts
    │   ├── supabase-*.repository.ts / supabase-reveal.adapter.ts
    │   └── in-memory/             store, repositories, demo-seeder
    ├── presentation/              컨트롤러 + AdminGuard
    └── poll.module.ts             포트↔구현 바인딩의 유일한 지점 (bindPort)
```

의존 방향은 `presentation → application → domain` 한 방향뿐이다.
`infrastructure` 는 `domain/ports.ts` 를 구현할 뿐이고, 둘을 잇는 곳은
`poll.module.ts` 의 `bindPort()` 하나다. `DATA_SOURCE` 판단은 반드시
`useFactory` 안 — 모듈 로드 시점에 읽으면 ConfigModule 이 `.env` 를 읽기 전이다.

---

## API

`pollId` 는 uuid 가 아니라 슬러그다 (`^[a-z0-9][a-z0-9-]{1,31}$`). 현재 값은 `mu16`.

### 공개

#### `GET /api/health`
기동 확인. Cloud Run 콜드스타트 프리워밍용.
```json
{ "ok": true, "at": "2026-08-28T12:00:00.000Z" }
```

#### `POST /api/polls/:pollId/access-codes/verify`
통행코드를 검증하고 투표 화면에 필요한 전부를 한 번에 돌려준다.
자기 팀은 서버에서 이미 제외되어 나가므로 프론트가 필터링하지 않는다.

레이트 리밋 **IP 당 분당 10회**. 코드가 6자라 무차별 대입이 실제 위협이다.

```jsonc
// 요청
{ "code": "MU16A7K2QM" }   // 소문자·하이픈·공백은 서버가 정리한다

// 200
{
  "ballotToken": "eyJ...",              // 제출에 쓰는 단기 토큰
  "poll": { "id": "mu16", "title": "...", "status": "OPEN",
            "rules": { "pointsPerCriterion": 100, "excludeOwnTeam": true } },
  "criteria":  [ { "id": "uuid", "key": "...", "name": "...", "weight": 1, "displayOrder": 0 } ],
  "candidates":[ { "id": "uuid", "slug": "...", "name": "...", "platform": "WEB", ... } ],
  "ownTeamId": "uuid | null"
}
```
| 에러 | 상태 | |
| --- | --- | --- |
| `INVALID_ACCESS_CODE` | 401 | 없는 코드와 다른 투표의 코드를 같은 에러로 묶는다 |
| `ACCESS_CODE_ALREADY_USED` | 409 | |
| `POLL_NOT_OPEN` | 409 | `status !== OPEN` |
| `NOT_FOUND` | 404 | 투표 없음 / 평가 대상 없음 |
| `TOO_MANY_ATTEMPTS` | 429 | |

#### `POST /api/polls/:pollId/ballots`
표 제출. `Authorization: Bearer <ballotToken>` 필수.
**pollId 는 토큰 안의 값을 신뢰한다** — 경로 값은 형식 검증만 받고 쓰이지 않는다.

레이트 리밋 분당 20회.

```jsonc
// 요청
{ "allocations": [
    { "criterionId": "uuid", "scores": [ { "candidateId": "uuid", "points": 30 } ] }
] }

// 200
{ "ballotId": "uuid", "submittedAt": "2026-08-28T12:00:00.000Z" }
```
| 에러 | 상태 | |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | 토큰 없음/위조 |
| `ALREADY_VOTED` | 409 | |
| `CRITERIA_MISMATCH` / `CANDIDATES_MISMATCH` | 422 | 항목·대상이 계약과 다름 |
| `BUDGET_EXCEEDED` | 422 | 항목 합계 > `pointsPerCriterion` |
| `INVALID_POINTS` | 422 | 음수/실수. 요청 형식 오류도 이 코드로 온다 |

중복 투표는 3중으로 막힌다 — `AccessCode.isUsed()`(도메인) →
`existsByAccessCode()`(선행 조회) → `UNIQUE(poll_id, access_code_id)`(DB, 동시 제출의 최종 방어선).

#### `GET /api/polls/:pollId/reveal`
시상식 화면 **최초 진입 / 새로고침 복원용**. 이후 갱신은 Supabase Realtime 이
payload 를 직접 실어보내므로 이 경로를 다시 부르지 않는다. 관객이 500명이어도
공개 순간의 API 요청은 0건이다.

`RevealState` 를 돌려준다 (`packages/contract/src/poll.ts` 의 `revealStateSchema`).
핵심 필드:

| 필드 | 의미 |
| --- | --- |
| `revealedSteps` / `totalSteps` | 진행된 클릭 수 / 전체 클릭 수. `revealedSteps` 가 곧 커서 |
| `revealedCells` / `totalCells` | 열린 칸 / 전체 칸 (= 팀 수 × 항목 수) |
| `nextAction` | `OPEN`(칸 열기) · `SETTLE`(행 순서 갱신) · `RANK`(등수 박기) · `NONE`(끝) |
| `rowOrder` | 화면 행 순서. **정렬은 서버가 정한다** — 클라이언트가 다시 정렬하면 SETTLE 전 대기 상태를 표현할 수 없다 |
| `cells` | 열린 칸만. 열린 순서 그대로 |
| `entries` | 등수 확정된 팀만. 최하위 → 상위 순 |
| `cursor` | `nextAction === 'OPEN'` 일 때만 채워진다 |

`NOT_FOUND` 404 — 아직 마감(`close`)하지 않아 표가 없는 경우.

### 관리자 — `x-admin-key: $ADMIN_API_KEY` 필수 (없으면 401)

되돌릴 수 없는 동작 두 개뿐이다. **통행코드 발급 API 는 없다** — 아래 "통행코드" 참고.

#### `POST /api/admin/polls/:pollId/close`
투표 마감 → 집계 확정 → 공개 단계 진입. **되돌릴 수 없다.**
여기서 순위를 스냅샷으로 못 박기 때문에, 공개 도중 늦은 표가 들어와도 이미
발표한 순위가 흔들리지 않는다.

```json
{ "frozenCount": 6, "totalRanks": 6, "totalCells": 24 }
```
`POLL_NOT_OPEN` 409 · `RESULTS_NOT_FROZEN` 409 · `NOT_FOUND` 404.

#### `POST /api/admin/polls/:pollId/reveal/advance`
사회자가 누르는 버튼. 한 클릭 = 칸 하나 공개 / 행 순서 갱신 / 등수 하나 공개.
`RevealState` 를 돌려주고, 같은 내용이 Realtime 으로 관객 화면에 브로드캐스트된다.
마지막 단계까지 가면 투표가 `FINISHED` 로 넘어간다.

동시 클릭은 어댑터의 조건부 UPDATE 가 막는다 (커서가 그 사이 움직였으면 반영하지 않는다).

`POLL_NOT_REVEALING` 409 · `REVEAL_EXHAUSTED` 409.

#### `GET /api/admin/polls/:pollId/reveal`
공개 엔드포인트와 같은 응답. 관리자 화면 편의용.

### 에러 형식

전부 동일하다.
```json
{ "code": "BUDGET_EXCEEDED", "message": "항목별 배분 점수 합계가 상한을 초과했습니다.", "details": {} }
```
`code` 는 `packages/contract` 의 `API_ERROR_CODES` 중 하나. 프론트가 분기하는
값이 곧 계약이다. 상태코드 매핑은 `shared/http/http-result.ts` 한 곳에 있다.

레이트 리밋 전역 기본값은 IP 당 분당 60회.

---

## 도메인 규칙

**상태 전이** — 표에 없는 전이는 전부 거부된다.
```
DRAFT → OPEN → CLOSED → REVEALING → FINISHED
```
`DRAFT → OPEN` 은 API 가 없다. SQL 로 직접 올린다.
```sql
update polls set status = 'OPEN', opened_at = now() where id = 'mu16';
```

**통행코드** — 10자. 종이에 인쇄해 손으로 입력하는 경로가 있어 혼동되는 글자를
쓰지 않는다. DB 에는 평문이 아니라 결정적 해시만 저장된다.

**서버는 코드를 발급하지 않는다.** 로컬에서 만들어 DB 에 직접 넣는다.
`AccessCodeRepository` 에 쓰기 메서드가 없으므로, `ADMIN_API_KEY` 가 새더라도
코드를 새로 찍어낼 수는 없다.

발급기는 레포에 없다 (`.gitignore` 의 `tools/`).

평문 코드는 발급 시점의 배포 대장 CSV 에만 있다. DB 에는 해시만 남으므로 그
파일을 잃으면 되살릴 방법이 없다 — 재발급뿐이다.

**순위** — `MeanPerVoterRankingPolicy`. 평가자 1인당 평균으로 정규화한다.
팀별 평가자 수가 다르므로(자기 팀 제외 + 회장단) 총점을 그대로 쓰면 안 된다.

**공개 대본** — 커서는 "진행된 단계 수" 정수 하나다. 계산이 결정적이므로 이
숫자만으로 화면을 복원할 수 있다. 순위를 커서로 쓰면 동점(1,2,2,4)에서 순위에
구멍이 생겨 존재하지 않는 순위에 커서가 닿는 빈 클릭이 발생하는데, 단계
인덱스에는 그 문제가 없다. 대본 생성은 `packages/contract/src/reveal-order.ts`
에 있고 FE/BE 가 같은 코드를 쓴다.

---

## 데이터 소스

### `DATA_SOURCE=supabase` (기본)

`service_role` 키로 붙는다. RLS 를 전부 우회하므로 **이 클라이언트는 프론트에
나가지 않는다.**

| 테이블 | 용도 |
| --- | --- |
| `polls` | 투표 한 판. `id` 는 슬러그, `check` 제약이 `pollIdSchema` 와 같은 형식을 막는다 |
| `criteria` | 평가 항목 |
| `candidates` | 후보 팀 |
| `members` | 팀원 명단. **실명이 들어가는 유일한 테이블. anon 정책이 없다.** 서버는 읽지 않는다 — 로컬 발급기만 본다 |
| `access_codes` | `code_hash` 만. 평문 없음 |
| `ballots` / `ballot_scores` | 표와 점수 |
| `poll_results` | 마감 시 확정된 순위 스냅샷 |
| `reveal_state` | 커서 + 투영된 화면 payload. **anon 이 읽을 수 있는 유일한 테이블이고 Realtime 발행 대상도 여기뿐** |

RPC 두 개는 `security definer` + `service_role` 에게만 `execute` 를 준다.
- `cast_ballot(poll_id, access_code_id, allocations)` — 표·점수 저장과 코드 사용 처리를 한 트랜잭션으로
- `voter_counts_by_candidate(poll_id)` — 후보별 평가자 수

서버 코드에 `members` 를 읽는 경로는 없다. 실명 테이블에 닿는 것은 로컬
발급기 하나뿐이다.

`members` 와 `access_codes` 는 **의도적으로 FK 로 잇지 않았다.** 이었다면
`ballot_scores → ballots → access_codes → members` 조인 한 번으로 "누가 어느
팀에 몇 점 줬는지"가 나온다. 대응은 `label` 로만 한다.

### `DATA_SOURCE=memory`

Supabase 없이 전체 플로우가 돈다. `DEMO_SEED_PATH` 에 시드
JSON(`poll`/`criteria`/`candidates`)을 준다. 없으면 부팅 시 명시적으로
실패한다 — 조용히 빈 상태로 뜨는 게 더 나쁘다.

---

## 테스트

```
domain/ballot.spec.ts                       표 검증 전 케이스
domain/ranking-policy.spec.ts               1인당 평균 정규화, 동점
infrastructure/in-memory/reveal-cursor.spec.ts  커서 전진과 복원
shared/reveal-order.spec.ts                 대본 생성
shared/team-name.spec.ts                    **...** 파싱
```

`pnpm --filter @vote/backend test`

---

## 배포 (Cloud Run)

```bash
docker build --platform linux/amd64 -f apps/backend/Dockerfile -t <image> .
```
멀티스테이지. 런타임 이미지에는 `dist/` 와 prod 의존성만 들어간다.
`PORT` 는 Cloud Run 이 주입하고, `CORS_ORIGIN` 에 프론트 도메인을 넣어야 한다.

프로덕션 전에 `ACCESS_CODE_PEPPER` · `BALLOT_JWT_SECRET` · `ADMIN_API_KEY` 를
`openssl rand -hex 32` 로 새로 만든다. `ADMIN_API_KEY` 하나가 되돌릴 수 없는
두 동작(마감, 순위 공개)을 모두 연다.
