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
): { labelName: string | null; disposition: string; usually: boolean } {
  if (rule !== null && rule.kind !== 'when-label') return { labelName: rule.labelName, disposition: rule.disposition ?? 'keep', usually: false };
  const sifts = page.decisions.filter((d) => !d.byUser);
  const [most] = page.profile.labels;
  const usual =
    page.profile.labels.length > 1 && most ? (sifts.find((d) => d.labelId === most.id) ?? page.decisions.find((d) => d.labelId === most.id)) : undefined;
  if (usual) return { labelName: usual.labelName, disposition: usual.disposition, usually: true };
  const [last] = sifts;
  return last ? { labelName: last.labelName, disposition: last.disposition, usually: false } : { labelName: null, disposition: 'review', usually: false };
}
