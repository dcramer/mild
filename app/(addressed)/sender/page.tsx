import { WhoLoading, WhoView } from '@/views/sender/index.tsx';

/** `/sender/<address>`, rewritten here (next.config.js): one page for all of them, which holds none of their addresses. */
export default function Sender() {
  return <WhoView kind="sender" shell={<WhoLoading />} />;
}
