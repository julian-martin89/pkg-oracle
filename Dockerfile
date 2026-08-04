# syntax=docker/dockerfile:1

# ---- deps: install once with full dev deps, cached across builds --------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build: compile TypeScript -> dist -----------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

# ---- runtime: minimal image, no build tools, no source -------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as an unprivileged user rather than root.
RUN addgroup -S oracle && adduser -S oracle -G oracle
USER oracle

COPY --from=build --chown=oracle:oracle /app/node_modules ./node_modules
COPY --from=build --chown=oracle:oracle /app/dist ./dist
COPY --chown=oracle:oracle package.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
