import type { RequestHandler } from 'express';
import { verifyAccess } from './tokens.js';

export const COOKIE = {
  access: 'csm_at',
  refresh: 'csm_rt',
  csrf: 'csm_csrf',
  flow: 'csm_oauth',
} as const;

/** Isi `req.user` dari cookie access JWT. Role ada di token; user nonaktif keluar paling lambat 15 menit. */
export function sessionMiddleware(secret: string): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.[COOKIE.access] as string | undefined;
    if (token) {
      const claims = await verifyAccess(token, secret);
      if (claims) req.user = { id: claims.sub, role: claims.role, displayName: claims.displayName };
    }
    next();
  };
}
