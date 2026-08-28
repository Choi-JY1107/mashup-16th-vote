# Cloud Run 용 멀티스테이지 빌드.
# 클린 아키텍처를 그대로 컨테이너에 담기 때문에 서버리스 제약을 받지 않는다.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contract/package.json packages/contract/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @vote/backend... || pnpm install --filter @vote/backend...

COPY packages/contract packages/contract
COPY apps/backend apps/backend
RUN pnpm --filter @vote/contract build && pnpm --filter @vote/backend build
RUN pnpm --filter @vote/backend --prod deploy /out

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./dist
# Cloud Run 이 PORT 를 주입한다.
EXPOSE 8080
CMD ["node", "dist/main.js"]
