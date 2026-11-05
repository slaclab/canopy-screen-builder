# Build stage. The screen IR is consumed as the published
# `@slaclab/canopy-screen-ir` package, so there is no workspace package to copy.
FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy manifests first so the install layer caches independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# @slaclab/canopy-screen-ir comes from the public npm registry, so the install
# needs no token.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# Sub-path the app is served under, with a trailing slash. Vite rewrites asset
# URLs against it, so it must match the ingress path or every asset 404s.
ARG BASE_PATH=/screen-builder/
ENV BASE_PATH=$BASE_PATH

# Same-origin path the browser posts conversions to; nginx proxies it to Canopy
# and adds the API key. Deliberately a path, not an origin — no VITE_CANOPY_API_KEY
# build arg exists, because a Vite-inlined key would ship to every browser.
ARG VITE_CANOPY_BASE_URL=/screen-builder/canopy
ENV VITE_CANOPY_BASE_URL=$VITE_CANOPY_BASE_URL

RUN pnpm build

# Runtime stage.
FROM nginx:alpine

# Rendered into /etc/nginx/conf.d/default.conf at startup by the base image's
# envsubst entrypoint.
COPY .nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Restrict substitution to the vars the template actually uses. Without a filter
# the entrypoint substitutes *every* env var, so any stray variable sharing a
# name with an nginx runtime variable ($host, $scheme, ...) would silently blank
# it out in the rendered config.
ENV NGINX_ENVSUBST_FILTER='^(BASE_PATH|CANOPY_UPSTREAM|CANOPY_API_KEY|NGINX_LOCAL_RESOLVERS)$'

# Opt in to 15-local-resolvers.envsh, which reads /etc/resolv.conf into
# NGINX_LOCAL_RESOLVERS for the template's `resolver` line. Unset, the variable
# is empty and nginx fails to start on an invalid `resolver` directive.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

# Must match the builder stage's BASE_PATH: Vite baked this prefix into the
# asset URLs, and the nginx template's `location` blocks are rendered from it.
ARG BASE_PATH=/screen-builder/
ENV BASE_PATH=$BASE_PATH

# Overridden by the Deployment to the in-cluster service's *fully qualified*
# name (nginx's resolver ignores search domains, so a short name never resolves);
# this default only makes a bare `docker run` serve the static app without a
# working converter.
ENV CANOPY_UPSTREAM=http://canopy-api:8000
ENV CANOPY_API_KEY=""

# Nest the build output under the base path rather than at the document root.
# nginx resolves `/screen-builder/index.html` as `$root/screen-builder/index.html`,
# so a flat copy sends `try_files` chasing a path that doesn't exist and nginx
# fails the request with a 500 redirect cycle instead of serving the app.
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html${BASE_PATH}

# Listen on 8080 and run unprivileged, matching the securityContext in the
# Kubernetes manifests (runAsUser 101 is nginx:alpine's `nginx` user). As a
# non-root user nginx must be able to write its pid file, rendered config, and
# temp/cache dirs, none of which are group-writable in the base image.
RUN chown -R 101:101 /usr/share/nginx/html /var/cache/nginx /etc/nginx/conf.d /run
USER 101

EXPOSE 8080
