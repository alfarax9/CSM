import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody, ErrorCode } from '@csm/shared';
import { ZodError } from 'zod';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERIAL_DUPLICATE: 409,
  SERIAL_RESERVED: 409,
  PHOTO_DUPLICATE: 409,
  EXTRACTION_UNAVAILABLE: 503,
  EXTRACTION_FAILED: 502,
  CONTAINER_NOT_LOCKED: 409,
  CONTAINER_CLOSED: 409,
  INTERNAL: 500,
};

/** Error yang aman ditampilkan ke user; pesan dalam Bahasa Indonesia (PRD §8 aturan 8). */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Endpoint ${req.method} ${req.path} tidak ditemukan.`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let body: ApiErrorBody;
  if (err instanceof AppError) {
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    body = { error: { code: 'VALIDATION_FAILED', message: 'Data tidak valid.', details: err.issues } };
  } else {
    body = { error: { code: 'INTERNAL', message: 'Terjadi kesalahan di server.' } };
  }
  res.status(STATUS_BY_CODE[body.error.code]).json(body);
};
