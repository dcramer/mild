import { Blank, Loading, PageHeader } from '@/system';
import { WhoView } from '@/views/sender.tsx';

/** `/domain/<domain>`, rewritten here (next.config.js): one page for all of them, which holds none of their addresses. */
export default function Domain() {
  return (
    <WhoView
      kind="domain"
      shell={
        <div className="flex flex-col gap-10">
          <PageHeader title={<Blank className="w-2/5" />} meta={null} />
          <Loading />
        </div>
      }
    />
  );
}
