import { START } from './opens-on.ts';

/**
 * Which `Reserve`s held nothing the last time they filled in, in this browser, read by a script in the page's head
 * before anything is drawn: what they wait for is fetched by the browser, so the server cannot say.
 */
export const EMPTY = 'sift:empty';

/**
 * The script. Ids are a part's own (`rule-use`), so only letters and hyphens are taken. `/` is Inbox while it is on, as
 * this browser last knew (`START`), with the rest of the address kept but the installed app's start (`?start=1`), or, not
 * knowing, is left to the page.
 */
export const BEFORE_PAINT = `try{if(location.pathname==='/'){var t=localStorage.getItem('${START}'),q=new URLSearchParams(location.search),s=q.has('start');q.delete('start');var r=q.toString();if(t==='/inbox')location.replace('/inbox'+(r?'?'+r:''));else if(t==='/'&&s)history.replaceState(history.state,'','/'+(r?'?'+r:''))}}catch(_){}try{var e=(localStorage.getItem('${EMPTY}')||'').split(',').filter(function(i){return /^[a-z-]+$/.test(i)});if(e.length){var s=document.createElement('style');s.textContent=e.map(function(i){return '[data-room="'+i+'"]{min-height:0}'}).join('');document.head.appendChild(s)}}catch(_){}`;
