# Triva WiFi — Backend Dockerfile
# Single-process container running the API and background jobs.
# No PM2 is used; Docker restart policy provides supervision.

FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies for native modules (optional but safe).
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# curl is required for the Docker HEALTHCHECK.
RUN apk add --no-cache curl ca-certificates

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

RUN mkdir -p logs

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:4000/health/db || exit 1

CMD ["node", "dist/index.js"]
