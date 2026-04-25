import 'dotenv/config';
import type { Server } from 'node:http';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'SIGNATURES_MASTER_KEY',
] as const;

const REQUIRED_IN_PRODUCTION = [
  'TOKENS_ENCRYPTION_KEY',
  'MERCADO_PAGO_WEBHOOK_SECRET',
  'MP_WEBHOOK_SECRET',
] as const;

const PORT = Number(process.env.PORT) || 3001;

let server: Server | null = null;
let closeDatabasePool: (() => Promise<void>) | null = null;
let stopMercadoPagoWebhookWorker: (() => void) | null = null;

function validateEnvironment() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      console.error(`Required environment variable is missing: ${key}`);
      process.exit(1);
    }
  }

  if (process.env.NODE_ENV === 'production') {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!process.env[key]) {
        console.error(`Required production environment variable is missing: ${key}`);
        process.exit(1);
      }
    }
  }

  if (process.env.JWT_SECRET!.length < 32) {
    console.error('JWT_SECRET must have at least 32 characters.');
    process.exit(1);
  }

  const mercadoPagoConfigured = Boolean(
    process.env.MP_CLIENT_ID ||
      process.env.MP_ACCESS_TOKEN ||
      process.env.MP_PLATFORM_ACCESS_TOKEN,
  );

  if (mercadoPagoConfigured && !process.env.TOKENS_ENCRYPTION_KEY) {
    console.error('TOKENS_ENCRYPTION_KEY is required when Mercado Pago integrations are enabled.');
    process.exit(1);
  }
}

async function bootstrap() {
  validateEnvironment();

  const [{ default: app }, dbModule, mercadoPagoWebhookQueue] = await Promise.all([
    import('./app.js'),
    import('./db/index.js'),
    import('./services/payments/mercadoPagoWebhookQueue.js'),
  ]);

  closeDatabasePool = dbModule.closeDatabasePool;
  stopMercadoPagoWebhookWorker = mercadoPagoWebhookQueue.stopMercadoPagoWebhookWorker;

  const dbHealthy = await dbModule.testDatabaseConnectionWithRetry({
    maxAttempts: Number(process.env.DB_STARTUP_MAX_ATTEMPTS ?? 6),
    retryDelayMs: Number(process.env.DB_STARTUP_RETRY_MS ?? 2_000),
  });
  mercadoPagoWebhookQueue.startMercadoPagoWebhookWorker();

  const requireDbOnStartup = process.env.DB_REQUIRED_ON_STARTUP === 'true';

  if (!dbHealthy) {
    if (requireDbOnStartup) {
      console.error('[boot] Postgres unavailable on startup. Exiting because DB_REQUIRED_ON_STARTUP=true.');
      process.exit(1);
    }

    console.warn('[boot] Postgres unavailable on startup. API will start in degraded mode.');
  }

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error('[boot] failed to start HTTP server:', err);
    process.exit(1);
  });
}

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down...`);

  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
  }

  await closeDatabasePool?.();
  stopMercadoPagoWebhookWorker?.();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

void bootstrap().catch((err) => {
  console.error('[boot] failed to initialize application:', err);
  process.exit(1);
});
