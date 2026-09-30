# Build dari root repo: docker build -f services/ml/Dockerfile .
# Satu image, dua proses: `ml` (HTTP internal) dan `ml-worker` (antrian job) — lihat infra/docker-compose.yml.
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
WORKDIR /app/services/ml
COPY services/ml/pyproject.toml services/ml/uv.lock services/ml/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/ml ./
COPY packages/shared/schemas /app/packages/shared/schemas
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD ["uvicorn", "csm_ml.api:app", "--host", "0.0.0.0", "--port", "8000"]
