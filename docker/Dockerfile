# Build from the repository root: docker build -f docker/Dockerfile .

# Alpine works because sift has no native dependencies; PGlite is WebAssembly.
FROM node:24-alpine AS base
WORKDIR /app

# Stage 1: the app, built by Next.js as a standalone server: its bundles and only the packages they load.
FROM base AS build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 pnpm exec next build
# The packages the command line loads, laid out as pnpm laid them out, to sit beside the server's (docker/cli-modules.ts).
RUN node --disable-warning=ExperimentalWarning --import ./docker/cli-modules.ts src/cli/main.ts help > /dev/null 2> cli-modules.txt \
  && mkdir -p cli/node_modules/.pnpm \
  && sed -n 's/^store //p' cli-modules.txt | xargs -I{} cp -a node_modules/.pnpm/{} cli/node_modules/.pnpm/ \
  && sed -n 's/^link //p' cli-modules.txt | xargs -I{} sh -c 'mkdir -p "cli/node_modules/$(dirname {})" && cp -a node_modules/{} cli/node_modules/{}'

# Stage 2: the runtime. The command line runs from its TypeScript sources (type stripping); it readies the
# database and starts the standalone server beside it (src/cli/next.ts).
FROM base
ENV NODE_ENV=production SIFT_HOME=/data NEXT_TELEMETRY_DISABLED=1
# Nothing installs packages at run time. This takes npm and yarn out of reach; their bytes stay in the base layer.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
  && mkdir /data && chown node:node /data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/cli/node_modules ./node_modules
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY src ./src

USER node
VOLUME /data

ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/cli/main.ts"]
CMD ["run"]
