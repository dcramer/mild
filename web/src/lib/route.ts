import { useEffect, useState } from 'react';

const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

/** Where the viewer is, from the address fragment (`#settings/accounts`), so a view can be linked to and the back button works. */
export function useRoute(): string[] {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
