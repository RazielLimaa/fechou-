import 'dotenv/config';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variável de ambiente obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

if (process.env.JWT_SECRET!.length < 32) {
  console.error('❌ JWT_SECRET deve ter ao menos 32 caracteres.');
  process.exit(1);
}

import app from './app.js';

const port = Number(process.env.PORT ?? 3001);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Fechou! backend rodando em http://localhost:${port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} recebido. Encerrando...`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));