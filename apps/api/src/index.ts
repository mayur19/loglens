import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { ensurePartitions } from './db/partitions.js';
import { createPool } from './db/pool.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  const app = await buildApp({ config, db });
  await ensurePartitions(db, new Date());
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
