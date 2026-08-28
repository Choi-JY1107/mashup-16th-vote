# 매쉬업 16기 투표 사이트

Mash-Up 16기 프로젝트 투표 · 시상식 순위 공개. pnpm 모노레포.

```
apps/backend      NestJS API          → apps/backend/README.md
apps/frontend     SvelteKit 웹        → apps/frontend/README.md
packages/contract FE/BE 공유 zod 계약
```

## 시작

```bash
pnpm install
cp .env.example apps/backend/.env      # 값 채우기
cp .env.example apps/frontend/.env     # PUBLIC_* 만 있으면 된다
pnpm dev                               # contract 빌드 → backend + frontend
```

`pnpm test` · `pnpm typecheck` · `pnpm lint:css`

## 진행 순서

```
1. DRAFT → OPEN     SQL 로 직접        update polls set status='OPEN', opened_at=now() where id='mu16';
2. 통행코드 발급     로컬 발급기 → SQL  apps/backend/README.md 의 "통행코드"
3. 투표             /  →  /vote
4. 마감·집계 확정   /admin             되돌릴 수 없다
5. 순위 공개        /admin → /live     한 클릭에 한 칸
```

## 주의

- `.env` 는 커밋하지 않는다. `ACCESS_CODE_PEPPER` 를 바꾸면 이미 발급된 코드가 전부 무효가 된다.
- `SUPABASE_SERVICE_ROLE_KEY` 는 RLS 를 전부 우회한다. 프론트·`PUBLIC_*` 에 절대 넣지 않는다.
- 통행코드 평문은 발급 시점의 CSV 에만 있다. DB 에는 해시만 남는다.
