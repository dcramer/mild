import { defineConfig } from 'drizzle-kit';

/** `pnpm db:generate` writes a migration from the schema's changes. sift applies them itself when it opens the database. */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/store/schema.ts',
  out: './src/store/migrations',
  entities: { roles: true },
});
