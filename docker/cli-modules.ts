/**
 * What the image's command line needs of node_modules, beside the standalone server's: preloaded in the build stage
 * while `src/cli/main.ts help` loads every command, it prints each package folder that was loaded (`store <dir>`,
 * under node_modules/.pnpm, with the links to its own dependencies) and each package `src/` names (`link <name>`).
 *
 *   node --import ./docker/cli-modules.ts src/cli/main.ts help > /dev/null 2> cli-modules.txt
 */
import { registerHooks } from 'node:module';

const lines = new Set<string>();
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    const store = /\/node_modules\/\.pnpm\/([^/]+)\//.exec(resolved.url)?.[1];
    if (store) lines.add(`store ${store}`);
    const bare = !specifier.startsWith('.') && !specifier.startsWith('node:') && !specifier.startsWith('/') && !specifier.startsWith('file:');
    if (store && bare && context.parentURL?.includes('/src/') && !context.parentURL.includes('/node_modules/'))
      lines.add(`link ${specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]}`);
    return resolved;
  },
});
process.once('exit', () => process.stderr.write([...lines, ''].join('\n')));
