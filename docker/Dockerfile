# Build from the repository root: docker build -f docker/Dockerfile .

# Stage 1: build the dashboard's static assets. None of its dependencies reach the final image.
FROM node:24-slim AS web
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter sift-web
COPY src/dashboard/types.ts src/dashboard/types.ts
COPY web web
RUN pnpm --filter sift-web build

# Stage 2: the runtime. Node runs the TypeScript sources directly (type stripping); there is no build step for them.
FROM node:24-slim
ENV NODE_ENV=production SIFT_HOME=/data
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter sift
COPY src ./src
COPY --from=web /app/web/dist ./web/dist

RUN mkdir /data && chown node:node /data
USER node
VOLUME /data

ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/cli/main.ts"]
CMD ["run"]
