/**
 * A variable's names: its own, then for `MILD_<name>` `SIFT_<name>`, its name before Sift was Mild, which an install set
 * up before then still uses. The old names go once every install has moved (TODO.md).
 */
export const namesOf = (name: string): string[] => (name.startsWith('MILD_') ? [name, `SIFT_${name.slice('MILD_'.length)}`] : [name]);

/** A variable, under the first of its names that is set. */
export function named(env: Record<string, string | undefined>, name: string): string | undefined {
  return namesOf(name)
    .map((n) => env[n])
    .find((value) => value !== undefined);
}
