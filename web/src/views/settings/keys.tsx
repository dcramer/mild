'use client';
import { Button, Kbd, SettingRow, SettingsGroup, Sheet, setShortcutsOn, useShortcutsOn } from '@/system';

/** Kept in this browser, not in sift: it is about how this reader works, not how mail is classified. */
export function Keys() {
  const on = useShortcutsOn();
  return (
    <SettingsGroup title="This browser" note="Kept here, not in Mild.">
      <Sheet>
        <SettingRow
          title="Keyboard shortcuts"
          note={
            <>
              <Kbd>?</Kbd> lists the ones that work where you are.
            </>
          }
        >
          <Button onClick={() => setShortcutsOn(!on)}>{on ? 'Turn off' : 'Turn on'}</Button>
        </SettingRow>
      </Sheet>
    </SettingsGroup>
  );
}
