'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { apiSend } from '@/lib/client-api';

export function MarkAudited({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        className="h-7"
        onClick={async () => {
          const res = await apiSend('POST', `/audit/receipts/${id}/done`);
          if (!res.ok) return setError(res.error ?? '');
          router.refresh();
        }}
      >
        Tandai diaudit
      </Button>
      {error && <span className="text-meta text-bad-ink">{error}</span>}
    </div>
  );
}
