import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@csm/shared';

export const ACCESS_TTL_S = 15 * 60; // PRD §3: JWT access 15 menit
export const REFRESH_TTL_S = 7 * 24 * 60 * 60; // refresh 7 hari
export const FLOW_TTL_S = 10 * 60; // batas waktu menyelesaikan login Google

const ISSUER = 'csm';

export interface AccessClaims {
  sub: string;
  role: Role;
  displayName: string | null;
}

export interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
}

const key = (secret: string) => new TextEncoder().encode(secret);

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** code_challenge PKCE (S256) dari code_verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function signAccess(claims: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ role: claims.role, dn: claims.displayName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience('access')
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .sign(key(secret));
}

export async function verifyAccess(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, audience: 'access' });
    return { sub: payload.sub!, role: payload.role as Role, displayName: (payload.dn as string | null) ?? null };
  } catch {
    return null;
  }
}

/** State, nonce, dan PKCE verifier disimpan di cookie bertanda tangan selama alur login. */
export async function signFlow(flow: FlowState, secret: string): Promise<string> {
  return new SignJWT({ ...flow })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('oauth-flow')
    .setExpirationTime(`${FLOW_TTL_S}s`)
    .sign(key(secret));
}

export async function verifyFlow(token: string, secret: string): Promise<FlowState | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, audience: 'oauth-flow' });
    const { state, nonce, verifier } = payload as unknown as FlowState;
    return state && nonce && verifier ? { state, nonce, verifier } : null;
  } catch {
    return null;
  }
}
