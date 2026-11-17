# Build from the repository root: docker build -f docker/Dockerfile .

# Alpine works because sift has no native dependencies; PGlite is WebAssembly.
FROM node:24-alpine AS base
WORKDIR /app

# Stage 1: production dependencies. Installed here so pnpm and its store stay out of the final image.
FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Stage 2: the page, built by Next.js. Its build-only dependencies (Tailwind) and cache stay here.
FROM base AS page
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm exec next build && rm -rf .next/cache

# Stage 3: the runtime. Node runs the server's TypeScript sources directly (type stripping); Next.js serves the built page.
FROM base
ENV NODE_ENV=production SIFT_HOME=/data
# Nothing installs packages at run time. This takes npm and yarn out of reach; their bytes stay in the base layer.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
  && mkdir /data && chown node:node /data
# package.json marks the sources as ES modules; Next.js reads its config when it starts.
COPY package.json next.config.js ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY --from=page /app/.next ./.next

USER node
VOLUME /data

ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/cli/main.ts"]
CMD ["run"]
