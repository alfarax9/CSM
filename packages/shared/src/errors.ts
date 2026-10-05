/** Format error seragam API (PRD §11). */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'SERIAL_DUPLICATE',
  'SERIAL_RESERVED',
  'PHOTO_DUPLICATE',
  'CONTAINER_NOT_LOCKED',
  'CONTAINER_CLOSED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
