// Next.js runs this once as each server starts, before it answers. See docs/runtime.md.
export async function register() {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  await (await import('./src/sift/instance.ts')).takeUpRuns();
}
