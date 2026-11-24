/** Whose page it is: one address, or everyone at a domain. */
export type Who = { address: string } | { domain: string };

/** The address or the domain, as the page's own address has it. */
export const keyOf = (who: Who) => ('address' in who ? who.address : who.domain);
