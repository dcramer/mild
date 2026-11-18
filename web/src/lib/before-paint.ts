/**
 * What this browser keeps about how to draw the page, read by a script in the page's head before anything is drawn,
 * since the server draws the same page for everyone: which `Reserve`s held nothing last time (Sift is on, so there is
 * no "Sift is off"), and whether someone was signed in here last time. Until then the dashboard's frame is hidden and
 * asks the API for nothing, so a sign-in screen is not drawn over it and a dead session is not used.
 */
export const EMPTY = 'sift:empty';
const SIGNED_IN = 'sift:signed-in';

/** The script. Ids are a part's own (`home-off`), so only letters and hyphens are taken. */
export const BEFORE_PAINT = `try{var e=(localStorage.getItem('${EMPTY}')||'').split(',').filter(function(i){return /^[a-z-]+$/.test(i)});if(e.length){var s=document.createElement('style');s.textContent=e.map(function(i){return '[data-room="'+i+'"]{min-height:0}'}).join('');document.head.appendChild(s)}if(!localStorage.getItem('${SIGNED_IN}'))document.documentElement.classList.add('signed-out')}catch(_){}`;

const kept = (work: () => void) => {
  try {
    work();
  } catch {
    // Without storage, every visit waits for Sift to say who is signed in before it draws the dashboard.
  }
};

/** Whether someone was signed in here last time. */
export const signedInBefore = () => {
  let found = false;
  kept(() => (found = window.localStorage.getItem(SIGNED_IN) !== null));
  return found;
};

/** What Sift said: signed in or not. */
export const keepSignedIn = (signedIn: boolean) => {
  kept(() => (signedIn ? window.localStorage.setItem(SIGNED_IN, '1') : window.localStorage.removeItem(SIGNED_IN)));
  document.documentElement.classList.toggle('signed-out', !signedIn);
};

/** Signed out: the page starts again at `to` as nobody's. */
export const leave = (to: string) => {
  keepSignedIn(false);
  window.location.assign(to);
};
