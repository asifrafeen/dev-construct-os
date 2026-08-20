FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ARG ci_build

# Free-form build-pipeline probe, passed by the release pipeline as an extra
# --build-arg. ARG alone is not enough: it is substituted into instruction text,
# but Vite reads process.env, so the value has to be exported into the build
# process. Vite gives a process.env VITE_* value priority over .env.<mode>, so
# this overrides the file when the pipeline supplies one and is empty otherwise.
# Never pass a secret this way - build args are visible in this stage's history.
ARG VITE_BLOCKS_EXTRA_ARG
ENV VITE_BLOCKS_EXTRA_ARG=$VITE_BLOCKS_EXTRA_ARG

RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build:${ci_build}

FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD wget -qO- http://localhost:8080/ || exit 1