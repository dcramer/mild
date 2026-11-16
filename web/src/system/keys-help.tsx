import { useState } from 'react';
import { Dialog } from './dialog.tsx';
import { liveShortcuts, useShortcut } from './keys.tsx';
import { Kbd } from './type.tsx';

/**
 * The list of every key that works where the reader is, opened with `?`. Mounted once by the app. It
 * reads the keys the page has bound, so it cannot list one that does nothing.
 */
export function ShortcutList() {
  const [keys, setKeys] = useState<{ key: string; label: string }[] | null>(null);
  // The list is taken before the dialog opens: once it is open, the dialog is the top layer and the page's keys are not live.
  void useShortcut('?', 'Show every key', () => setKeys((open) => (open ? null : liveShortcuts())), { everywhere: true });
  return (
    <Dialog open={keys !== null} onClose={() => setKeys(null)} title="Keys" subtitle="Where you are now. Turn them off in Settings.">
      <ul className="flex flex-col">
        {(keys ?? []).map((entry) => (
          <li key={`${entry.key} ${entry.label}`} className="row flex items-center gap-4 py-2">
            <span className="flex w-12 justify-end">
              <Kbd>{entry.key}</Kbd>
            </span>
            {entry.label}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
