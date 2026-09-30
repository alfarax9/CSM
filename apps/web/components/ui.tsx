import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** Komponen dasar sesuai token PRD §8: tinggi 32 px, radius input 2 px, tombol 4 px. */
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const look =
    variant === 'primary'
      ? 'bg-green-600 text-white hover:bg-green-700 disabled:bg-grid'
      : 'border border-grid bg-surface text-ink hover:bg-green-50 disabled:text-ink-muted';
  return <button className={`h-8 rounded-button px-3 font-semibold ${look} ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-8 w-full rounded-cell border border-grid bg-surface px-2 ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`h-8 w-full rounded-cell border border-grid bg-surface px-2 ${className}`} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-meta text-ink-muted">
      {label}
      {children}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="rounded-cell bg-bad px-3 py-2 text-bad-ink">
      {children}
    </p>
  ) : null;
}

export function Pill({ tone, children }: { tone: 'good' | 'neutral' | 'bad' | 'plain'; children: ReactNode }) {
  const look = {
    good: 'bg-good text-good-ink',
    neutral: 'bg-neutral text-neutral-ink',
    bad: 'bg-bad text-bad-ink',
    plain: 'border border-grid text-ink-muted',
  }[tone];
  return <span className={`inline-block rounded-cell px-2 py-0.5 text-meta ${look}`}>{children}</span>;
}

/** Tabel ala grid Excel: border 1 px, baris 32 px, header abu. */
export function Grid({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-cell border border-grid bg-surface">
      <table className="w-full border-collapse text-cell">
        <thead className="bg-canvas text-left text-ink-muted">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const th = 'h-8 whitespace-nowrap border-b border-grid px-3 font-normal';
export const td = 'h-8 whitespace-nowrap border-b border-grid px-3';
