FROM gcr.io/distroless/nodejs22-debian13@sha256:5e9868cc8ef163e86378ff90de23ca031f5bb8b2023d4f3288a5e740698919d4
ENV NODE_ENV=production
WORKDIR /srv
COPY --chown=nonroot:nonroot dist/ ./
USER nonroot
EXPOSE 8080
CMD ["--conditions=react-server", "index.js"]
