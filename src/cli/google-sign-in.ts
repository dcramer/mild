import { type Config, loadConfig } from '../config.ts';
import type { SignIn } from '../dashboard/controls.ts';
import { browserSignInUrl, completeBrowserSignIn, hasClientSecrets, loadClientSecrets, saveRefreshToken } from '../gmail/auth.ts';
import { connectAccount, connectedAddresses, userOf } from '../store/accounts.ts';
import type { Store } from '../store/store.ts';
import { signInRefusal } from './sign-in.ts';

/** Google sign-in from the dashboard: the same step connects the Gmail account and signs the viewer in. */
export function buildSignIn(config: Config, store: Store): SignIn {
  // Read each time, so a change to sift.toml applies without a restart.
  const allowed = () => loadConfig().settings.dashboardAllow;
  return {
    client: () => (hasClientSecrets(config) ? loadClientSecrets(config).kind : null),
    url: (redirectUri, state, challenge) => browserSignInUrl(loadClientSecrets(config), { redirectUri, state, challenge }),
    allowed: (email) => signInRefusal(email, { connected: [email], allowNew: false, allowed: allowed() }) === null,
    complete: async (redirectUri, code, verifier, addTo) => {
      const { email, historyId, refreshToken } = await completeBrowserSignIn(loadClientSecrets(config), { redirectUri, code, verifier });
      const connected = await connectedAddresses(store.central);
      const person = addTo === null ? null : await userOf(store.central, addTo);
      const refused = signInRefusal(email, { connected, allowNew: person !== null, allowed: allowed() });
      if (refused) throw new Error(refused);
      saveRefreshToken(config, email, refreshToken);
      // A new account starts from now; a known one keeps its place.
      if (!connected.includes(email)) await connectAccount(store, email, historyId, Date.now(), person?.id);
      return email;
    },
  };
}
