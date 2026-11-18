// JavaScript, not TypeScript: Next.js announces loading a TypeScript config on the terminal `sift run` prints to.
import { withWorkflow } from 'workflow/next';
import { PAGE_HEADERS } from './src/dashboard/policy.ts';

/** @type {import('next').NextConfig} */
export default withWorkflow({
  // `pnpm typecheck` checks the page and the server with their own settings (tsconfig.web.json, tsconfig.json).
  typescript: { tsconfigPath: 'tsconfig.web.json', ignoreBuildErrors: true },
  poweredByHeader: false,
  // Nothing uses next/image, so /_next/image optimizes nothing for anyone.
  images: { unoptimized: true },
  // The page and its files. The API and sign-in send their own (src/dashboard/server.ts), the message frame's among them.
  headers: async () => [{ source: '/((?!api/|auth/).*)', headers: Object.entries(PAGE_HEADERS).map(([key, value]) => ({ key, value })) }],
  // Workflow builds a route that resumes a run waiting on a webhook. Sift creates none, so a request there finds no page.
  rewrites: async () => ({
    beforeFiles: [
      { source: '/.well-known/workflow/v1/webhook/:path*', destination: '/.well-known/workflow/v1/no-webhook' },
      { source: '/sender/:account/:address', destination: '/sender' },
      { source: '/domain/:account/:domain', destination: '/domain' },
    ],
    afterFiles: [],
    fallback: [],
  }),
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
