/**
 * Why a Google account that has just proved who it is may not sign in, or null if it may. The allow
 * list, when the user set one, is checked first and applies to everyone, the first account included.
 *
 * An account sift does not know may sign in when it is the first, when someone signed in is adding it
 * to their own mailboxes (`allowNew`), or when it is on the allow list: the list is the people this
 * install is for, and each who arrives by themselves is a person of their own, seeing only their mail.
 */
export function signInRefusal(
  email: string,
  state: { connected: readonly string[]; allowNew: boolean; allowed: readonly string[] | undefined },
): string | null {
  if (state.allowed && !state.allowed.includes(email.toLowerCase())) return `${email} is not on the list of accounts allowed to sign in here.`;
  const listed = state.allowed?.includes(email.toLowerCase()) ?? false;
  if (!state.connected.includes(email) && state.connected.length > 0 && !state.allowNew && !listed) return `${email} is not the account Sift is connected to.`;
  return null;
}
