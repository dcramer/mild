import { WhoLoading, WhoView } from '@/views/sender/index.tsx';

/** `/domain/<domain>`, rewritten here (next.config.js): one page for all of them, which holds none of their addresses. */
export default function Domain() {
  return <WhoView kind="domain" shell={<WhoLoading />} />;
}
