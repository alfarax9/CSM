import type { RequestHandler } from 'express';
import type { Role } from '@csm/shared';
import { AppError } from './errors.js';

/** User yang sudah terautentikasi; diisi middleware sesi (Fase 1, login Google). */
export interface SessionUser {
  id: string;
  role: Role;
  displayName: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/**
 * Cek role di middleware (PRD §11). Kepemilikan data Sales (`sales_id`)
 * diperiksa di query, bukan di sini.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Silakan masuk dengan Google.'));
    if (!allowed.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', 'Anda tidak punya akses ke aksi ini.'));
    }
    next();
  };
}
