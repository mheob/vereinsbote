# syntax=docker/dockerfile:1

# The Node build of the app (apps/web/dist/node) in a small image. Build context: the repository
# root, see compose.yml. Migrations are part of the build and run when the server starts.
# Base images are pinned by digest; Renovate keeps tag and digest up to date (see README).

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
# Vite+ and its native tools are linked against libstdc++, which Alpine does not ship.
RUN apk add --no-cache libstdc++
WORKDIR /repo
# Dependencies first, so this layer is rebuilt only when a manifest or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
# Node 26 ships without Corepack; install the pnpm version that `packageManager` names. Without
# its install script pnpm runs through Node instead of its native binary, which is all a build needs.
RUN npm install --global --ignore-scripts "$(node --print "require('./package.json').packageManager")"
# The image has no Git repository, so `prepare` (`vp config`) installs no hooks.
ENV VP_GIT_HOOKS=0
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter web run build:node

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
ENV NODE_ENV=production
# The server needs Node only; npm and its dependencies would just be attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
# Nitro bundles every dependency into the output, so the image needs neither pnpm nor
# node_modules. The files stay owned by root: the server can read its code, not change it.
COPY --from=build /repo/apps/web/dist/node ./
USER node
EXPOSE 3000
# /api/health answers 200 once the server has migrated the database and reaches it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD wget --quiet --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.mjs"]
