/**
 * Which `Reserve`s held nothing the last time they filled in, in this browser, read by a script in the page's head
 * before anything is drawn: what they wait for is fetched by the browser, so the server cannot say.
 */
export const EMPTY = 'sift:empty';

/** The script. Ids are a part's own (`rule-use`), so only letters and hyphens are taken. */
export const BEFORE_PAINT = `try{var e=(localStorage.getItem('${EMPTY}')||'').split(',').filter(function(i){return /^[a-z-]+$/.test(i)});if(e.length){var s=document.createElement('style');s.textContent=e.map(function(i){return '[data-room="'+i+'"]{min-height:0}'}).join('');document.head.appendChild(s)}}catch(_){}`;
