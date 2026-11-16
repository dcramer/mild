import type { Config } from '../config.ts';
import type { SignIn } from '../dashboard/controls.ts';
import { browserSignInUrl, completeBrowserSignIn, hasClientSecrets, loadClientSecrets } from '../gmail/auth.ts';
import { connectAccount, connectedAddresses, userOf } from '../store/accounts.ts';
import { credentials } from '../store/credentials.ts';
import type { Store } from '../store/store.ts';
import { signInRefusal } from './sign-in.ts';

/** Google sign-in from the dashboard: the same step connects the Gmail account and signs the viewer in. */
export function buildSignIn(config: Config, store: Store): SignIn {
  const allowed = () => config.settings.dashboardAllow;
  return {
    hasClient: () => hasClientSecrets(config),
    url: (redirectUri, state, challenge) => browserSignInUrl(loadClientSecrets(config), { redirectUri, state, challenge }),
    allowed: (email) => signInRefusal(email, { connected: [email], allowNew: false, allowed: allowed() }) === null,
    complete: async (redirectUri, code, verifier, addTo) => {
      const { email, historyId, refreshToken } = await completeBrowserSignIn(loadClientSecrets(config), { redirectUri, code, verifier });
      const connected = await connectedAddresses(store.central);
      const person = addTo === null ? null : await userOf(store.central, addTo);
      const refused = signInRefusal(email, { connected, allowNew: person !== null, allowed: allowed() });
      if (refused) throw new Error(refused);
      // A new account starts from now; a known one keeps its place.
      const owner = connected.includes(email)
        ? (await userOf(store.central, email))!.id
        : await connectAccount(store, email, historyId, Date.now(), person?.id);
      // Its token goes in its person's own database, which is the only place it is read from.
      await (await credentials(await store.user(owner), 'gmail')).write(email, refreshToken);
      return email;
    },
  };
}
