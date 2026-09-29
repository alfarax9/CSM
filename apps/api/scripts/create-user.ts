/**
 * Daftarkan user dari CLI server — dipakai untuk Super Admin pertama (PRD §3: hanya user terdaftar yang bisa login).
 *   npm run user:create -w @csm/api -- --email owner@namaperusahaan.co.id --name "Nama" --role super_admin
 * Setiap pemakaian tercatat di audit_logs.
 */
import { ROLES, type Role } from '@csm/shared';
import { audit } from '../src/audit.js';
import { db } from '../src/db.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg('--email')?.toLowerCase();
const name = arg('--name');
const role = arg('--role') as Role | undefined;
if (!email || !name || !role || !ROLES.includes(role)) {
  console.error(`Pakai: --email <email Google> --name <nama> --role <${ROLES.join('|')}> [--display-name "Mr. Said"]`);
  process.exit(1);
}

const prisma = db();
const user = await prisma.user.upsert({
  where: { email },
  update: { name, role, displayName: arg('--display-name') ?? null, isActive: true },
  create: { email, name, role, displayName: arg('--display-name') ?? null },
});
await audit(prisma, { action: 'user.register.cli', entity: 'user', entityId: user.id, after: { email, role } });

// Email di luar domain Workspace (mis. Gmail pribadi) hanya bisa login jika ada di whitelist (PRD §3 butir 3).
const allowed = (process.env.ALLOWED_GOOGLE_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase());
if (!allowed.includes(email.split('@')[1]!)) {
  await prisma.emailWhitelist.upsert({
    where: { email },
    update: {},
    create: { email, note: 'didaftarkan lewat user:create', createdBy: user.id },
  });
  console.log(`Email di luar ALLOWED_GOOGLE_DOMAINS → ditambahkan ke whitelist.`);
}
console.log(`User ${email} (${role}) siap. Masuk lewat tombol "Masuk dengan Google".`);
await prisma.$disconnect();
