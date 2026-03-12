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

CMD ["node", "dist/server.js"]
