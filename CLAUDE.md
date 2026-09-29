# CSM

Spesifikasi: docs/PRD-v2.md. Bahasa UI, pesan error, dan komentar kode: Bahasa Indonesia.

## Aturan data (wajib)

- Data resi asli (foto, PDF, workbook berisi paspor/HP) tidak pernah masuk repo atau diproses tool apa pun
  yang mengirim isi file ke LLM. Simpan di luar repo; `data/` dan `samples/` sudah di-ignore.
- `HF_TOKEN` hanya untuk services/ml (`ml-worker`). Jangan pernah di env Next.js atau kode browser.

## Perintah

- `npm run local` (semua service + DB + migrasi + gazetteer) · `npm run typecheck && npm test` · `npm run ml:test`
- Per paket: `npm run <skrip> -w @csm/api -- <argumen>`. Package manager: npm workspaces (bukan pnpm).
- Skema DB: apps/api/prisma/schema.prisma. Aturan yang tidak bisa ditulis di Prisma (CHECK, trigger,
  indeks trigram) ada di SQL migrasi. UUID memakai `gen_random_uuid()` agar insert dari Python juga jalan.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Build graph baru hanya dengan `graphify extract . --code-only` dan `graphify cluster-only . --no-label`.
  Jangan jalankan extract tanpa `--code-only` atau `label`: keduanya mengirim isi file ke LLM.
