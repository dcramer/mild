'use client';
import { api } from '@/lib/api.ts';
import { useAction } from '@/lib/action.ts';
import { ConfirmButton, Failure } from '@/system';

/** Turning Inbox on, from Settings or from the Inbox screen while it is off: it asks first, since Sift then keeps a copy of all inbox mail. */
export function TurnInboxOn({ label }: { label: string }) {
  const { busy, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-2">
      <ConfirmButton variant="plain" question="Keep a copy of all your inbox mail in Sift?" busy={busy} onConfirm={() => run(() => api.setMail(true))}>
        {label}
      </ConfirmButton>
      <Failure>{error}</Failure>
    </div>
  );
}
