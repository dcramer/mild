import { type ReactNode, createContext, useContext, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { Kbd } from './type.tsx';

/**
 * Keyboard shortcuts. A control asks for its key with `useShortcut`, which binds the key and hands back
 * the hint to draw beside the control, so a key that works is always shown and a key that is shown
 * always works. Keys do nothing while the reader is typing, and only the topmost layer's keys are live:
 * with a panel or a dialog open, the page under it is deaf. The reader can turn all of it off, which is
 * remembered in this browser.
 */

interface Binding {
  key: string;
  label: string;
  layer: number;
  run: () => void;
  /** With several bindings for one key, the one whose element holds the focus wins. */
  within?: () => Element | null;
}

const bindings = new Map<string, Binding>();
const layers: number[] = [];
let nextLayer = 1;
const top = () => layers.at(-1) ?? 0;
/** The layer of a key that works whatever is open. */
const EVERYWHERE = -1;

const STORE = 'sift:keys';
const listeners = new Set<() => void>();
function stored(): boolean {
  try {
    return window.localStorage.getItem(STORE) !== 'off';
  } catch {
    return true;
  }
}
let on = typeof window === 'undefined' ? true : stored();

/** Turn shortcuts and their hints on or off, for this browser. */
export function setShortcutsOn(next: boolean): void {
  on = next;
  try {
    window.localStorage.setItem(STORE, next ? 'on' : 'off');
  } catch {
    // Not remembered; still applies until the page is closed.
  }
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useShortcutsOn = () => useSyncExternalStore(subscribe, () => on);

// A screen worked by finger has no keyboard to speak of: the keys still work if one is attached, and no hint is drawn.
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Whether key hints are drawn: shortcuts are on, and this is not a touch screen. For a hint on a key the browser handles itself, such as Escape. */
export const useHintsShown = () => useShortcutsOn() && !TOUCH;

const NAMES: Record<string, string> = { Enter: '↵', Escape: 'esc', ArrowUp: '↑', ArrowDown: '↓', ' ': 'space' };
/** A key as it is drawn: letters in capitals, the named keys by their sign. */
export const keyName = (key: string) => NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="listbox"], [role="menu"]') !== null);

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (!on || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    // Enter on something focused already presses it; a shortcut on Enter must not press a second thing.
    if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('button, a, [tabindex="0"]')) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const live = [...bindings.values()].filter((b) => (b.layer === top() || b.layer === EVERYWHERE) && b.key === key);
    const match = live.find((b) => b.within?.()?.contains(document.activeElement)) ?? live[0];
    if (!match) return;
    event.preventDefault();
    match.run();
  });
}

const Layer = createContext({ layer: 0, moves: false });
/** Whether the row a control sits in is the one the reader is on. Outside a table, always. */
export const RowActive = createContext(true);

/**
 * What floats over the page (a panel, a dialog) wraps its content in a layer: while it is open only its
 * own keys are live. `moves` says the layer uses J and K itself, so a table inside it leaves them alone.
 */
export function KeyLayer({ moves = false, children }: { moves?: boolean; children: ReactNode }) {
  const layer = useRef(0);
  if (layer.current === 0) layer.current = nextLayer++;
  useEffect(() => {
    const id = layer.current;
    layers.push(id);
    return () => void layers.splice(layers.indexOf(id), 1);
  }, []);
  return <Layer value={{ layer: layer.current, moves }}>{children}</Layer>;
}

/** Whether the layer this is in keeps J and K for itself. */
export const useLayerMoves = () => useContext(Layer).moves;

/**
 * Bind `key` to `run` for as long as the caller is on the page, and get back the hint to draw beside
 * the control (nothing when shortcuts are off or the screen is a touch screen). `label` says what the
 * key does in the list of all keys. No `key`, or `enabled` false, binds and draws nothing. `everywhere`
 * is for the one key that must work whatever is open.
 */
export function useShortcut(
  key: string | undefined,
  label: string,
  run: () => void,
  options: { enabled?: boolean; within?: () => Element | null; tone?: 'ink'; everywhere?: boolean } = {},
): ReactNode {
  const id = useId();
  const here = useContext(Layer).layer;
  const layer = options.everywhere ? EVERYWHERE : here;
  const active = useContext(RowActive) && options.enabled !== false && key !== undefined;
  const shortcuts = useShortcutsOn();
  const latest = useRef({ run, within: options.within });
  latest.current = { run, within: options.within };
  useEffect(() => {
    if (!active || key === undefined) return;
    bindings.set(id, { key, label, layer, run: () => latest.current.run(), within: () => latest.current.within?.() ?? null });
    return () => void bindings.delete(id);
  }, [active, id, key, label, layer]);
  if (!active || key === undefined || !shortcuts || TOUCH) return null;
  return (
    <Kbd className="hidden md:inline-flex" {...(options.tone ? { tone: options.tone } : {})}>
      {keyName(key)}
    </Kbd>
  );
}

/** Every key that is live right now, for the list the reader opens with `?`. One line per key and meaning. */
export function liveShortcuts(): { key: string; label: string }[] {
  const seen = new Set<string>();
  return [...bindings.values()]
    .filter((b) => b.layer === top() || b.layer === EVERYWHERE)
    .filter((b) => !seen.has(`${b.key}\n${b.label}`) && seen.add(`${b.key}\n${b.label}`))
    .map((b) => ({ key: keyName(b.key), label: b.label }));
}
