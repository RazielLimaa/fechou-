import 'dotenv/config';
import app from './app.js';
import { closeDatabasePool, testDatabaseConnection } from './db/index.js';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const;

const REQUIRED_IN_PRODUCTION = [
  'TOKENS_ENCRYPTION_KEY',
  'MERCADO_PAGO_WEBHOOK_SECRET',
  'MP_WEBHOOK_SECRET',
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variável de ambiente obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === 'production') {
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!process.env[key]) {
      console.error(`❌ Variável de ambiente obrigatória ausente em produção: ${key}`);
      process.exit(1);
    }
  }
}

if (process.env.JWT_SECRET!.length < 32) {
  console.error('❌ JWT_SECRET deve ter ao menos 32 caracteres.');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3001);
let server: ReturnType<typeof app.listen> | null = null;

async function bootstrap() {
  const dbHealthy = await testDatabaseConnection();
  if (!dbHealthy) {
    console.warn('[boot] Postgres indisponível no startup. API iniciará em modo degradado (fail-open em rate limit distribuído).');
  }

  server = app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Fechou! backend rodando em http://localhost:${port}`);
  });
}

async function shutdown(signal: string) {
  console.log(`${signal} recebido. Encerrando...`);

  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
  }

  await closeDatabasePool();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

void bootstrap();
