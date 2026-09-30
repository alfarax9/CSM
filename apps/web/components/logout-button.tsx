'use client';

import { apiSend } from '@/lib/client-api';

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await apiSend('POST', '/auth/logout');
        window.location.href = '/login';
      }}
      className="h-8 rounded-button px-3 text-white hover:bg-green-800"
    >
      Keluar
    </button>
  );
}
