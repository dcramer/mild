import type { SenderPage } from './api.ts';

type Rule = SenderPage['profile']['rules'][number];

/**
 * What a sender's page says about their next message. A rule for all their mail says it; otherwise Sift's
 * own decisions do. Their latest is no guide when their mail is of several kinds (the decision list is in the
 * order Sift decided, not the order mail came), so then it is what most of it is, `usually`.
 */
export function nextMail(
  page: Pick<SenderPage, 'decisions' | 'profile'>,
  rule: Rule | null,
  /** The labels mail can be given now, undefined until they are known. */
  labels: readonly { id: string }[] | undefined,
): { labelName: string | null; disposition: string; usually: boolean } {
  if (rule !== null && rule.kind !== 'when-label') return { labelName: rule.labelName, disposition: rule.disposition ?? 'keep', usually: false };
  // A removed label is in their history, but no mail is given it again.
  const given = (id: string | null) => id === null || !labels || labels.some((l) => l.id === id);
  const decisions = page.decisions.filter((d) => given(d.labelId));
  const kinds = page.profile.labels.filter((l) => given(l.id));
  const sifts = decisions.filter((d) => !d.byUser);
  const [most] = kinds;
  const usual = kinds.length > 1 && most ? (sifts.find((d) => d.labelId === most.id) ?? decisions.find((d) => d.labelId === most.id)) : undefined;
  if (usual) return { labelName: usual.labelName, disposition: usual.disposition, usually: true };
  const [last] = sifts;
  return last ? { labelName: last.labelName, disposition: last.disposition, usually: false } : { labelName: null, disposition: 'review', usually: false };
}
