// Next.js runs this once as each server starts, before it answers. See docs/runtime.md.
export async function register() {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { begin } = await import('./src/app/flow.ts');
  const { offerBegin, offerSift, offeredSift } = await import('./src/app/process.ts');
  offerBegin(begin);
  // `sift run` offers its own before Next.js starts; on Vercel each instance opens one when a step first needs it.
  if (!offeredSift()) offerSift((await import('./src/vercel/host.ts')).forSteps);
}
