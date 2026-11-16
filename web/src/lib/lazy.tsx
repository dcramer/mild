import { type ComponentType, use } from 'react';

/**
 * A screen whose code is fetched when it is first needed, not with the page. Unlike `React.lazy`, once
 * the code is here it renders at once, with no pass through a loading state, so going to a screen that
 * was fetched ahead of time never flashes. `preload` fetches it ahead of time; it is safe to call twice.
 */
export function lazyView<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> & { preload: () => Promise<unknown> } {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        // A failed fetch (offline, a build replaced under an open page) is tried again the next time the screen is asked for.
        pending = null;
        throw error;
      },
    ));
  function View(props: P) {
    const Component = loaded ?? use(preload());
    return <Component {...props} />;
  }
  return Object.assign(View, { preload });
}
