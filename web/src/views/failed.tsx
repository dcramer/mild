'use client';
import { useEffect } from 'react';
import { forgetFrame } from '@/lib/device.ts';
import { reportError } from '@/lib/telemetry.ts';
import { Button, Splash } from '@/system';

/**
 * In place of the page when drawing it failed. Most often it is an app left open across an update, asking for the old
 * version's files, so the way out is loading the page again, not drawing it again from what it has, nor from the frame
 * this device kept, which may be what failed.
 */
export function Failed({ error }: { error: unknown }) {
  useEffect(() => reportError(error), [error]);
  return (
    <Splash title="Something went wrong.">
      <div>
        <Button variant="mark" size="lg" className="w-full sm:w-auto" onClick={() => void forgetFrame().then(() => window.location.reload())}>
          Reload
        </Button>
      </div>
    </Splash>
  );
}
