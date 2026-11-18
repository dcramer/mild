type Style = Partial<Record<'background' | 'bottom' | 'height' | 'left' | 'minHeight' | 'right' | 'width', string>>;

/**
 * A value a part computes from data (a bar's height, a series' colour), set on its element from script: give it as the
 * element's `ref`. Never a `style` attribute, which the page's policy (`style-src 'self'`) refuses in the HTML the
 * server sends. Name every property each time, `''` for none, so a value set by an earlier render does not linger.
 */
export const styled = (style: Style) => (element: HTMLElement | null) => {
  if (element) Object.assign(element.style, style);
};
