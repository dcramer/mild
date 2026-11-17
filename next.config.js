// JavaScript, not TypeScript: Next.js announces loading a TypeScript config on the terminal `sift run` prints to.
import { withWorkflow } from 'workflow/next';

/** @type {import('next').NextConfig} */
export default withWorkflow({
  // `pnpm typecheck` checks the page and the server with their own settings (tsconfig.web.json, tsconfig.json).
  typescript: { tsconfigPath: 'tsconfig.web.json', ignoreBuildErrors: true },
  poweredByHeader: false,
  // Loaded from node_modules as they are, not bundled: PGlite and pi-ai load files beside their own modules,
  // and pi-ai names provider SDKs that pnpm-workspace.yaml leaves out of the install.
  serverExternalPackages: [
    '@electric-sql/pglite',
    '@earendil-works/pi-ai',
    '@sentry/node',
    '@googleapis/gmail',
    'google-auth-library',
    'drizzle-orm',
    'pg',
    'redis',
  ],
  // The migrations are read at run time (`src/store/db.ts`), and Workflow's flow route opens the database too.
  outputFileTracingIncludes: {
    '/api/**': ['src/store/migrations/**'],
    '/auth/**': ['src/store/migrations/**'],
    '/.well-known/workflow/**': ['src/store/migrations/**'],
  },
});
