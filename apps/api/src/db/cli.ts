import { loadConfig } from '../config/env.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';
import { DEMO, seed } from './seed.js';

const RESET_SQL = 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;';

async function main(command: string | undefined): Promise<void> {
  const config = loadConfig();
  const db = createPool(config.databaseUrl, 2);
  try {
    if (command === 'migrate') {
      const ran = await migrate(db);
      console.warn(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
    } else if (command === 'seed') {
      if (config.nodeEnv === 'production')
        throw new Error('Refusing to seed public demo accounts into a production database');
      const { events } = await seed(db);
      console.warn(
        events
          ? `Seeded ${events} events. Sign in as ${DEMO.ownerEmail} / ${DEMO.password}`
          : 'Demo data already present',
      );
    } else if (command === 'reset') {
      if (config.nodeEnv === 'production')
        throw new Error('Refusing to reset a production database');
      await db.query(RESET_SQL);
      await migrate(db);
      const { events } = await seed(db);
      console.warn(`Database reset; seeded ${events} events`);
    } else {
      throw new Error('Usage: cli.ts <migrate|seed|reset>');
    }
  } finally {
    await db.end();
  }
}

main(process.argv[2]).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
