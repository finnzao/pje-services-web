FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

COPY --from=base /app/package.json ./
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/server.js"]
