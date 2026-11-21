/**
 * A variable; for `MILD_<name>`, else `SIFT_<name>`, its name before Sift was Mild, which an install set up before
 * then still uses. The old names go once every install has moved (TODO.md).
 */
export function named(env: Record<string, string | undefined>, name: string): string | undefined {
  return env[name] ?? (name.startsWith('MILD_') ? env[`SIFT_${name.slice('MILD_'.length)}`] : undefined);
}
