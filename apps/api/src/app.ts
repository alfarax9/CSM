import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createGoogleGateway, type GoogleGateway } from './auth/google.js';
import { sessionMiddleware } from './auth/session.js';
import { db } from './db.js';
import { googleRedirectUri, loadEnv, type Env } from './env.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { errorHandler, notFound } from './http/errors.js';
import { createPii } from './pii.js';
import { createImageStore } from './storage/images.js';
import { createAuthRouter } from './routes/auth.js';
import { createContainersRouter } from './routes/containers.js';
import { createInsightsRouter } from './routes/insights.js';
import { createReceiptsRouter } from './routes/receipts.js';
import { healthRouter } from './routes/health.js';
import { createUsersRouter } from './routes/users.js';

export interface AppDeps {
  env?: Env;
  /** Tanpa prisma, hanya rute yang tidak butuh database yang aktif (mis. /health di test unit). */
  prisma?: PrismaClient;
  google?: GoogleGateway;
}

export function createApp(deps: AppDeps = {}): Express {
  const env = deps.env ?? loadEnv();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // di belakang Caddy / Cloudflare (PRD §12)
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware(env.JWT_SECRET));

  const v1 = express.Router();
  v1.use(healthRouter);
  if (deps.prisma) {
    const google =
      deps.google ??
      createGoogleGateway({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: googleRedirectUri(env),
        hostedDomain: env.ALLOWED_GOOGLE_DOMAINS.length === 1 ? env.ALLOWED_GOOGLE_DOMAINS[0] : undefined,
      });
    v1.use(createAuthRouter({ prisma: deps.prisma, google, env }));
    v1.use(createUsersRouter(deps.prisma));
    v1.use(createContainersRouter(deps.prisma));
    v1.use(createInsightsRouter(deps.prisma));
    v1.use(
      createReceiptsRouter(
        deps.prisma,
        createPii(env.PII_ENCRYPTION_KEY, env.PII_BIDX_KEY),
        createImageStore(env.UPLOADS_DIR, env.JWT_SECRET),
      ),
    );
  }
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** App lengkap untuk server: memakai database dari DATABASE_URL. */
export function createServerApp(): Express {
  return createApp({ prisma: db() });
}
