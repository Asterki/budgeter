FROM node:22-bookworm AS build

# Budget sync relay image: docker build -t budget-relay ./server
LABEL org.opencontainers.image.title="budget-sync-relay"
LABEL org.opencontainers.image.description="End-to-end encrypted sync relay for Budget"

RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV DB_PATH=/data/budget.db
ENV PORT=8787
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist/index.js"]
