/**
 * A message as its own HTML, on the white paper email is written for. The frame runs nothing and loads
 * nothing from elsewhere (the server sends its document under a policy of its own); links open in a new
 * tab. It cannot measure what it holds, so it scrolls inside: on a wide screen it takes the height left in
 * the flex column it is in (the message panel's), and narrower, where that column scrolls with the panel,
 * it is 70% of the screen. Empty paper until `src` is given and while it loads.
 */
export function MailFrame({ src, title }: { src?: string | undefined; title: string }) {
  return (
    <div className="h-[70vh] min-h-64 bg-(--paper) lg:h-auto lg:min-h-48 lg:flex-1">
      <iframe src={src} title={title} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="block size-full" />
    </div>
  );
}
