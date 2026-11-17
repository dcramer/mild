/** A height kept in storage, or null when none was. 0 is a height: a part that was empty last time (Sift is on, so no "Sift is off") holds no room. */
export function keptHeight(kept: string | null): number | null {
  const value = Number(kept);
  return kept !== null && kept !== '' && Number.isFinite(value) && value >= 0 ? value : null;
}
