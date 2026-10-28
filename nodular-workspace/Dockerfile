
# NODULAR WORKSPACE - Production Dockerfile
# Free 2026 stack - no paid APIs

FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ vips-dev
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts || npm install --production --ignore-scripts
# Rebuild sharp for alpine
RUN npm rebuild sharp || true

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build frontend
RUN npm run build || npx vite build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Copy deps + built files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY package.json ./

# Sharp needs vips
RUN apk add --no-cache vips

EXPOSE 3001
EXPOSE 5173

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["npm", "run", "server"]
