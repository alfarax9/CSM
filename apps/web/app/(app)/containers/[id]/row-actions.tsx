'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReceiptStatus } from '@csm/shared';
import { Button } from '@/components/ui';
import { apiSend } from '@/lib/client-api';

/** Approve / tolak langsung dari sheet (Admin). */
export function RowActions({ id, serialNo, status }: { id: string; serialNo: number; status: ReceiptStatus }) {
  const router = useRouter();
  const [error, setError] = useState('');
  if (status !== 'ready' && status !== 'submitted') return null;

  async function run(path: string, body?: unknown) {
    const res = await apiSend('POST', `/receipts/${id}/${path}`, body);
    if (!res.ok) return setError(res.error ?? '');
    setError('');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" className="h-7" onClick={() => run('approve')}>
        Approve resi
      </Button>
      <Button
        variant="secondary"
        className="h-7"
        onClick={() => {
          const reason = window.prompt(`Alasan menolak resi ${serialNo}?`);
          if (reason) run('reject', { reason });
        }}
      >
        Tolak
      </Button>
      {error && <span className="text-meta text-bad-ink">{error}</span>}
    </div>
  );
}
