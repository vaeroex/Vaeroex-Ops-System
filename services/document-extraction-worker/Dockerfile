# syntax=docker/dockerfile:1.7
FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=random \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    TMPDIR=/tmp

RUN groupadd --system --gid 10001 worker \
    && useradd --system --uid 10001 --gid worker --home-dir /nonexistent --shell /usr/sbin/nologin worker

WORKDIR /opt/vaeroex-worker
COPY build-requirements.lock requirements.lock ./
RUN python -m pip install --require-hashes --no-deps -r build-requirements.lock \
    && python -m pip install --require-hashes --no-deps -r requirements.lock \
    && python -m pip check

COPY src ./src
COPY fixtures ./fixtures
RUN python -m compileall -q src \
    && chown -R root:root /opt/vaeroex-worker \
    && chmod -R a-w /opt/vaeroex-worker

ENV PYTHONPATH=/opt/vaeroex-worker/src
USER 10001:10001

ENTRYPOINT ["python", "-m", "vaeroex_document_worker.daemon"]
