/**
 * What one request may see and change: the mailboxes of the person signed in, and whether that person
 * owns the install. Every query the dashboard runs takes one, so there is no way to ask for data without
 * saying whose. Made only by `scopeFor` and `narrow`.
 */
export interface Scope {
  /** Account ids. Empty means nothing is visible. */
  readonly accounts: readonly string[];
  /** May change what applies to the whole install: acting, the model, the guidelines. */
  readonly owner: boolean;
}

export const scopeFor = (accounts: readonly string[], owner: boolean): Scope => ({ accounts: [...accounts], owner });

/** The same person looking at one of their mailboxes. Null if `mailbox` is not theirs. */
export function narrow(scope: Scope, mailbox: string): Scope | null {
  return scope.accounts.includes(mailbox) ? { accounts: [mailbox], owner: scope.owner } : null;
}

export const sees = (scope: Scope, accountId: string) => scope.accounts.includes(accountId);

/**
 * SQL that holds for rows of the scope's accounts: `d.account_id IN ('a@example.org', ...)`. Account ids
 * come from the database, never from the request, and are quoted here, so the fragment can be placed in
 * a query as it is. A scope with no accounts matches nothing.
 */
export function within(scope: Scope, column: string): string {
  if (scope.accounts.length === 0) return 'FALSE';
  return `${column} IN (${scope.accounts.map((id) => `'${id.replaceAll("'", "''")}'`).join(', ')})`;
}
