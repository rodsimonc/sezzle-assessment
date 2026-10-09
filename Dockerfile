# Builds the frontend and the backend, then ships one small image that serves both.
# The build context is the repo root: docker build -t calculator:1.0.0 .
#
# Base images, pinned by exact tag (checked 2026-10-09):
#   node:22.23.2-alpine3.23                    build stage for the React app
#   golang:1.27.2-alpine3.23                   build stage for the Go service (1.27.0 has stdlib CVEs fixed in 1.27.2)
#   gcr.io/distroless/static-debian13:nonroot  runtime. Its tag moves, so the digest below pins it.
#   The alpine3.23 variants pin the Alpine release, so the build stages stay reproducible.

# Stage 1: frontend bundle
FROM node:22.23.2-alpine3.23 AS web

# Only the frontend workspace gets installed. Puppeteer (root tooling for diagrams) stays out.
ENV PUPPETEER_SKIP_DOWNLOAD=1
WORKDIR /src

# The lockfile covers every workspace, so npm needs evals/package.json even though evals stay out of the image.
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/package.json
COPY evals/package.json evals/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=frontend --ignore-scripts

COPY frontend frontend
RUN npm run build --workspace=frontend

# Stage 2: backend binary
FROM golang:1.27.2-alpine3.23 AS api

WORKDIR /src/backend

# go.mod comes first so the module layer survives source edits. go.sum is copied when it exists.
COPY backend/go.mod backend/go.su[m] ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY backend ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/server ./cmd/server

# Stage 3: runtime. No shell, no package manager, no root.
FROM gcr.io/distroless/static-debian13:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3

LABEL org.opencontainers.image.title="calculator" \
      org.opencontainers.image.description="Go calculator API and the React keypad that uses it" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY --from=api /out/server /app/server
COPY --from=web /src/frontend/dist /app/web

# LISTEN_HOST=0.0.0.0 is what makes the published port reachable. Outside a container the default is loopback.
ENV STATIC_DIR=/app/web \
    LISTEN_HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080

# 65532 is the distroless "nonroot" user. A numeric id lets Kubernetes verify runAsNonRoot.
USER 65532:65532

# The image has no curl, so the binary probes its own /healthz.
HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=10s --start-interval=1s \
    CMD ["/app/server", "-healthcheck"]

# Exec form, so SIGTERM reaches the Go process and the graceful shutdown runs.
ENTRYPOINT ["/app/server"]
