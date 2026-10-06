#!/usr/bin/env bash
# Jalankan CSM lengkap di MacBook dengan satu perintah:  npm run local
#   --no-ml    lewati service ML (cukup web + api)
#   --reset    hapus database lokal dulu (data uji hilang), lalu mulai dari nol
# Hentikan dengan Ctrl+C. Database tetap menyala; matikan dengan: npm run db:down
set -euo pipefail
cd "$(dirname "$0")/.."

WITH_ML=1
RESET=0
for arg in "$@"; do
  case "$arg" in
    --no-ml) WITH_ML=0 ;;
    --reset) RESET=1 ;;
    *) echo "Opsi tidak dikenal: $arg (pakai --no-ml atau --reset)"; exit 1 ;;
  esac
done

step() { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }
COMPOSE=(docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml --env-file .env)

step "Cek prasyarat"
command -v node >/dev/null || fail "Node.js belum terpasang (butuh versi 22+)."
docker info >/dev/null 2>&1 || fail "Docker belum berjalan. Buka Docker Desktop lalu ulangi."
if [ "$WITH_ML" = 1 ] && ! command -v uv >/dev/null; then
  echo "uv tidak ditemukan → service ML dilewati (pasang: brew install uv)."
  WITH_ML=0
fi

if [ ! -f .env ]; then
  step "Membuat .env dari .env.example"
  cp .env.example .env
  echo "Isi GOOGLE_CLIENT_ID/SECRET di .env agar login Google bisa dipakai."
fi
set -a; . ./.env; set +a

if [ ! -d node_modules ]; then
  step "npm install"
  npm install
fi

if [ "$RESET" = 1 ]; then
  step "Reset database lokal"
  "${COMPOSE[@]}" down -v
fi

step "Menyalakan database (localhost:${DB_PORT:-5433})"
"${COMPOSE[@]}" up -d db >/dev/null
for _ in $(seq 1 60); do
  "${COMPOSE[@]}" exec -T db pg_isready -U "${POSTGRES_USER:-csm}" >/dev/null 2>&1 && break
  sleep 1
done
"${COMPOSE[@]}" exec -T db pg_isready -U "${POSTGRES_USER:-csm}" >/dev/null 2>&1 || fail "Database tidak siap dalam 60 detik."

step "Migrasi database"
npm run db:migrate --silent

WILAYAH=$("${COMPOSE[@]}" exec -T db psql -U "${POSTGRES_USER:-csm}" -d "${POSTGRES_DB:-csm}" -tAc "SELECT count(*) FROM wilayah" | tr -d '[:space:]')
if [ "${WILAYAH:-0}" = "0" ]; then
  step "Import gazetteer wilayah (sekali saja)"
  npm run wilayah:import -w @csm/api --silent
fi

if [ -n "${SEED_SUPER_ADMIN_EMAIL:-}${SEED_ADMIN_EMAIL:-}" ]; then
  step "Akun awal (SEED_* di .env)"
  npm run users:seed -w @csm/api --silent
fi

NAMES="api,web"
COLORS="blue,green"
CMDS=("npm run dev -w @csm/api" "npm run dev -w @csm/web")
if [ "$WITH_ML" = 1 ]; then
  step "Menyiapkan service ML"
  (cd services/ml && uv sync --quiet)
  NAMES="$NAMES,ml,worker"
  COLORS="$COLORS,magenta,yellow"
  CMDS+=("uv run --directory services/ml uvicorn csm_ml.api:app --port 8000 --reload --reload-dir src" "uv run --directory services/ml python -m csm_ml.worker")
fi

step "CSM berjalan → http://localhost:3000  (Ctrl+C untuk berhenti)"
exec npx concurrently --kill-others-on-fail -n "$NAMES" -c "$COLORS" "${CMDS[@]}"
