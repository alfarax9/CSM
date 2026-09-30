import { type NextRequest, NextResponse } from 'next/server';

/**
 * Halaman aplikasi butuh sesi. Access token (15 menit) habis → perpanjang lewat /api/v1/auth/renew
 * selama masih ada tanda sesi (cookie csrf 7 hari); jika tidak ada → halaman login.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has('csm_at')) return NextResponse.next();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  const target = req.cookies.has('csm_csrf')
    ? new URL(`/api/v1/auth/renew?next=${encodeURIComponent(next)}`, req.url)
    : new URL('/login', req.url);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ['/((?!login|api|_next|favicon.ico).*)'],
};
