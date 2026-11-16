import type { Config } from '../config.ts';
import type { SignIn } from '../dashboard/controls.ts';
import { browserSignInUrl, completeBrowserSignIn, hasClientSecrets, loadClientSecrets } from '../gmail/auth.ts';
import { connectAccount, userOf } from '../store/accounts.ts';
import { credentials } from '../store/credentials.ts';
import type { Store } from '../store/store.ts';

/** Google sign-in from the dashboard: the same step connects the Gmail account and signs the viewer in. */
export function buildSignIn(config: Config, store: Store): SignIn {
  return {
    hasClient: () => hasClientSecrets(config),
    url: (redirectUri, state, challenge) => browserSignInUrl(loadClientSecrets(config), { redirectUri, state, challenge }),
    complete: async (redirectUri, code, verifier, addTo) => {
      const { email, historyId, refreshToken } = await completeBrowserSignIn(loadClientSecrets(config), { redirectUri, code, verifier });
      const known = await userOf(store.central, email);
      const person = addTo === null ? null : await userOf(store.central, addTo);
      // A new account starts from now; a known one keeps its place.
      const owner = known ? known.id : await connectAccount(store, email, historyId, Date.now(), person?.id);
      // Its token goes in its person's own database, which is the only place it is read from.
      await (await credentials(await store.user(owner), 'gmail')).write(email, refreshToken);
      return email;
    },
  };
}
