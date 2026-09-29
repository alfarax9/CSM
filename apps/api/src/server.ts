import pino from 'pino';
import { createServerApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const log = pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug' });

createServerApp().listen(env.API_PORT, () => {
  log.info({ port: env.API_PORT }, 'api siap');
});
