-- Input resi manual (sebelum VLM siap) dan pencatat resi untuk panel duplikat (PRD F7).
ALTER TYPE "ReceiptSource" ADD VALUE IF NOT EXISTS 'manual';

ALTER TABLE "receipts" ADD COLUMN "created_by" UUID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
