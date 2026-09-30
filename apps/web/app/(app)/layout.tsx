import Link from 'next/link';
import { ROLE_LABEL } from '@csm/shared';
import { LogoutButton } from '@/components/logout-button';
import { getMe } from '@/lib/api';

/** App shell (PRD §8): bar atas hijau 44 px · navigasi samping 232 px (atas di HP) · konten. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const staff = me.role !== 'sales';
  const nav = [
    { href: '/containers', label: 'Container' },
    ...(staff ? [{ href: '/admin/users', label: 'Kelola user' }] : []),
  ];

  return (
    <div className="grid min-h-dvh grid-rows-[44px_auto_1fr] md:grid-cols-[232px_1fr] md:grid-rows-[44px_1fr]">
      <header className="col-span-full flex items-center gap-3 bg-green-700 px-4 text-white">
        <span className="font-semibold">CSM</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-meta sm:inline">
            {me.displayName ?? me.name} · {ROLE_LABEL[me.role]}
          </span>
          <LogoutButton />
        </div>
      </header>
      <nav aria-label="Menu" className="flex gap-1 border-b border-grid bg-surface p-2 md:flex-col md:border-r md:border-b-0">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="rounded-button px-3 py-1.5 text-green-800 hover:bg-green-50">
            {n.label}
          </Link>
        ))}
      </nav>
      <main className="min-w-0 overflow-auto p-4 md:p-6">{children}</main>
    </div>
  );
}
