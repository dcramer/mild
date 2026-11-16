# Build from the repository root: docker build -f docker/Dockerfile .

# Alpine works because sift has no native dependencies; PGlite is WebAssembly.
FROM node:24-alpine AS base
WORKDIR /app

# Stage 1: production dependencies. Installed here so pnpm and its store stay out of the final image.
FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter sift

# Stage 2: the dashboard's static assets. None of its dependencies reach the final image.
FROM base AS web
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter sift-web
COPY src/dashboard/types.ts src/dashboard/types.ts
COPY web web
RUN pnpm --filter sift-web build

# Stage 3: the runtime. Node runs the TypeScript sources directly (type stripping); there is no build step for them.
FROM base
ENV NODE_ENV=production SIFT_HOME=/data
# Nothing installs packages at run time. This takes npm and yarn out of reach; their bytes stay in the base layer.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
  && mkdir /data && chown node:node /data
# package.json marks the sources as ES modules.
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY --from=web /app/web/dist ./web/dist

USER node
VOLUME /data

ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/cli/main.ts"]
CMD ["run"]
