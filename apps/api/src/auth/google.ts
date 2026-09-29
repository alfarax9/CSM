import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

/** Klaim ID token Google yang sudah diverifikasi tanda tangan, aud, iss, exp, dan nonce. */
export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  hostedDomain: string | null;
  name: string | null;
  picture: string | null;
}

export interface AuthUrlParams {
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** Batas ke Google, diganti tiruan di test. */
export interface GoogleGateway {
  authUrl(params: AuthUrlParams): string;
  exchange(code: string, codeVerifier: string, expectedNonce: string): Promise<GoogleClaims>;
}

export function createGoogleGateway(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Jika hanya satu domain Workspace, tampilkan akun domain itu saja di pemilih akun. */
  hostedDomain?: string;
}): GoogleGateway {
  const client = new OAuth2Client({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri: opts.redirectUri,
  });

  return {
    authUrl({ state, nonce, codeChallenge }) {
      return client.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        access_type: 'online',
        prompt: 'select_account',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        ...(opts.hostedDomain ? { hd: opts.hostedDomain } : {}),
      });
    },

    async exchange(code, codeVerifier, expectedNonce) {
      const { tokens } = await client.getToken({ code, codeVerifier });
      if (!tokens.id_token) throw new Error('Google tidak mengembalikan ID token.');
      // verifyIdToken memeriksa tanda tangan (JWKS Google), aud, iss, dan exp.
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: opts.clientId });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email) throw new Error('ID token tanpa sub/email.');
      if (p.nonce !== expectedNonce) throw new Error('Nonce ID token tidak cocok.');
      return {
        sub: p.sub,
        email: p.email.toLowerCase(),
        emailVerified: p.email_verified === true,
        hostedDomain: p.hd?.toLowerCase() ?? null,
        name: p.name ?? null,
        picture: p.picture ?? null,
      };
    },
  };
}
