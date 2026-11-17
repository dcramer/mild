/** What a message's HTML shows about how it was sent. Derived from the markup alone: no address in it is ever fetched. */
export interface HtmlFacts {
  /** A remote image drawn at 1×1 or hidden: it is there to report that the mail was opened. */
  trackingPixel: boolean;
  /** Distinct hosts the links go to. */
  linkHosts: number;
  /** Most links pass through a click-tracking redirect instead of going where they say. */
  trackedLinks: boolean;
  /** There are links, and none goes to the sender's own domain. */
  linksOffDomain: boolean;
}

/** Hosts that only exist to count a click and redirect. */
const TRACKER_DOMAINS =
  /(^|\.)(list-manage\.com|sendgrid\.net|mandrillapp\.com|hubspotlinks\.com|klclick\d*\.com|rs6\.net|awstrack\.me|mjt\.lu|pstmrk\.it|cmail\d+\.com|createsend\d*\.com|spgo\.io|exct\.net|sendibt\d*\.com|intercom-clicks\.com|customeriomail\.com)$/;
/** The first label of a tracking host on a sender's or service's own domain: `click.example.com`, `url1234.example.com`. */
const TRACKER_LABEL = /^(clicks?|links?|track(ing)?|trk|email|ablink|url\d+)\./;

const attribute = (tag: string, name: string): string | null => {
  const found = new RegExp(`[\\s"']${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return found ? (found[1] ?? found[2] ?? found[3] ?? '') : null;
};

const tiny = (value: string | null) => value !== null && /^[01](px)?$/i.test(value.trim());
const styled = (style: string, property: string, value: string) => new RegExp(`(?<![-\\w])${property}\\s*:\\s*${value}\\s*(?:[;!]|$)`, 'i').test(style);

function isPixel(tag: string): boolean {
  if (!/^(https?:)?\/\//i.test(attribute(tag, 'src')?.trim() ?? '')) return false;
  const style = attribute(tag, 'style') ?? '';
  const oneByOne =
    (tiny(attribute(tag, 'width')) && tiny(attribute(tag, 'height'))) || (styled(style, 'width', '[01](px)?') && styled(style, 'height', '[01](px)?'));
  return oneByOne || styled(style, 'display', 'none') || styled(style, 'visibility', 'hidden');
}

/**
 * The part of a host that names who runs it, near enough: the last two labels, or three under a
 * two-letter country code with a short second level (`example.co.uk`). Not the public suffix list.
 */
export function site(host: string): string {
  const labels = host.split('.');
  const country = labels.length >= 3 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3;
  return labels.slice(country ? -3 : -2).join('.');
}

/** A long run with no words in it: an encoded destination or recipient id, not a page's name. */
function opaque(url: URL): boolean {
  return `${url.pathname}${url.search}`
    .split(/[/?&]/)
    .some((part) => /^[\w=.%~-]{24,}$/.test(part) && /\d/.test(part) && /[a-z]/i.test(part) && (!part.includes('-') || /[A-Z]/.test(part)));
}

export function htmlFacts(html: string, senderDomain: string): HtmlFacts {
  const sender = senderDomain.toLowerCase();
  const links: URL[] = [];
  for (const [tag] of html.matchAll(/<a\s[^>]*>/gi)) {
    const href = attribute(tag, 'href')?.trim().replace(/&amp;/gi, '&') ?? '';
    if (/^https?:\/\//i.test(href) && URL.canParse(href)) links.push(new URL(href));
  }
  const hosts = new Set(links.map((l) => l.hostname.toLowerCase()));
  const viaTracker = links.filter((l) => {
    const host = l.hostname.toLowerCase();
    return host !== sender && (TRACKER_DOMAINS.test(host) || TRACKER_LABEL.test(host));
  }).length;
  // The sender's own links can carry long ids (a notification's reference) without going through anything.
  const oneOpaqueHost = links.length >= 3 && hosts.size === 1 && !hosts.has(sender) && links.every(opaque);

  return {
    trackingPixel: [...html.matchAll(/<img\s[^>]*>/gi)].some(([tag]) => isPixel(tag)),
    linkHosts: hosts.size,
    trackedLinks: links.length > 0 && (viaTracker * 2 >= links.length || oneOpaqueHost),
    linksOffDomain: links.length > 0 && ![...hosts].some((host) => site(host) === site(sender)),
  };
}
