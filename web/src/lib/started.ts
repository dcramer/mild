import { useSyncExternalStore } from 'react';

const nothing = () => () => {};

/**
 * False on the server and while the page takes over what it drew; true from then on. For what only the browser can
 * say (the clipboard, the address's port), or a part that cannot be drawn in HTML under the policy, so the first draw
 * in the browser matches the server's.
 */
export const useStarted = () =>
  useSyncExternalStore(
    nothing,
    () => true,
    () => false,
  );
