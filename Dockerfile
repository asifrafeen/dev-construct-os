FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ARG ci_build=dev

# Build-time configuration, mirrored from .env. Every value here is public /
# client-safe (it ends up in the bundle anyway). ARG alone is not enough: it is
# substituted into instruction text, but Vite reads process.env, so each value
# has to be exported into the build process. Vite gives a process.env VITE_*
# value priority over .env.<mode>, so the pipeline can override any of these
# with --build-arg; otherwise the defaults below apply.
# Never pass a secret this way - build args are visible in this stage's history.
ARG VITE_BLOCKS_API_URL=https://blocksapi.dev.slsblx.com
ARG VITE_BLOCKS_PROJECT_KEY=D2d61e575239647a9820d1a44e398f52c
ARG VITE_BLOCKS_OIDC_CLIENT_ID=b209714a-01f9-41d1-a0a3-df134084db86
ARG VITE_BLOCKS_REDIRECT_URI=https://dzcvil-ehxqx.dev.slsblx.com/login/callback
ARG VITE_BLOCKS_HOSTED_LOGIN=true
# Free-form build-pipeline probe, passed by the release pipeline as an extra
# --build-arg. Empty unless the pipeline supplies one.
ARG VITE_BLOCKS_EXTRA_ARG

# Blocks Release turns every key in the repo's secret set (`blocks release secrets
# sync`) into a --build-arg — but Kaniko silently drops any arg the Dockerfile does not
# declare. So every optional knob the app reads is declared here, empty by default, and
# shows up on the Build & release page when the pipeline supplies it.
#
# Release injects no build metadata of its own: add VITE_GIT_SHA / VITE_BUILD_ID /
# VITE_GIT_BRANCH to the secret set if you want them stamped into /version.json.
ARG VITE_GIT_SHA
ARG VITE_GIT_BRANCH
ARG VITE_BUILD_ID
ARG VITE_BLOCKS_I18N_MODULES
ARG VITE_BLOCKS_NOTIFIER_REALTIME
ARG VITE_BLOCKS_NOTIFY_METHODS
ARG VITE_BLOCKS_HEARTBEAT_ID
ARG VITE_BLOCKS_HEARTBEAT_INTERVAL
ARG VITE_BLOCKS_MONITOR_PATH

ENV VITE_BLOCKS_API_URL=${VITE_BLOCKS_API_URL}
ENV VITE_BLOCKS_PROJECT_KEY=${VITE_BLOCKS_PROJECT_KEY}
ENV VITE_BLOCKS_OIDC_CLIENT_ID=${VITE_BLOCKS_OIDC_CLIENT_ID}
ENV VITE_BLOCKS_REDIRECT_URI=${VITE_BLOCKS_REDIRECT_URI}
ENV VITE_BLOCKS_HOSTED_LOGIN=${VITE_BLOCKS_HOSTED_LOGIN}
ENV VITE_BLOCKS_EXTRA_ARG=${VITE_BLOCKS_EXTRA_ARG}
ENV VITE_GIT_SHA=${VITE_GIT_SHA}
ENV VITE_GIT_BRANCH=${VITE_GIT_BRANCH}
ENV VITE_BUILD_ID=${VITE_BUILD_ID}
ENV VITE_BLOCKS_I18N_MODULES=${VITE_BLOCKS_I18N_MODULES}
ENV VITE_BLOCKS_NOTIFIER_REALTIME=${VITE_BLOCKS_NOTIFIER_REALTIME}
ENV VITE_BLOCKS_NOTIFY_METHODS=${VITE_BLOCKS_NOTIFY_METHODS}
ENV VITE_BLOCKS_HEARTBEAT_ID=${VITE_BLOCKS_HEARTBEAT_ID}
ENV VITE_BLOCKS_HEARTBEAT_INTERVAL=${VITE_BLOCKS_HEARTBEAT_INTERVAL}
ENV VITE_BLOCKS_MONITOR_PATH=${VITE_BLOCKS_MONITOR_PATH}

# Release maps the branch to ci_build (dev, test, stg, iat, uat, prodshadow, preprod,
# prod) — package.json has a build:<env> script for each, so no branch breaks the build.
RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build:${ci_build}

FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD wget -qO- http://localhost:8080/ || exit 1
