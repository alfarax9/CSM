import express, { Router } from 'express';
import { z } from 'zod';
import {
  PACKAGE_EXCEL_COLUMN,
  PACKAGE_TYPES,
  type PackageType,
  type ReceiptStatus,
  canTransitionReceipt,
  containerAcceptsReceipts,
  isValidPassport,
  isValidPhones,
  normalizeNumeric,
  normalizePassport,
  normalizePhones,
} from '@csm/shared';
import { audit } from '../audit.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../http/errors.js';
import { requireRole } from '../http/rbac.js';
import { type Pii, maskValue } from '../pii.js';
import { type Extraction, type Extractor, ExtractorError } from '../ml.js';
import { type ImageStore, MAX_IMAGE_BYTES, jpegSize, sha256Hex } from '../storage/images.js';

const ANY = requireRole('super_admin', 'admin', 'sales');
const STAFF = requireRole('super_admin', 'admin');

/** Container yang masih boleh diedit resinya (tambah resi hanya Draft/Loading). */
const EDITABLE_CONTAINER = new Set(['draft', 'loading', 'locked']);

const optText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => v || null)
  .nullable()
  .optional();
const optMoney = z.coerce.number().min(0).max(999_999_999).nullable().optional();

const passport = z
  .string()
  .transform(normalizePassport)
  .refine((v) => v === '' || isValidPassport(v), 'No paspor harus 1–2 huruf + 6–7 angka, mis. C8060823.')
  .transform((v) => v || null)
  .nullable()
  .optional();

const phones = z
  .string()
  .transform(normalizePhones)
  .refine((v) => v === '' || isValidPhones(v), 'No HP harus diawali 08 dan 10–13 digit; beberapa nomor dipisah spasi.')
  .transform((v) => v || null)
  .nullable()
  .optional();

/** HP pengirim: nomor negara asal (mis. Arab Saudi 0560356139), 9–15 digit; bukan pola 08 Indonesia. */
const senderPhone = z
  .string()
  .transform((v) => normalizeNumeric(v))
  .refine((v) => v === '' || (v.length >= 9 && v.length <= 15), 'No HP pengirim harus 9–15 digit.')
  .transform((v) => v || null)
  .nullable()
  .optional();

const FieldsSchema = z.object({
  serialNo: z.coerce.number().int().min(1000, 'Serial No 4–5 digit.').max(99999, 'Serial No 4–5 digit.'),
  receiptDate: z.iso.date().nullable().optional(),
  senderName: optText,
  senderPhone,
  passportNo: passport,
  recipientName: optText,
  recipientPhone: phones,
  address: optText,
  wilayahCode: z.string().trim().nullable().optional(),
  packages: z
    .object(Object.fromEntries(PACKAGE_TYPES.map((p) => [p, z.coerce.number().int().min(0).max(999).default(0)])))
    .partial()
    .optional(),
  koliTotal: z.coerce.number().int().min(0).max(9999).nullable().optional(),
  weightKg: z.coerce.number().min(0).max(99999.99).nullable().optional(),
  insurance: optMoney,
  packing: optMoney,
  vat: optMoney,
  grandTotal: optMoney,
  cekNote: optText,
});

const CreateSchema = FieldsSchema.extend({ salesId: z.uuid().optional(), imageToken: z.uuid().optional() });
const UpdateSchema = FieldsSchema.partial().extend({ salesId: z.uuid().optional() });

type Packages = Partial<Record<PackageType, number>>;

/** Kolom Laporan Loading: Tas / Krt / Krg / Lain2 dan PCS = jumlahnya (PRD §4). */
function excelColumns(packages: { packageType: PackageType; qty: number }[]) {
  const cols = { tas: 0, krt: 0, krg: 0, lain2: 0 };
  for (const p of packages) cols[PACKAGE_EXCEL_COLUMN[p.packageType]] += p.qty;
  return { ...cols, pcs: cols.tas + cols.krt + cols.krg + cols.lain2 };
}

function warningsFor(koliTotal: number | null | undefined, pcs: number): string[] {
  return koliTotal != null && koliTotal !== pcs
    ? [`Koli di kertas (${koliTotal}) tidak sama dengan jumlah paket (${pcs}). Cek ulang kertasnya.`]
    : [];
}

/** Resi input manual + deteksi Serial No ganda (PRD F7) + alur submit/approve/reject. */
export function createReceiptsRouter(prisma: PrismaClient, pii: Pii, images: ImageStore, extractor: Extractor): Router {
  const router = Router();

  /** Lokasi resi yang sudah memakai Serial No (termasuk yang di-soft-delete, PRD F7). */
  async function findDuplicate(serialNo: number, exceptId?: string) {
    const r = await prisma.receipt.findFirst({
      where: { serialNo, ...(exceptId ? { id: { not: exceptId } } : {}) },
      include: { container: true, sales: true, creator: true },
    });
    if (!r) return null;
    return {
      receiptId: r.id,
      serialNo,
      containerSeqNo: r.container.seqNo,
      sales: r.sales.displayName ?? r.sales.name,
      createdBy: r.creator?.displayName ?? r.creator?.name ?? null,
      createdAt: r.createdAt,
      deleted: r.deletedAt !== null,
    };
  }

  function duplicateError(d: NonNullable<Awaited<ReturnType<typeof findDuplicate>>>) {
    return new AppError(
      'SERIAL_DUPLICATE',
      `Serial No ${d.serialNo} sudah ada di Container ${d.containerSeqNo} (${d.sales}).`,
      d,
    );
  }

  async function assertSerialFree(serialNo: number, userId: string, containerId: string, exceptId?: string) {
    const dup = await findDuplicate(serialNo, exceptId);
    if (dup) {
      await prisma.scanAttempt.create({
        data: {
          userId,
          containerId,
          source: 'manual',
          serialTyped: String(serialNo),
          result: 'duplicate',
          duplicateOfReceiptId: dup.receiptId,
          duplicateLayer: 'serial',
        },
      });
      throw duplicateError(dup);
    }
    const reserved = await prisma.serialReservation.findUnique({ where: { serialNo } });
    if (reserved && reserved.expiresAt > new Date() && reserved.userId !== userId) {
      throw new AppError('SERIAL_RESERVED', `Serial No ${serialNo} sedang diproses user lain. Coba lagi beberapa menit lagi.`);
    }
  }

  /** Tujuan = nama pendek kab/kota dari gazetteer (PRD §4 kolom C Tujuan). */
  async function resolveDestination(code: string | null | undefined) {
    if (code === undefined) return {};
    if (code === null || code === '') return { wilayahCode: null, destCity: null };
    const w = await prisma.wilayah.findUnique({ where: { code } });
    if (!w || w.level !== 'kab') throw new AppError('VALIDATION_FAILED', 'Tujuan harus kabupaten/kota dari daftar wilayah.');
    return { wilayahCode: w.code, destCity: w.shortName ?? w.name };
  }

  async function resolveSales(actor: Express.Request['user'] & object, salesId: string | undefined) {
    if (actor.role === 'sales') return actor.id; // Sales selalu tercatat sebagai pemilik resinya
    if (!salesId) throw new AppError('VALIDATION_FAILED', 'Pilih sales pemilik resi.');
    const s = await prisma.user.findUnique({ where: { id: salesId } });
    if (!s || s.role !== 'sales' || !s.isActive) throw new AppError('VALIDATION_FAILED', 'Sales tidak ditemukan atau nonaktif.');
    return s.id;
  }

  async function loadReceipt(id: string, actor: NonNullable<Express.Request['user']>) {
    const r = await prisma.receipt.findFirst({
      where: { id, deletedAt: null, ...(actor.role === 'sales' ? { salesId: actor.id } : {}) },
      include: {
        container: true,
        sales: true,
        creator: true,
        packages: true,
        images: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
    if (!r) throw new AppError('NOT_FOUND', 'Resi tidak ditemukan.');
    return r;
  }

  /** Detail lengkap; hanya untuk yang berhak (SA/A semua resi, Sales resi miliknya — dicek di loadReceipt). */
  function toDetail(r: Awaited<ReturnType<typeof loadReceipt>>) {
    const show = (v: Uint8Array | null) => pii.decrypt(v);
    const packages = Object.fromEntries(PACKAGE_TYPES.map((t) => [t, r.packages.find((p) => p.packageType === t)?.qty ?? 0]));
    const cols = excelColumns(r.packages);
    return {
      id: r.id,
      serialNo: r.serialNo,
      status: r.status,
      source: r.source,
      container: { id: r.container.id, seqNo: r.container.seqNo, status: r.container.status },
      carriedFromContainerId: r.carriedFromContainerId,
      sales: { id: r.sales.id, name: r.sales.displayName ?? r.sales.name },
      createdBy: r.creator?.displayName ?? r.creator?.name ?? null,
      createdAt: r.createdAt,
      receiptDate: r.receiptDate?.toISOString().slice(0, 10) ?? null,
      senderName: r.senderName,
      senderPhone: show(r.senderPhone),
      passportNo: show(r.passportNo),
      recipientName: r.recipientName,
      recipientPhone: show(r.recipientPhone),
      address: r.address,
      wilayahCode: r.wilayahCode,
      destCity: r.destCity,
      packages,
      ...cols,
      koliTotal: r.koliTotal,
      weightKg: r.weightKg === null ? null : Number(r.weightKg),
      insurance: r.insurance === null ? null : Number(r.insurance),
      packing: r.packing === null ? null : Number(r.packing),
      vat: r.vat === null ? null : Number(r.vat),
      grandTotal: r.grandTotal === null ? null : Number(r.grandTotal),
      cekNote: r.cekNote,
      rejectReason: r.rejectReason,
      approvedAt: r.approvedAt,
      warnings: warningsFor(r.koliTotal, cols.pcs),
      image: (() => {
        const img = r.images[0];
        if (!img) return null;
        return {
          id: img.id,
          version: img.version,
          width: img.width,
          height: img.height,
          blurScore: img.blurScore,
          // NULL setelah dihapus job retensi (PRD §12): foto tidak tersedia lagi.
          url: img.filePath ? images.signedUrl(img.id) : null,
        };
      })(),
    };
  }

  /** Kolom yang ditulis ke DB dari input form (paspor & HP dienkripsi + blind index). */
  function toData(input: z.infer<typeof UpdateSchema>) {
    const data: Prisma.ReceiptUncheckedUpdateInput = {};
    if (input.serialNo !== undefined) data.serialNo = input.serialNo;
    if (input.receiptDate !== undefined) data.receiptDate = input.receiptDate ? new Date(input.receiptDate) : null;
    for (const k of ['senderName', 'recipientName', 'address', 'cekNote'] as const) if (input[k] !== undefined) data[k] = input[k];
    for (const k of ['koliTotal', 'weightKg', 'insurance', 'packing', 'vat', 'grandTotal'] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    if (input.passportNo !== undefined) {
      data.passportNo = pii.encrypt(input.passportNo);
      data.passportBidx = pii.blindIndex(input.passportNo);
    }
    if (input.senderPhone !== undefined) data.senderPhone = pii.encrypt(input.senderPhone);
    if (input.recipientPhone !== undefined) {
      data.recipientPhone = pii.encrypt(input.recipientPhone);
      data.recipientPhoneBidx = pii.blindIndex(input.recipientPhone?.split(' ')[0]);
    }
    return data;
  }

  /** Audit tanpa membocorkan data pribadi: paspor/HP dicatat tersamar. */
  function auditFields(input: z.infer<typeof UpdateSchema>) {
    const out: Record<string, unknown> = { ...input };
    for (const k of ['passportNo', 'senderPhone', 'recipientPhone'] as const) if (k in out) out[k] = maskValue(input[k] ?? null);
    return out;
  }

  async function writePackages(tx: Prisma.TransactionClient, receiptId: string, packages: Packages | undefined) {
    if (!packages) return;
    await tx.receiptPackage.deleteMany({ where: { receiptId } });
    const rows = Object.entries(packages)
      .filter(([, qty]) => (qty ?? 0) > 0)
      .map(([packageType, qty]) => ({ receiptId, packageType: packageType as PackageType, qty: qty! }));
    if (rows.length) await tx.receiptPackage.createMany({ data: rows });
  }

  function isUniqueViolation(err: unknown) {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
  }

  /**
   * Simpan hasil baca model + nilai final dari manusia (PRD §10 extraction_runs / extracted_fields).
   * `final_text ≠ raw_text` = label koreksi untuk evaluasi & perbaikan model. Nilai pribadi ikut dianonimkan
   * oleh job retensi 30 hari setelah container Closed (PRD §12).
   */
  async function recordExtraction(
    tx: Prisma.TransactionClient,
    receiptId: string,
    imageId: string,
    extraction: Extraction,
    input: z.infer<typeof CreateSchema>,
  ) {
    await tx.modelVersion.upsert({
      where: { id: extraction.model },
      update: {},
      create: {
        id: extraction.model,
        hfModelId: extraction.model.split(':')[0]!,
        provider: extraction.model.split(':')[1] ?? 'auto',
        promptVersion: 'v1',
      },
    });
    const levels = Object.values(extraction.fields).map((f) => f.level);
    const run = await tx.extractionRun.create({
      data: {
        receiptId,
        imageId,
        modelVersion: extraction.model,
        status: 'done',
        // Kategori dari hasil model SEBELUM dikoreksi manusia (PRD F9a). Tanpa skor confidence per field,
        // field terbaca dianggap "perlu dicek" → kurang valid; gagal validasi → tidak valid.
        quality: levels.includes('bad') ? 'tidak_valid' : 'kurang_valid',
        inputTokens: extraction.inputTokens,
        outputTokens: extraction.outputTokens,
        startedAt: new Date(Date.now() - extraction.seconds * 1000),
        finishedAt: new Date(),
      },
    });
    const text = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const finalOf = (key: string) => text((input as Record<string, unknown>)[key]);
    await tx.extractedField.createMany({
      data: Object.entries(extraction.fields).map(([key, f]) => ({
        runId: run.id,
        fieldKey: key,
        rawText: text(f.raw),
        suggestedText: text(f.value),
        finalText: finalOf(key),
        reason: f.reason,
      })),
    });
  }

  /** PRD F7 lapis 1: foto identik (sha256 sama) ditolak dan dicatat sebagai percobaan duplikat. */
  async function assertPhotoFree(sha256: string, userId: string, containerId: string) {
    const existing = await prisma.receiptImage.findUnique({ where: { sha256 }, include: { receipt: { include: { container: true } } } });
    if (!existing) return;
    await prisma.scanAttempt.create({
      data: {
        userId,
        containerId,
        source: 'camera',
        serialRead: existing.receipt.serialNo === null ? null : String(existing.receipt.serialNo),
        result: 'duplicate',
        duplicateOfReceiptId: existing.receiptId,
        duplicateLayer: 'sha256',
      },
    });
    throw new AppError(
      'PHOTO_DUPLICATE',
      `Foto ini sudah dipakai resi ${existing.receipt.serialNo ?? '(serial dibebaskan)'} di Container ${existing.receipt.container.seqNo}.`,
      { receiptId: existing.receiptId, serialNo: existing.receipt.serialNo, containerSeqNo: existing.receipt.container.seqNo },
    );
  }

  /** Foto dikirim sebagai JPEG mentah (browser sudah mengonversi & memperkecil). */
  const rawJpeg = express.raw({ type: 'image/jpeg', limit: MAX_IMAGE_BYTES });

  function readJpeg(body: unknown) {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('VALIDATION_FAILED', 'Foto kosong. Kirim sebagai image/jpeg.');
    const size = jpegSize(body);
    if (!size) throw new AppError('VALIDATION_FAILED', 'File bukan foto JPEG yang valid.');
    if (Math.min(size.width, size.height) < 600) {
      throw new AppError('VALIDATION_FAILED', 'Resolusi foto terlalu kecil (minimal 600 px). Foto ulang lebih dekat.');
    }
    return size;
  }

  function blurHeader(v: string | undefined) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // ─── Scan foto (PRD F1) ─────────────────────────────────────────────

  /** Simpan foto sementara; resi dibuat saat form disimpan dengan `imageToken`. */
  router.post('/containers/:id/scans', ANY, rawJpeg, async (req, res) => {
    const actor = req.user!;
    const container = await prisma.container.findUnique({ where: { id: String(req.params.id) } });
    if (!container) throw new AppError('NOT_FOUND', 'Container tidak ditemukan.');
    if (!containerAcceptsReceipts(container.status)) {
      throw new AppError('CONTAINER_CLOSED', `Container ${container.seqNo} berstatus ${container.status}; scan hanya saat Draft atau Loading.`);
    }
    const size = readJpeg(req.body);
    const sha256 = sha256Hex(req.body as Buffer);
    await assertPhotoFree(sha256, actor.id, container.id);
    // Foto yang sama persis masih menunggu di antrean (belum disimpan jadi resi). Milik user yang sama = sedang
    // mengulang (mis. halaman sempat ditutup) → antrean lama dibuang; milik user lain → ditolak.
    const pending = await images.findTempBySha(sha256);
    if (pending && pending.userId === actor.id) await images.discardTemp(pending.token);
    else if (pending) {
      await prisma.scanAttempt.create({
        data: { userId: actor.id, containerId: container.id, source: 'camera', result: 'duplicate', duplicateLayer: 'sha256' },
      });
      throw new AppError('PHOTO_DUPLICATE', 'Foto yang sama persis sudah ada di antrean scan dan sedang menunggu dicek.', {
        receiptId: null,
        serialNo: null,
        containerSeqNo: container.seqNo,
        pending: true,
      });
    }
    const temp = await images.saveTemp(req.body as Buffer, {
      sha256,
      ...size,
      blurScore: blurHeader(req.get('x-blur-score')),
      userId: actor.id,
      containerId: container.id,
    });
    res.status(201).json({ token: temp.token, width: temp.width, height: temp.height });
  });

  /**
   * Baca otomatis foto hasil scan dengan VLM (PRD §6). Hasilnya hanya SARAN untuk mengisi form;
   * tetap dicek manusia. Disimpan sementara agar saat resi disimpan menjadi data latih (extracted_fields).
   */
  router.post('/containers/:id/scans/:token/extract', ANY, async (req, res) => {
    const actor = req.user!;
    const token = String(req.params.token);
    const temp = await images.loadTemp(token);
    if (!temp || temp.userId !== actor.id || temp.containerId !== String(req.params.id)) {
      throw new AppError('NOT_FOUND', 'Foto scan tidak ditemukan atau kedaluwarsa. Scan ulang resinya.');
    }
    const jpeg = await images.readTemp(token);
    if (!jpeg) throw new AppError('NOT_FOUND', 'File foto scan tidak ditemukan. Scan ulang resinya.');
    let extraction: Extraction;
    try {
      extraction = await extractor(jpeg);
    } catch (err) {
      if (err instanceof ExtractorError) {
        throw new AppError(err.unavailable ? 'EXTRACTION_UNAVAILABLE' : 'EXTRACTION_FAILED', `${err.message} Isi form secara manual.`);
      }
      throw err;
    }
    await images.saveExtraction(token, extraction);

    // PRD F7 lapis 3: Serial No hasil baca sudah ada → blokir di kamera, catat sebagai percobaan duplikat.
    const serialRead = String(extraction.fields.serialNo?.value ?? '');
    const duplicate = /^\d{4,5}$/.test(serialRead) ? await findDuplicate(Number(serialRead)) : null;
    if (duplicate) {
      await prisma.scanAttempt.create({
        data: {
          userId: actor.id,
          containerId: temp.containerId,
          source: 'camera',
          serialRead,
          result: 'duplicate',
          duplicateOfReceiptId: duplicate.receiptId,
          duplicateLayer: 'serial',
        },
      });
    }
    res.json({ model: extraction.model, seconds: extraction.seconds, fields: extraction.fields, duplicate });
  });

  /** "Lewati" (PRD F7): buang foto sementara tanpa membuat resi. */
  router.delete('/containers/:id/scans/:token', ANY, async (req, res) => {
    const temp = await images.loadTemp(String(req.params.token));
    if (!temp || temp.userId !== req.user!.id || temp.containerId !== String(req.params.id)) {
      throw new AppError('NOT_FOUND', 'Foto scan tidak ditemukan.');
    }
    await images.discardTemp(temp.token);
    res.json({ ok: true });
  });

  /** Resi yang fotonya boleh diganti oleh user ini (container belum berangkat; Sales hanya sebelum approve). */
  async function loadReplaceable(id: string, actor: NonNullable<Express.Request['user']>) {
    const r = await loadReceipt(id, actor);
    if (!EDITABLE_CONTAINER.has(r.container.status)) {
      throw new AppError('CONTAINER_CLOSED', `Container ${r.container.seqNo} sudah ${r.container.status}; foto tidak bisa diganti.`);
    }
    if (actor.role === 'sales' && (r.status === 'approved' || r.status === 'exported')) {
      throw new AppError('FORBIDDEN', 'Foto resi yang sudah di-approve hanya bisa diganti Admin.');
    }
    return r;
  }

  /** Simpan foto sebagai versi baru; versi lama ditandai diganti tapi tetap disimpan sampai retensi (PRD F7). */
  async function addImageVersion(
    r: Awaited<ReturnType<typeof loadReceipt>>,
    rel: string,
    meta: { sha256: string; width: number; height: number; blurScore: number | null },
    actorId: string,
    ip: string | undefined,
  ) {
    const version = (r.images[0]?.version ?? 0) + 1;
    try {
      await prisma.$transaction(async (tx) => {
        if (r.images[0]) await tx.receiptImage.update({ where: { id: r.images[0].id }, data: { replacedAt: new Date() } });
        await tx.receiptImage.create({ data: { receiptId: r.id, version, filePath: rel, ...meta } });
      });
    } catch (err) {
      await images.remove(rel);
      throw err;
    }
    await audit(prisma, { actorId, action: 'receipt.image', entity: 'receipt', entityId: r.id, after: { version }, ip: ip ?? null });
  }

  /** Ganti foto resi dari file/kamera di halaman detail resi. */
  router.post('/receipts/:id/image', ANY, rawJpeg, async (req, res) => {
    const actor = req.user!;
    const r = await loadReplaceable(String(req.params.id), actor);
    const size = readJpeg(req.body);
    const sha256 = sha256Hex(req.body as Buffer);
    await assertPhotoFree(sha256, actor.id, r.containerId);
    const rel = await images.saveReceiptImage(req.body as Buffer);
    await addImageVersion(r, rel, { sha256, ...size, blurScore: blurHeader(req.get('x-blur-score')) }, actor.id, req.ip);
    res.status(201).json(toDetail(await loadReceipt(r.id, actor)));
  });

  /** "Ganti foto resi lama" dari panel duplikat di kamera (PRD F7): foto scan baru menjadi foto resi lama. */
  const FromScanSchema = z.object({ token: z.uuid() });
  router.post('/receipts/:id/image-from-scan', ANY, async (req, res) => {
    const actor = req.user!;
    const { token } = FromScanSchema.parse(req.body);
    const r = await loadReplaceable(String(req.params.id), actor);
    const temp = await images.loadTemp(token);
    if (!temp || temp.userId !== actor.id) throw new AppError('NOT_FOUND', 'Foto scan tidak ditemukan atau kedaluwarsa.');
    await assertPhotoFree(temp.sha256, actor.id, r.containerId);
    const rel = await images.commitTemp(token);
    await addImageVersion(r, rel, { sha256: temp.sha256, width: temp.width, height: temp.height, blurScore: temp.blurScore }, actor.id, req.ip);
    res.status(201).json(toDetail(await loadReceipt(r.id, actor)));
  });

  /** Foto hanya lewat URL bertanda tangan berumur 5 menit (PRD §12), bukan file statis publik. */
  router.get('/receipt-images/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!images.verifySignature(id, String(req.query.exp ?? ''), String(req.query.sig ?? ''))) {
      throw new AppError('FORBIDDEN', 'Tautan foto tidak valid atau sudah kedaluwarsa. Muat ulang halaman.');
    }
    const img = await prisma.receiptImage.findUnique({ where: { id } });
    if (!img?.filePath) throw new AppError('NOT_FOUND', 'Foto sudah dihapus sesuai kebijakan retensi.');
    res.set('Cache-Control', 'private, max-age=300');
    res.type('image/jpeg').sendFile(images.absolute(img.filePath));
  });

  // ─── Pencarian pendukung form ───────────────────────────────────────

  router.get('/receipts/check-serial', ANY, async (req, res) => {
    const no = Number(req.query.no);
    if (!Number.isInteger(no) || no < 1000 || no > 99999) throw new AppError('VALIDATION_FAILED', 'Serial No 4–5 digit.');
    const duplicate = await findDuplicate(no, typeof req.query.except === 'string' ? req.query.except : undefined);
    res.json({ serialNo: no, available: !duplicate, duplicate });
  });

  /** Autocomplete kab/kota untuk kolom Tujuan (PRD §11 /wilayah/search, pg_trgm). */
  router.get('/wilayah/search', ANY, async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const rows = await prisma.$queryRaw<{ code: string; name: string; short_name: string | null; province: string | null }[]>`
      SELECT k.code, k.name, k.short_name, p.short_name AS province
      FROM wilayah k LEFT JOIN wilayah p ON p.code = k.parent_code
      WHERE k.level = 'kab' AND (k.short_name ILIKE ${`%${q}%`} OR similarity(k.short_name, ${q}) > 0.2)
      ORDER BY (k.short_name ILIKE ${`${q}%`}) DESC, similarity(k.short_name, ${q}) DESC, k.short_name
      LIMIT 8`;
    res.json(rows.map((r) => ({ code: r.code, name: r.name, shortName: r.short_name ?? r.name, province: r.province })));
  });

  router.get('/sales', STAFF, async (_req, res) => {
    const sales = await prisma.user.findMany({ where: { role: 'sales', isActive: true }, orderBy: { name: 'asc' } });
    res.json(sales.map((s) => ({ id: s.id, name: s.displayName ?? s.name })));
  });

  // ─── Container & daftar resi ────────────────────────────────────────

  router.get('/containers/:id', ANY, async (req, res) => {
    const c = await prisma.container.findUnique({ where: { id: String(req.params.id) } });
    if (!c) throw new AppError('NOT_FOUND', 'Container tidak ditemukan.');
    res.json({
      id: c.id,
      seqNo: c.seqNo,
      boxNo: c.boxNo,
      loadingDate: c.loadingDate?.toISOString().slice(0, 10) ?? null,
      status: c.status,
      acceptsReceipts: containerAcceptsReceipts(c.status),
      purgeAt: c.purgeAt,
    });
  });

  router.get('/containers/:id/receipts', ANY, async (req, res) => {
    const actor = req.user!;
    const receipts = await prisma.receipt.findMany({
      where: {
        containerId: String(req.params.id),
        deletedAt: null,
        ...(actor.role === 'sales' ? { salesId: actor.id } : {}),
      },
      include: { packages: true, sales: true },
      orderBy: { serialNo: 'asc' },
    });
    res.json(
      receipts.map((r) => {
        const cols = excelColumns(r.packages);
        return {
          id: r.id,
          serialNo: r.serialNo,
          destCity: r.destCity,
          ...cols,
          koliTotal: r.koliTotal,
          koliMismatch: r.koliTotal !== null && r.koliTotal !== cols.pcs,
          weightKg: r.weightKg === null ? null : Number(r.weightKg),
          sales: r.sales.displayName ?? r.sales.name,
          senderName: r.senderName,
          recipientName: r.recipientName,
          cekNote: r.cekNote,
          status: r.status,
        };
      }),
    );
  });

  // ─── Buat & ubah resi ───────────────────────────────────────────────

  router.post('/containers/:id/receipts', ANY, async (req, res) => {
    const actor = req.user!;
    const input = CreateSchema.parse(req.body);
    const container = await prisma.container.findUnique({ where: { id: String(req.params.id) } });
    if (!container) throw new AppError('NOT_FOUND', 'Container tidak ditemukan.');
    if (!containerAcceptsReceipts(container.status)) {
      throw new AppError('CONTAINER_CLOSED', `Container ${container.seqNo} berstatus ${container.status}; resi hanya bisa ditambah saat Draft atau Loading.`);
    }
    const salesId = await resolveSales(actor, input.salesId);
    await assertSerialFree(input.serialNo, actor.id, container.id);
    const dest = await resolveDestination(input.wilayahCode);
    // Sales mengisi sendiri → langsung "Dikirim ke Admin"; staf → "Siap approve".
    const status: ReceiptStatus = actor.role === 'sales' ? 'submitted' : 'ready';

    // Foto hasil scan (opsional): harus milik user ini, untuk container ini, dan belum dipakai resi lain.
    const temp = input.imageToken ? await images.loadTemp(input.imageToken) : null;
    if (input.imageToken && (!temp || temp.userId !== actor.id || temp.containerId !== container.id)) {
      throw new AppError('VALIDATION_FAILED', 'Foto scan tidak ditemukan atau kedaluwarsa. Scan ulang resinya.');
    }
    if (temp) await assertPhotoFree(temp.sha256, actor.id, container.id);
    const extraction = temp ? await images.loadExtraction<Extraction>(temp.token) : null;
    const imagePath = temp ? await images.commitTemp(temp.token) : null;
    const source = temp ? 'camera' : 'manual';

    let id: string;
    try {
      id = await prisma.$transaction(async (tx) => {
        const r = await tx.receipt.create({
          data: {
            ...(toData(input) as Prisma.ReceiptUncheckedCreateInput),
            ...dest,
            serialNo: input.serialNo,
            containerId: container.id,
            salesId,
            source,
            status,
            submittedAt: status === 'submitted' ? new Date() : null,
            createdBy: actor.id,
          },
        });
        await writePackages(tx, r.id, input.packages as Packages | undefined);
        if (temp && imagePath) {
          const image = await tx.receiptImage.create({
            data: {
              receiptId: r.id,
              version: 1,
              filePath: imagePath,
              sha256: temp.sha256,
              width: temp.width,
              height: temp.height,
              blurScore: temp.blurScore,
            },
          });
          await tx.scanAttempt.create({
            data: {
              userId: actor.id,
              containerId: container.id,
              source: 'camera',
              serialRead: extraction?.fields.serialNo ? String(extraction.fields.serialNo.value) : null,
              serialTyped: String(input.serialNo),
              result: 'accepted',
            },
          });
          if (extraction) await recordExtraction(tx, r.id, image.id, extraction, input);
        }
        return r.id;
      });
    } catch (err) {
      if (imagePath) await images.remove(imagePath);
      // Dua user menyimpan serial yang sama bersamaan: yang kedua ditolak (PRD F7 lapis 4).
      if (isUniqueViolation(err)) {
        const dup = await findDuplicate(input.serialNo);
        if (dup) throw duplicateError(dup);
      }
      throw err;
    }
    await audit(prisma, { actorId: actor.id, action: 'receipt.create', entity: 'receipt', entityId: id, after: auditFields(input), ip: req.ip });
    const created = await loadReceipt(id, actor);
    res.status(201).json(toDetail(created));
  });

  router.get('/receipts/:id', ANY, async (req, res) => {
    res.json(toDetail(await loadReceipt(String(req.params.id), req.user!)));
  });

  router.patch('/receipts/:id', ANY, async (req, res) => {
    const actor = req.user!;
    const input = UpdateSchema.parse(req.body);
    const r = await loadReceipt(String(req.params.id), actor);
    if (!EDITABLE_CONTAINER.has(r.container.status)) {
      throw new AppError('CONTAINER_CLOSED', `Container ${r.container.seqNo} sudah ${r.container.status}; resi tidak bisa diubah.`);
    }
    if (actor.role === 'sales' && (r.status === 'approved' || r.status === 'exported')) {
      throw new AppError('FORBIDDEN', 'Resi yang sudah di-approve hanya bisa diubah Admin.');
    }
    if (input.serialNo !== undefined && input.serialNo !== r.serialNo) {
      await assertSerialFree(input.serialNo, actor.id, r.containerId, r.id);
    }
    const salesId = input.salesId !== undefined ? await resolveSales(actor, input.salesId) : undefined;
    const dest = await resolveDestination(input.wilayahCode);

    // Resi ditolak yang diperbaiki kembali ke antrean; resi diekspor yang diubah kembali ke approved (PRD §7).
    let status: ReceiptStatus | undefined;
    if (r.status === 'rejected') status = actor.role === 'sales' ? 'submitted' : 'ready';
    if (r.status === 'exported') status = 'approved';

    try {
      await prisma.$transaction(async (tx) => {
        await tx.receipt.update({
          where: { id: r.id },
          data: {
            ...toData(input),
            ...dest,
            ...(salesId ? { salesId } : {}),
            ...(status ? { status, rejectReason: status === 'approved' ? r.rejectReason : null } : {}),
          },
        });
        await writePackages(tx, r.id, input.packages as Packages | undefined);
      });
    } catch (err) {
      if (isUniqueViolation(err) && input.serialNo !== undefined) {
        const dup = await findDuplicate(input.serialNo, r.id);
        if (dup) throw duplicateError(dup);
      }
      throw err;
    }
    await audit(prisma, {
      actorId: actor.id,
      action: 'receipt.update',
      entity: 'receipt',
      entityId: r.id,
      before: { status: r.status, serialNo: r.serialNo },
      after: { ...auditFields(input), ...(status ? { status } : {}) },
      ip: req.ip,
    });
    res.json(toDetail(await loadReceipt(r.id, actor)));
  });

  // ─── Alur status ────────────────────────────────────────────────────

  async function move(
    req: Express.Request,
    to: ReceiptStatus,
    extra: Prisma.ReceiptUncheckedUpdateInput = {},
    reason?: string,
  ) {
    const actor = req.user!;
    const r = await loadReceipt(String((req as { params?: { id?: string } }).params?.id), actor);
    if (!canTransitionReceipt(r.status, to)) {
      throw new AppError('VALIDATION_FAILED', `Resi berstatus ${r.status} tidak bisa diubah ke ${to}.`);
    }
    await prisma.receipt.update({ where: { id: r.id }, data: { status: to, ...extra } });
    await audit(prisma, {
      actorId: actor.id,
      action: `receipt.${to}`,
      entity: 'receipt',
      entityId: r.id,
      before: { status: r.status },
      after: { status: to },
      reason: reason ?? null,
      ip: (req as { ip?: string }).ip ?? null,
    });
    return loadReceipt(r.id, actor);
  }

  router.post('/receipts/:id/submit', requireRole('sales'), async (req, res) => {
    res.json(toDetail(await move(req, 'submitted', { submittedAt: new Date() })));
  });

  router.post('/receipts/:id/approve', STAFF, async (req, res) => {
    // Kolom K "Cek" berisi "C" saat approve (PRD §4), kecuali sudah ada catatan (mis. "Plus 1").
    const current = await loadReceipt(String(req.params.id), req.user!);
    const r = await move(req, 'approved', {
      approvedBy: req.user!.id,
      approvedAt: new Date(),
      cekNote: current.cekNote || 'C',
    });
    res.json(toDetail(r));
  });

  const RejectSchema = z.object({ reason: z.string().trim().min(3, 'Tulis alasan penolakan.').max(500) });
  router.post('/receipts/:id/reject', STAFF, async (req, res) => {
    const { reason } = RejectSchema.parse(req.body);
    res.json(toDetail(await move(req, 'rejected', { rejectReason: reason }, reason)));
  });

  // ─── Pindah resi antar container (PRD F4: "Plus 1" / muatan tertinggal) ──

  /** Container asal yang resinya masih boleh dipindah: belum berangkat. */
  const MOVABLE_FROM = new Set(['draft', 'loading', 'locked']);
  const MoveSchema = z.object({
    containerId: z.uuid(),
    note: z.string().trim().max(200).optional(),
  });

  router.post('/receipts/:id/move', STAFF, async (req, res) => {
    const actor = req.user!;
    const input = MoveSchema.parse(req.body);
    const r = await loadReceipt(String(req.params.id), actor);
    if (input.containerId === r.containerId) throw new AppError('VALIDATION_FAILED', 'Resi sudah ada di container ini.');
    if (!MOVABLE_FROM.has(r.container.status)) {
      throw new AppError('CONTAINER_CLOSED', `Container ${r.container.seqNo} sudah ${r.container.status}; resinya tidak bisa dipindah.`);
    }
    const target = await prisma.container.findUnique({ where: { id: input.containerId } });
    if (!target) throw new AppError('NOT_FOUND', 'Container tujuan tidak ditemukan.');
    if (!containerAcceptsReceipts(target.status)) {
      throw new AppError('CONTAINER_CLOSED', `Container ${target.seqNo} berstatus ${target.status}; resi hanya bisa masuk saat Draft atau Loading.`);
    }

    // Kolom Ket./Cek: catatan pindah menggantikan "C" kosong, catatan lain dipertahankan (PRD §4 "Plus 1 (64627)").
    const moveNote = input.note || `Plus 1 (dari ${r.container.seqNo})`;
    const cekNote = !r.cekNote || r.cekNote === 'C' ? moveNote : `${r.cekNote}; ${moveNote}`;
    // Resi yang sudah tertulis di ekspor final container lama harus diekspor ulang bersama container baru.
    const status: ReceiptStatus | undefined = r.status === 'exported' ? 'approved' : undefined;

    await prisma.receipt.update({
      where: { id: r.id },
      data: { containerId: target.id, carriedFromContainerId: r.containerId, cekNote, ...(status ? { status } : {}) },
    });
    await audit(prisma, {
      actorId: actor.id,
      action: 'receipt.move',
      entity: 'receipt',
      entityId: r.id,
      before: { containerSeqNo: r.container.seqNo, cekNote: r.cekNote, status: r.status },
      after: { containerSeqNo: target.seqNo, cekNote, status: status ?? r.status },
      reason: input.note ?? null,
      ip: req.ip,
    });
    res.json(toDetail(await loadReceipt(r.id, actor)));
  });

  // ─── Rekap per sales (PRD F6, menggantikan sheet "PVT Loading") ──────

  router.get('/containers/:id/summary', ANY, async (req, res) => {
    const actor = req.user!;
    const receipts = await prisma.receipt.findMany({
      where: {
        containerId: String(req.params.id),
        deletedAt: null,
        status: { not: 'rejected' },
        ...(actor.role === 'sales' ? { salesId: actor.id } : {}),
      },
      include: { packages: true, sales: true },
    });
    const bySales = new Map<string, { salesId: string; sales: string; invoices: number; pcs: number; kg: number; approved: number; pending: number }>();
    for (const r of receipts) {
      const row = bySales.get(r.salesId) ?? {
        salesId: r.salesId,
        sales: r.sales.displayName ?? r.sales.name,
        invoices: 0,
        pcs: 0,
        kg: 0,
        approved: 0,
        pending: 0,
      };
      row.invoices += 1;
      row.pcs += excelColumns(r.packages).pcs;
      row.kg += r.weightKg === null ? 0 : Number(r.weightKg);
      if (r.status === 'approved' || r.status === 'exported') row.approved += 1;
      else row.pending += 1;
      bySales.set(r.salesId, row);
    }
    const rows = [...bySales.values()]
      .map((r) => ({ ...r, kg: Math.round(r.kg * 100) / 100 }))
      .sort((a, b) => a.sales.localeCompare(b.sales, 'id'));
    const total = rows.reduce(
      (t, r) => ({
        invoices: t.invoices + r.invoices,
        pcs: t.pcs + r.pcs,
        kg: Math.round((t.kg + r.kg) * 100) / 100,
        approved: t.approved + r.approved,
        pending: t.pending + r.pending,
      }),
      { invoices: 0, pcs: 0, kg: 0, approved: 0, pending: 0 },
    );
    res.json({ rows, total });
  });

  return router;
}
