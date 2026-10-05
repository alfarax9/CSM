import Link from 'next/link';

export type Sheet = 'loading' | 'rekap';

const TABS: { key: Sheet; label: string }[] = [
  { key: 'loading', label: 'Loading' },
  { key: 'rekap', label: 'Rekap Sales' },
];

/** Sheet tabs ala Excel (PRD §8): berpindah tampilan container. */
export function SheetTabs({ containerId, active }: { containerId: string; active: Sheet }) {
  return (
    <nav aria-label="Sheet" className="flex border-b border-grid text-cell">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === 'loading' ? `/containers/${containerId}` : `/containers/${containerId}?sheet=${t.key}`}
          aria-current={t.key === active ? 'page' : undefined}
          className={
            t.key === active
              ? '-mb-px border-x border-t border-b-2 border-grid border-b-green-600 bg-surface px-4 py-1.5 font-semibold text-green-800'
              : 'px-4 py-1.5 text-ink-muted hover:text-green-800'
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
