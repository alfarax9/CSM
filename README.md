# CSM

Web app internal yang mengubah foto resi tulisan tangan menjadi baris Excel container.
Spesifikasi lengkap: [docs/PRD-v2.md](docs/PRD-v2.md).

## Struktur

```
apps/web         Next.js 15 — UI (token desain PRD §8)
apps/api         Express 5 + Prisma 7 — REST /api/v1, auth, RBAC, ekspor Excel
services/ml      Python/FastAPI — cek Serial No, worker ekstraksi VLM (Hugging Face), NLP
packages/shared  Konstanta, validator, schema field resi (dipakai api, web, ml)
infra/           docker-compose (produksi + override dev), Caddyfile
docs/            PRD
```

## Menjalankan di MacBook (pengembangan)

Butuh Node 22+ (npm 11), uv, dan Docker Desktop yang sedang berjalan. Satu perintah:

```bash
npm run local
```

Skrip [scripts/local.sh](scripts/local.sh) membuat `.env` jika belum ada, `npm install` jika perlu, menyalakan
Postgres (localhost:5433), menerapkan migrasi, mengimpor gazetteer wilayah jika masih kosong, lalu menjalankan
web (:3000), api (:4000), ml (:8000), dan worker sekaligus. Buka http://localhost:3000. Ctrl+C untuk berhenti.

| Opsi | Arti |
| --- | --- |
| `npm run local -- --no-ml` | Hanya web + api (tanpa service ML) |
| `npm run local -- --reset` | Hapus database lokal dulu lalu mulai dari nol |
| `npm run db:down` | Matikan database setelah selesai |

Login sementara memakai **email + password** (`AUTH_MODE=password`). Isi `SEED_SUPER_ADMIN_*` dan `SEED_ADMIN_*`
di `.env` lokal; `npm run local` membuat akunnya otomatis. Kredensial tidak pernah ditulis di file repo.

Akun pertama untuk login Google (`AUTH_MODE=google`): `npm run user:create -w @csm/api -- --email ... --name ... --role super_admin`
(email Gmail otomatis masuk whitelist). Status Fase 0 dan data yang perlu disiapkan: [docs/FASE-0.md](docs/FASE-0.md).

## Test

```bash
npm run typecheck && npm test    # shared + api
npm run ml:test                  # services/ml (test antrian butuh DATABASE_URL & npm run db:up)
```

## Produksi (VPS)

```bash
SITE_DOMAIN=csm.namaperusahaan.co.id docker compose -f infra/docker-compose.yml --env-file .env --profile prod up -d --build
```

Hanya Caddy yang membuka port 80/443. Database, api, web, dan ml ada di network internal;
hanya `ml-worker` (pemegang `HF_TOKEN`) dan Caddy yang boleh keluar ke internet.

## Aturan data

- **Data resi asli (foto, PDF, workbook berisi paspor/HP) tidak pernah masuk repo.** Simpan di luar repo;
  folder `data/` dan `samples/private/` sudah di-`.gitignore`.
- `HF_TOKEN` hanya untuk service ml. Jangan pernah taruh di env Next.js.
- Retensi: foto dan data pribadi dihapus/dianonimkan 30 hari setelah container Closed (PRD §12).
