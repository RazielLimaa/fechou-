import 'dotenv/config';
import type { Server } from 'node:http';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'FRONTEND_URL',
  'SIGNATURES_MASTER_KEY',
] as const;

const PORT = Number(process.env.PORT ?? 10000);
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

  if (process.env.JWT_SECRET!.length < 32) {
    console.error('JWT_SECRET must have at least 32 characters.');
    process.exit(1);
  }

  if (!process.env.GOOGLE_CALLBACK_URL && !process.env.GOOGLE_REDIRECT_URI) {
    console.error('Required environment variable is missing: GOOGLE_CALLBACK_URL');
    process.exit(1);
  }

  const mercadoPagoConfigured = Boolean(
    process.env.MP_CLIENT_ID ||
      process.env.MP_ACCESS_TOKEN ||
      process.env.MP_PLATFORM_ACCESS_TOKEN,
  );

  if (mercadoPagoConfigured && !process.env.TOKENS_ENCRYPTION_KEY) {
    console.warn('[boot] TOKENS_ENCRYPTION_KEY is missing; Mercado Pago OAuth token storage will fail until it is configured.');
  }

  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.MERCADO_PAGO_WEBHOOK_SECRET &&
    !process.env.MP_WEBHOOK_SECRET
  ) {
    console.warn('[boot] Mercado Pago webhook secret is missing; webhook requests will be rejected until it is configured.');
  }
}

async function bootstrap() {
  validateEnvironment();

  const { default: app } = await import('./app.js');

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error('[boot] failed to start HTTP server:', err);
    process.exit(1);
  });

  void runStartupTasks().catch((err) => {
    console.error('[boot] startup tasks failed:', err);
  });
}

async function runStartupTasks() {
  const [dbModule, mercadoPagoWebhookQueue, authInfrastructure] = await Promise.all([
    import('./db/index.js'),
    import('./services/payments/mercadoPagoWebhookQueue.js'),
    import('./db/authInfrastructure.js'),
  ]);

  closeDatabasePool = dbModule.closeDatabasePool;
  stopMercadoPagoWebhookWorker = mercadoPagoWebhookQueue.stopMercadoPagoWebhookWorker;

  try {
    await authInfrastructure.ensureAuthInfrastructure();
  } catch (err) {
    console.error('[boot] failed to ensure auth/security database infrastructure:', err);
  }

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

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err);
  process.exit(1);
});

void bootstrap().catch((err) => {
  console.error('[boot] failed to initialize application:', err);
  process.exit(1);
});
