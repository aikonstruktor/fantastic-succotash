FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci --no-audit --no-fund
COPY apps/backend apps/backend
RUN npm run build -w apps/backend && npm prune --omit=dev --workspace=apps/backend

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3001 AGENT_MODE=agentcore COPILOTKIT_TELEMETRY_DISABLED=true
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/backend ./apps/backend
USER node
EXPOSE 3001
CMD ["node", "apps/backend/dist/index.js"]
