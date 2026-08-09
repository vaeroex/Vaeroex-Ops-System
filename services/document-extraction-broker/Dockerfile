FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app
COPY services/document-extraction-broker/package.json services/document-extraction-broker/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY lib ./lib
COPY services/document-extraction-broker/src ./services/document-extraction-broker/src
COPY services/document-extraction-broker/tsconfig.json ./services/document-extraction-broker/tsconfig.json

RUN cd services/document-extraction-broker && \
  /app/node_modules/.bin/ncc build src/server.ts \
    -o dist \
    --minify \
    --no-cache \
    --license licenses.txt \
    --external server-only && \
  ! grep -Fq '@/lib/' dist/index.js && \
  PORT=18080 node --conditions=react-server -e \
    'require("./dist/index.js"); setTimeout(() => process.exit(0), 100)'

FROM gcr.io/distroless/nodejs22-debian12@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app
COPY --from=build --chown=65532:65532 /app/services/document-extraction-broker/dist ./
COPY --from=build --chown=65532:65532 /app/node_modules/.pnpm/server-only@0.0.1/node_modules/server-only ./node_modules/server-only

USER 65532:65532
EXPOSE 8080

CMD ["--conditions=react-server", "index.js"]
