import { redirect } from 'next/navigation';

export default function Home() {
  // Fase 1: arahkan sesuai sesi & role. Sekarang selalu ke login.
  redirect('/login');
}
