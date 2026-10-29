# One image, two containers: the demo page (demo.js) and the traffic generator
# (simulator.js). They differ only by `command` in demo.yaml, so there is nothing
# to keep in sync between two Dockerfiles.
#
# arm64-safe: no --platform, pinned base, no amd64 binaries. Fargate is Graviton.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# No LaunchDarkly keys baked in. Every one is injected at runtime, because the
# image is built once at publish time and reused by every launch.
COPY --chown=node:node package.json ./
COPY --chown=node:node *.js *.html ./
USER node
EXPOSE 8765

# Same route demo.yaml health-checks. No external calls, so a LaunchDarkly or
# network blip cannot mark the task unhealthy.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.DEMO_PORT||8765)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "demo.js"]
