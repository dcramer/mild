import { START } from './opens-on.ts';

/**
 * The height each `Reserve` filled the last time, in this browser, and the window's width then, read by a script in the
 * page's head before anything is drawn: what they wait for is fetched by the browser, so the server cannot say.
 */
export const ROOMS = 'sift:rooms';

/**
 * The script. Ids are a part's own (`rule-use`), so only letters and hyphens are taken. `/` is Inbox while it is on, as
 * this browser last knew (`START`), with the rest of the address kept but the installed app's start (`?start=1`), or, not
 * knowing, is left to the page. A `Reserve` holds the height it filled last time while it waits: any width when that was
 * nothing, and otherwise only at the width it was measured at, since text wraps differently at another.
 */
export const BEFORE_PAINT = `try{if(location.pathname==='/'){var t=localStorage.getItem('${START}'),q=new URLSearchParams(location.search),s=q.has('start');q.delete('start');var r=q.toString();if(t==='/inbox')location.replace('/inbox'+(r?'?'+r:''));else if(t==='/'&&s)history.replaceState(history.state,'','/'+(r?'?'+r:''))}}catch(_){}try{var o=JSON.parse(localStorage.getItem('${ROOMS}')||'{}'),c='';for(var i in o){var w=o[i][0],h=o[i][1];if(/^[a-z-]+$/.test(i)&&typeof h==='number'&&(h===0||w===innerWidth))c+='[data-room="'+i+'"][aria-busy="true"]{min-height:'+h+'px}'}if(c){var s=document.createElement('style');s.textContent=c;document.head.appendChild(s)}}catch(_){}`;
