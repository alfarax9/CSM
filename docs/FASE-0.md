# Checklist Fase 0 — Fondasi + spike

Status per 29 Sep 2026. Gate Fase 0 (PRD-v2 §13): ekspor spike identik dengan workbook Cont 258 · VLM ≥ 80% field benar
(≥ 95% field numerik) · persetujuan PDP untuk inferensi cloud. Fase 1 baru dimulai jika ketiganya lolos.

## Sudah selesai

| Step | Hasil | Bukti |
| --- | --- | --- |
| Monorepo (web, api, ml, shared) | Next.js 15, Express 5, Prisma 7, FastAPI | `npm run typecheck && npm test`, `npm run ml:test` |
| Skema database 24 tabel | Migrasi awal + CHECK serial, trigger audit append-only, indeks trigram | Diuji langsung ke Postgres |
| Gazetteer wilayah | 91.599 wilayah, Kepmendagri No 300.2.2-2138 Tahun 2025 | Contoh resi 35616 & Batumarmar/Pamekasan cocok; fuzzy "Tlung Agung" → Tulungagung |
| Login Google (kode) | PKCE + state + nonce, domain/whitelist, ikat `sub`, sesi JWT 15 mnt + refresh 7 hari, audit | 9 test integrasi |
| Alat spike ExcelJS | Uji buka/simpan + sisip baris + formula total + merge cell | LULUS di template tiruan |
| Alat spike VLM | Pecah PDF, label dari sheet Data Laut, akurasi per field, p95, biaya | Diuji dengan klien tiruan |
| Docker | Image api, web, ml lolos uji jalan | `docker compose ... --profile prod` |
| Graphify | Graph kode lokal (`--code-only`), tanpa LLM | `graphify query "..."` |

Temuan selama pengerjaan (sudah diperbaiki):
- "2 - PCS" terbaca 35 karena aturan S→5 — sekarang satuan dibuang dulu (`parseCount` / `parse_count`).
- ExcelJS tidak memperlebar formula total saat baris disisipkan — eksportir wajib menulis ulang rentang `SUM` sendiri.

## Penyimpangan sementara dari PRD

- **Login email + password** (`AUTH_MODE=password`) menggantikan login Google untuk sementara, atas permintaan pemilik.
  Password disimpan sebagai hash scrypt; akun awal dari `SEED_*` di `.env` lokal. Kode login Google tetap ada dan aktif
  kembali dengan `AUTH_MODE=google`. **Wajib diganti sebelum website di-deploy online.**

## Yang Anda siapkan

Simpan semua data asli di **luar repo**, mis. `~/csm-data/`. Jangan taruh di `/Users/mac/CSM`.

| # | Siapkan | Dipakai untuk |
| --- | --- | --- |
| 1 | Workbook asli Container 258 (.xlsx) | Spike ExcelJS (gate) |
| 2 | PDF "Mr. Said Cont 257" + workbook final Container 257 | Spike VLM: 50 resi + label dari sheet Data Laut |
| 3 | Token Hugging Face (fine-grained, izin *Make calls to Inference Providers*) + nama penyedia + harga per 1 juta token | Spike VLM |
| 4 | Persetujuan tertulis manajemen: foto resi (paspor, HP) boleh dikirim ke penyedia inferensi cloud | Gate Fase 0 (UU PDP) |
| 5 | Google OAuth Client ID + Secret (Google Cloud Console, tipe Web application) dan domain Workspace | Login |
| 6 | Email Google Super Admin pertama | Akun pertama yang bisa login |
| 7 | Penyedia VPS (region Jakarta) + subdomain | Deploy online |
| 8 | Nama repo GitHub (jika mau CI jalan) | CI |

## Perintah setelah data siap

**Spike ExcelJS** (tidak mengirim apa pun keluar):

```bash
npm run spike:excel -w @csm/api -- --file ~/csm-data/"Container 258.xlsx" --container 258
```

Hasil di `~/csm-data/spike-excel-out/`. Buka `A-roundtrip.xlsx` dan `B-tambah-baris.xlsx` di Microsoft Excel:
tidak boleh ada dialog perbaikan, pivot harus bisa di-refresh.

**Spike VLM** (setelah poin 3 dan 4):

```bash
cd services/ml
uv run python -m csm_ml.spike_vlm pdf ~/csm-data/"Mr. Said Cont 257.pdf" --out ~/csm-data/spike/img
HF_TOKEN=hf_... HF_PROVIDER=<penyedia> uv run python -m csm_ml.spike_vlm run \
  --images ~/csm-data/spike/img --labels ~/csm-data/"Container 257.xlsx" --container 257 \
  --n 50 --out ~/csm-data/spike/hasil --price-in <USD/1jt> --price-out <USD/1jt>
```

**Login Google** (setelah poin 5 dan 6):

1. Di Google Cloud Console, redirect URI: `http://localhost:3000/api/v1/auth/google/callback` (dev) dan
   `https://<subdomain>/api/v1/auth/google/callback` (produksi).
2. Isi `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_GOOGLE_DOMAINS`, `JWT_SECRET` (≥ 32 karakter acak).
3. Daftarkan Super Admin pertama:

```bash
npm run user:create -w @csm/api -- --email <email> --name "<nama>" --role super_admin
```

**Gazetteer** (sekali per database baru, termasuk di VPS):

```bash
npm run wilayah:import -w @csm/api
```

## Belum dikerjakan (fase berikutnya)

- Fase 1 — sudah: kelola user (F8a) dan container + siklus status (F4), sesi web (halaman terlindungi, perpanjangan otomatis, keluar).
- Fase 1 — sudah: input resi manual per container (sheet Laporan Loading), deteksi Serial No ganda (F7, lapis serial
  + constraint DB), Tujuan dari gazetteer, enkripsi paspor/HP (AES-256-GCM + blind index HMAC), alur kirim/approve/tolak, pindah resi antar container (Plus 1), rekap per sales (tab Rekap Sales, pengganti PVT Loading), halaman Audit (F8d; kategori sementara dari aturan
  validasi data, nanti digabung confidence VLM), dan Statistik scan (F8b: resi unik per container/sales/hari, duplikat terpisah).
- Fase 1 — sudah: scan kamera/upload foto (cek kualitas, foto identik ditolak, URL bertanda tangan), baca otomatis dengan
  Qwen3.5-397B-A17B lewat Hugging Face (penyedia OVHcloud, Eropa) yang mengisi form + warna per field, data latih
  (extraction_runs/extracted_fields), tampilan split foto | form.
- F1 Scan kamera — selesai: kamera + bingkai A5, ambil otomatis saat kertas stabil 0,6 dtk, cek kualitas, mode batch
  (antrean, baca di latar belakang, penghitung), upload banyak foto, duplikat foto (sesi, antrean, tersimpan) & Serial No
  (panel merah + getar + bunyi, Buka resi lama / Ganti foto resi lama / Serial salah baca / Lewati). Mode offline dihapus.
- Fase 1 — belum: fast path Serial No lokal (cek duplikat sebelum baca penuh), uji akurasi pada resi asli, ekspor draft/final.
- Panduan uji: docs/QC.md.
- Fase 3: skrip backup harian, job retensi 30 hari, monitoring uptime.
