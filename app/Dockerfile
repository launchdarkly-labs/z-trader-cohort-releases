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
# The browser SDK bundles the page serves itself. Without these the page loads
# and renders nothing, because its module script 404s.
COPY --chown=node:node vendor ./vendor
USER node
EXPOSE 8765

# Deliberately NO HEALTHCHECK.
#
# Both containers run from this one image, and only `web` serves HTTP. A baked-in
# probe is inherited by the `traffic` sidecar, which has no port of its own — and
# the depot marks every container essential: true, so one container reported
# unhealthy takes the whole task down and verification fails.
#
# The depot health-checks the ingress container through its load balancer using
# runtime.ingress.healthCheck.path in demo.yaml, so nothing is lost. This matches
# the reference demos: dd-hello-depot has no HEALTHCHECK, and the two-container
# apex demo has one only on its ingress container, not on its sidecar.

CMD ["node", "demo.js"]
