-- Ekstensi (PRD §9): fuzzy search alamat dan enkripsi kolom pribadi.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('super_admin', 'admin', 'sales');

-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('draft', 'loading', 'locked', 'shipped', 'unloading', 'closed');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('captured', 'processing', 'needs_review', 'submitted', 'ready', 'approved', 'exported', 'rejected');

-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('camera', 'pdf_import', 'excel_import');

-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('koper', 'karton', 'hambal', 'selimut', 'drum', 'kotak_besi', 'karung');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('accepted', 'duplicate', 'serial_misread', 'unreadable', 'rejected_quality');

-- CreateEnum
CREATE TYPE "DuplicateLayer" AS ENUM ('sha256', 'phash', 'serial', 'db_constraint');

-- CreateEnum
CREATE TYPE "ReceiptQuality" AS ENUM ('valid', 'kurang_valid', 'tidak_valid');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ExportMode" AS ENUM ('draft', 'final');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('analyzing', 'preview', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "ExcelImportStatus" AS ENUM ('validating', 'invalid_file', 'preview', 'committed', 'rolled_back');

-- CreateEnum
CREATE TYPE "UnloadingSource" AS ENUM ('excel', 'scan');

-- CreateEnum
CREATE TYPE "WilayahLevel" AS ENUM ('prov', 'kab', 'kec', 'desa');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "google_sub" TEXT,
    "avatar_url" TEXT,
    "role" "Role" NOT NULL,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_whitelist" (
    "email" TEXT NOT NULL,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_whitelist_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "containers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq_no" INTEGER NOT NULL,
    "box_no" TEXT,
    "loading_date" DATE,
    "status" "ContainerStatus" NOT NULL DEFAULT 'draft',
    "template_id" UUID,
    "locked_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "purge_at" TIMESTAMPTZ,
    "purged_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "containers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_id" UUID NOT NULL,
    "serial_no" INTEGER,
    "released_serial_no" INTEGER,
    "sales_id" UUID NOT NULL,
    "source" "ReceiptSource" NOT NULL,
    "import_batch_id" UUID,
    "excel_import_id" UUID,
    "receipt_date" DATE,
    "sender_name" TEXT,
    "sender_phone" BYTEA,
    "passport_no" BYTEA,
    "passport_bidx" BYTEA,
    "recipient_name" TEXT,
    "address" TEXT,
    "recipient_phone" BYTEA,
    "recipient_phone_bidx" BYTEA,
    "dest_city" TEXT,
    "wilayah_code" TEXT,
    "koli_total" SMALLINT,
    "weight_kg" DECIMAL(7,2),
    "insurance" DECIMAL(12,2),
    "packing" DECIMAL(12,2),
    "vat" DECIMAL(12,2),
    "grand_total" DECIMAL(12,2),
    "cek_note" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'captured',
    "reject_reason" TEXT,
    "carried_from_container_id" UUID,
    "submitted_at" TIMESTAMPTZ,
    "audited_by" UUID,
    "audited_at" TIMESTAMPTZ,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "anonymized_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_packages" (
    "receipt_id" UUID NOT NULL,
    "package_type" "PackageType" NOT NULL,
    "qty" SMALLINT NOT NULL,

    CONSTRAINT "receipt_packages_pkey" PRIMARY KEY ("receipt_id","package_type")
);

-- CreateTable
CREATE TABLE "receipt_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "file_path" TEXT,
    "page_no" INTEGER,
    "sha256" TEXT NOT NULL,
    "phash" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "blur_score" DOUBLE PRECISION,
    "replaced_at" TIMESTAMPTZ,
    "retain_for_eval" BOOLEAN NOT NULL DEFAULT false,
    "purged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_reservations" (
    "serial_no" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "container_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "serial_reservations_pkey" PRIMARY KEY ("serial_no")
);

-- CreateTable
CREATE TABLE "scan_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "container_id" UUID NOT NULL,
    "source" "ReceiptSource" NOT NULL,
    "import_batch_id" UUID,
    "page_no" INTEGER,
    "serial_read" TEXT,
    "serial_typed" TEXT,
    "result" "ScanResult" NOT NULL,
    "duplicate_of_receipt_id" UUID,
    "duplicate_layer" "DuplicateLayer",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_id" UUID NOT NULL,
    "sales_id" UUID NOT NULL,
    "file_path" TEXT,
    "sha256" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'analyzing',
    "summary" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excel_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_id" UUID NOT NULL,
    "file_path" TEXT,
    "sha256" TEXT NOT NULL,
    "template_id" UUID,
    "template_version" INTEGER,
    "detected_by" TEXT,
    "status" "ExcelImportStatus" NOT NULL DEFAULT 'validating',
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_valid" INTEGER NOT NULL DEFAULT 0,
    "rows_kurang_valid" INTEGER NOT NULL DEFAULT 0,
    "rows_tidak_valid" INTEGER NOT NULL DEFAULT 0,
    "rows_duplicate" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ,
    "rolled_back_at" TIMESTAMPTZ,

    CONSTRAINT "excel_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_versions" (
    "id" TEXT NOT NULL,
    "hf_model_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "eval_accuracy" DOUBLE PRECISION,
    "eval_numeric_accuracy" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activated_by" UUID,
    "activated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "image_id" UUID NOT NULL,
    "model_version" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "quality" "ReceiptQuality",
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DECIMAL(10,6),
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_fields" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "raw_text" TEXT,
    "suggested_text" TEXT,
    "final_text" TEXT,
    "conf_vlm" DOUBLE PRECISION,
    "conf_nlp" DOUBLE PRECISION,
    "conf_final" DOUBLE PRECISION,
    "bbox" JSONB,
    "reason" TEXT,
    "corrected_by" UUID,
    "corrected_at" TIMESTAMPTZ,

    CONSTRAINT "extracted_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_thresholds" (
    "field_key" TEXT NOT NULL,
    "green_min" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "yellow_min" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_thresholds_pkey" PRIMARY KEY ("field_key")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_after" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wilayah" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "WilayahLevel" NOT NULL,
    "parent_code" TEXT,
    "short_name" TEXT,

    CONSTRAINT "wilayah_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "wilayah_aliases" (
    "alias" TEXT NOT NULL,
    "wilayah_code" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wilayah_aliases_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "sales_region" (
    "sales_id" UUID NOT NULL,
    "region" TEXT NOT NULL,
    "valid_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_region_pkey" PRIMARY KEY ("sales_id","valid_from")
);

-- CreateTable
CREATE TABLE "excel_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excel_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "mode" "ExportMode" NOT NULL,
    "file_path" TEXT,
    "row_count" INTEGER NOT NULL,
    "total_pcs" INTEGER NOT NULL,
    "total_kg" DECIMAL(10,2) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "row_locks" (
    "container_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "row_locks_pkey" PRIMARY KEY ("receipt_id")
);

-- CreateTable
CREATE TABLE "unloading_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_id" UUID NOT NULL,
    "serial_no" INTEGER NOT NULL,
    "pcs" INTEGER NOT NULL,
    "kg" DECIMAL(7,2),
    "source" "UnloadingSource" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unloading_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "containers_seq_no_key" ON "containers"("seq_no");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_serial_no_key" ON "receipts"("serial_no");

-- CreateIndex
CREATE INDEX "receipts_container_id_status_idx" ON "receipts"("container_id", "status");

-- CreateIndex
CREATE INDEX "receipts_container_id_passport_bidx_recipient_phone_bidx_idx" ON "receipts"("container_id", "passport_bidx", "recipient_phone_bidx");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_images_sha256_key" ON "receipt_images"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_images_receipt_id_version_key" ON "receipt_images"("receipt_id", "version");

-- CreateIndex
CREATE INDEX "scan_attempts_container_id_result_idx" ON "scan_attempts"("container_id", "result");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_sha256_key" ON "import_batches"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "excel_imports_sha256_key" ON "excel_imports"("sha256");

-- CreateIndex
CREATE INDEX "extraction_runs_receipt_id_idx" ON "extraction_runs"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_fields_run_id_field_key_key" ON "extracted_fields"("run_id", "field_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_after_priority_created_at_idx" ON "jobs"("status", "run_after", "priority", "created_at");

-- CreateIndex
CREATE INDEX "wilayah_parent_code_idx" ON "wilayah"("parent_code");

-- CreateIndex
CREATE UNIQUE INDEX "excel_templates_name_version_key" ON "excel_templates"("name", "version");

-- CreateIndex
CREATE INDEX "unloading_records_container_id_serial_no_idx" ON "unloading_records"("container_id", "serial_no");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "containers" ADD CONSTRAINT "containers_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "excel_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_carried_from_container_id_fkey" FOREIGN KEY ("carried_from_container_id") REFERENCES "containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_sales_id_fkey" FOREIGN KEY ("sales_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_audited_by_fkey" FOREIGN KEY ("audited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_excel_import_id_fkey" FOREIGN KEY ("excel_import_id") REFERENCES "excel_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_wilayah_code_fkey" FOREIGN KEY ("wilayah_code") REFERENCES "wilayah"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_packages" ADD CONSTRAINT "receipt_packages_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_images" ADD CONSTRAINT "receipt_images_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serial_reservations" ADD CONSTRAINT "serial_reservations_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_attempts" ADD CONSTRAINT "scan_attempts_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excel_imports" ADD CONSTRAINT "excel_imports_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "receipt_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_model_version_fkey" FOREIGN KEY ("model_version") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wilayah" ADD CONSTRAINT "wilayah_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "wilayah"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wilayah_aliases" ADD CONSTRAINT "wilayah_aliases_wilayah_code_fkey" FOREIGN KEY ("wilayah_code") REFERENCES "wilayah"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_region" ADD CONSTRAINT "sales_region_sales_id_fkey" FOREIGN KEY ("sales_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "excel_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "row_locks" ADD CONSTRAINT "row_locks_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "row_locks" ADD CONSTRAINT "row_locks_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unloading_records" ADD CONSTRAINT "unloading_records_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Aturan yang tidak bisa dinyatakan di schema.prisma ────────────────

-- Serial No hanya boleh NULL setelah "Bebaskan serial" pada resi yang di-soft-delete (PRD F7).
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_serial_release_check"
  CHECK ("serial_no" IS NOT NULL OR ("deleted_at" IS NOT NULL AND "released_serial_no" IS NOT NULL));

-- Serial No resi 4–5 digit (PRD §4).
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_serial_range_check"
  CHECK ("serial_no" IS NULL OR "serial_no" BETWEEN 1000 AND 99999);

-- Autocomplete & fuzzy match alamat (pg_trgm).
CREATE INDEX "receipts_address_trgm_idx" ON "receipts" USING gin ("address" gin_trgm_ops);
CREATE INDEX "wilayah_name_trgm_idx" ON "wilayah" USING gin ("name" gin_trgm_ops);

-- Hanya satu versi model yang aktif (PRD §6).
CREATE UNIQUE INDEX "model_versions_single_active_idx" ON "model_versions" ("is_active") WHERE "is_active";

-- audit_logs append-only (PRD §12). Satu-satunya pengecualian: job retensi mengganti
-- nilai pribadi dengan "[dianonimkan]" setelah `SET LOCAL csm.retention = 'on'`.
CREATE FUNCTION "audit_logs_block_mutation"() RETURNS trigger AS $$
BEGIN
  IF current_setting('csm.retention', true) = 'on' AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs bersifat append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();
