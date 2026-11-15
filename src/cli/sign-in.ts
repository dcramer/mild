/**
 * Why a Google account that has just proved who it is may not sign in, or null if it may. The allow
 * list, when the user set one, is checked first and applies to everyone, the first account included.
 */
export function signInRefusal(
  email: string,
  state: { connected: readonly string[]; allowNew: boolean; allowed: readonly string[] | undefined },
): string | null {
  if (state.allowed && !state.allowed.includes(email.toLowerCase())) return `${email} is not on the list of accounts allowed to sign in here.`;
  if (!state.connected.includes(email) && state.connected.length > 0 && !state.allowNew) return `${email} is not the account sift is connected to.`;
  return null;
}
