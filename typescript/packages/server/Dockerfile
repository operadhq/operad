# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./

# Copy all package manifests (for dependency resolution)
COPY packages/tsconfig/ packages/tsconfig/
COPY packages/core/package.json packages/core/
COPY packages/adapter-memory/package.json packages/adapter-memory/
COPY packages/adapter-postgres/package.json packages/adapter-postgres/
COPY packages/server/package.json packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/adapter-memory/ packages/adapter-memory/
COPY packages/adapter-postgres/ packages/adapter-postgres/
COPY packages/server/ packages/server/

# Build all packages (respects dependency order via turbo)
RUN pnpm build

# ─── Production Stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace root
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy built packages
COPY --from=builder /app/packages/tsconfig/ packages/tsconfig/
COPY --from=builder /app/packages/core/ packages/core/
COPY --from=builder /app/packages/adapter-memory/ packages/adapter-memory/
COPY --from=builder /app/packages/adapter-postgres/ packages/adapter-postgres/
COPY --from=builder /app/packages/server/ packages/server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

ENV PORT=3111
ENV ADAPTER=postgres
EXPOSE 3111

CMD ["node", "packages/server/dist/cli.js"]
