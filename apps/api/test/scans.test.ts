/** Scan foto (F1): simpan sementara, kaitkan ke resi, foto identik ditolak, URL bertanda tangan, ganti foto. */
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { GoogleGateway } from '../src/auth/google.js';
import { signAccess } from '../src/auth/tokens.js';
import { db } from '../src/db.js';
import { loadEnv } from '../src/env.js';
import { jpegSize } from '../src/storage/images.js';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const DOMAIN = 'scan.csm.test';
const SEQ = 960001;
const SERIAL = [93001, 93002];
const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const FOTO_A = fixture('foto-a.jpg');
const FOTO_B = fixture('foto-b.jpg');
const KECIL = fixture('kecil.jpg');
const uploads = mkdtempSync(path.join(os.tmpdir(), 'csm-uploads-'));
const env = loadEnv({ ...process.env, NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000', UPLOADS_DIR: uploads });
const google: GoogleGateway = { authUrl: () => '', exchange: async () => { throw new Error('x'); } };

describe('jpegSize', () => {
  it('membaca ukuran dari header JPEG', () => {
    expect(jpegSize(FOTO_A)).toEqual({ width: 900, height: 1270 });
    expect(jpegSize(Buffer.from('bukan jpeg'))).toBeNull();
  });
});

describe.skipIf(!HAS_DB)('scan foto resi', () => {
  const prisma = HAS_DB ? db() : (undefined as never);
  const app = createApp({ env, prisma, google });
  let containerId = '';
  let said = '';
  let admin = '';
  let other = '';
  const as = async (id: string, role: 'admin' | 'sales') => `csm_at=${await signAccess({ sub: id, role, displayName: null }, env.JWT_SECRET)}`;

  async function cleanup() {
    const rs = await prisma.receipt.findMany({ where: { serialNo: { in: SERIAL } } });
    await prisma.receiptImage.deleteMany({ where: { receiptId: { in: rs.map((r) => r.id) } } });
    await prisma.receiptPackage.deleteMany({ where: { receiptId: { in: rs.map((r) => r.id) } } });
    await prisma.receipt.deleteMany({ where: { id: { in: rs.map((r) => r.id) } } });
    const c = await prisma.container.findUnique({ where: { seqNo: SEQ } });
    if (c) {
      await prisma.scanAttempt.deleteMany({ where: { containerId: c.id } });
      await prisma.container.delete({ where: { id: c.id } });
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  }

  beforeEach(async () => {
    await cleanup();
    admin = (await prisma.user.create({ data: { email: `admin@${DOMAIN}`, name: 'Admin', role: 'admin' } })).id;
    said = (await prisma.user.create({ data: { email: `said@${DOMAIN}`, name: 'Said', role: 'sales', displayName: 'Mr. Said' } })).id;
    other = (await prisma.user.create({ data: { email: `lain@${DOMAIN}`, name: 'Lain', role: 'sales' } })).id;
    containerId = (await prisma.container.create({ data: { seqNo: SEQ, status: 'loading', createdBy: admin } })).id;
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    rmSync(uploads, { recursive: true, force: true });
  });

  const scan = async (who: string, role: 'admin' | 'sales', foto: Buffer) =>
    request(app).post(`/api/v1/containers/${containerId}/scans`).set('Cookie', await as(who, role))
      .set('Content-Type', 'image/jpeg').set('x-blur-score', '412.5').send(foto);

  it('Sales scan → simpan resi dengan foto → foto bisa dibuka lewat URL bertanda tangan', async () => {
    const up = await scan(said, 'sales', FOTO_A);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ width: 900, height: 1270 });

    const created = await request(app).post(`/api/v1/containers/${containerId}/receipts`).set('Cookie', await as(said, 'sales'))
      .send({ serialNo: SERIAL[0], imageToken: up.body.token, packages: { koper: 1 }, koliTotal: 1, weightKg: 20 });
    expect(created.status).toBe(201);
    expect(created.body.image).toMatchObject({ version: 1, width: 900, blurScore: 412.5 });
    const r = await prisma.receipt.findUnique({ where: { id: created.body.id } });
    expect(r?.source).toBe('camera');

    const url: string = created.body.image.url;
    expect(url).toMatch(/^\/api\/v1\/receipt-images\/.+\?exp=\d+&sig=/);
    const img = await request(app).get(url);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(img.body as Buffer, FOTO_A)).toBe(0);

    const forged = await request(app).get(url.replace(/sig=[^&]+/, 'sig=palsu'));
    expect(forged.status).toBe(403);
  });

  it('foto identik ditolak (PRD F7 lapis 1) dan tercatat sebagai duplikat sha256', async () => {
    const up = await scan(said, 'sales', FOTO_A);
    await request(app).post(`/api/v1/containers/${containerId}/receipts`).set('Cookie', await as(said, 'sales'))
      .send({ serialNo: SERIAL[0], imageToken: up.body.token });
    const again = await scan(admin, 'admin', FOTO_A);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PHOTO_DUPLICATE');
    expect(again.body.error.message).toContain(`resi ${SERIAL[0]}`);
    expect(await prisma.scanAttempt.count({ where: { containerId, duplicateLayer: 'sha256' } })).toBe(1);
  });

  it('token foto milik user lain atau resolusi terlalu kecil ditolak', async () => {
    const up = await scan(said, 'sales', FOTO_A);
    const steal = await request(app).post(`/api/v1/containers/${containerId}/receipts`).set('Cookie', await as(other, 'sales'))
      .send({ serialNo: SERIAL[0], imageToken: up.body.token });
    expect(steal.status).toBe(400);
    expect((await scan(said, 'sales', KECIL)).status).toBe(400);
    const notJpeg = await request(app).post(`/api/v1/containers/${containerId}/scans`).set('Cookie', await as(said, 'sales'))
      .set('Content-Type', 'image/jpeg').send(Buffer.from('bukan foto'));
    expect(notJpeg.status).toBe(400);
  });

  it('ganti foto membuat versi baru; versi lama ditandai diganti', async () => {
    const up = await scan(said, 'sales', FOTO_A);
    const { body } = await request(app).post(`/api/v1/containers/${containerId}/receipts`).set('Cookie', await as(said, 'sales'))
      .send({ serialNo: SERIAL[1], imageToken: up.body.token });
    const replaced = await request(app).post(`/api/v1/receipts/${body.id}/image`).set('Cookie', await as(said, 'sales'))
      .set('Content-Type', 'image/jpeg').send(FOTO_B);
    expect(replaced.status).toBe(201);
    expect(replaced.body.image.version).toBe(2);
    const versions = await prisma.receiptImage.findMany({ where: { receiptId: body.id }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => [v.version, v.replacedAt !== null])).toEqual([[1, true], [2, false]]);

    const otherSales = await request(app).post(`/api/v1/receipts/${body.id}/image`).set('Cookie', await as(other, 'sales'))
      .set('Content-Type', 'image/jpeg').send(FOTO_B);
    expect(otherSales.status).toBe(404); // resi sales lain tidak terlihat
  });
});
