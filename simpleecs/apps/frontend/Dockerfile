FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci --no-audit --no-fund
COPY apps/frontend apps/frontend
RUN npm run build -w apps/frontend && npm prune --omit=dev --workspace=apps/frontend

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/frontend ./apps/frontend
USER node
EXPOSE 3000
CMD ["node", "apps/frontend/server.mjs"]
