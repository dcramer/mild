import type { LabelProposal } from '@/lib/api.ts';
import { ACTIONS, INBOX_NAME } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { Button, Check, Does, OnPhone, RowActions, Sub, Table, Td, Th, Tr } from '@/system';
import type { LabelDraft } from '@/views/label-panel.tsx';

/** A label the model suggested, as the person is shaping it: kept unless unticked. */
export type Suggestion = LabelDraft & { on: boolean };

export const suggestionOf = (d: LabelProposal['drafts'][number]): Suggestion => ({
  name: d.name,
  description: d.description,
  disposition: d.disposition,
  markRead: d.markRead ?? false,
  unsubscribe: d.unsubscribe ?? false,
  on: true,
});

/** The ones kept, as the routes that make labels take them. */
export const keptLabels = (suggestions: readonly Suggestion[]) =>
  suggestions
    .filter((s) => s.on)
    .map((s) => ({
      name: s.name.trim(),
      description: s.description.trim(),
      disposition: s.disposition,
      ...(s.markRead ? { markRead: true } : {}),
      ...(s.unsubscribe ? { unsubscribe: true } : {}),
    }));

/** What the model suggested always stays in the inbox, as the person is shaping it: kept unless unticked. */
export interface InboxSuggestion {
  words: string;
  on: boolean;
}

/** Use these labels, Add this label: the press that makes the ones kept, by how many. */
export const keepWord = (verb: 'Use' | 'Add', kept: number) =>
  kept === 1 ? `${verb} this label` : kept === 0 ? `${verb} these labels` : `${verb} these ${kept} labels`;

const word = (key: string) => ACTIONS.find(([k]) => k === key)?.[1] ?? key;

/**
 * What the model suggested, each ticked to keep: its name, what it is and what Sift will do with it, and Edit.
 * What always stays in the inbox, when it suggested some, comes first, where Leave in inbox is in every list.
 * On a phone, what Sift does and Edit share the line under the description, which keeps the width.
 */
export function SuggestionList({
  suggestions,
  onChange,
  onEdit,
  inbox,
}: {
  suggestions: readonly Suggestion[];
  onChange: (index: number, change: Partial<Suggestion>) => void;
  onEdit: (index: number) => void;
  inbox?: InboxSuggestion & { onChange: (change: Partial<InboxSuggestion>) => void; onEdit: () => void };
}) {
  return (
    <Table>
      <thead className="sr-only">
        <Tr>
          <Th>Label</Th>
          <Th>Then</Th>
          <Th>Edit</Th>
        </Tr>
      </thead>
      <tbody>
        {inbox && inbox.words.trim() !== '' ? (
          <Tr>
            <Td>
              <span className="flex items-start gap-3">
                <span className="flex h-6 items-center">
                  <Check checked={inbox.on} onChange={(on) => inbox.onChange({ on })}>
                    <span className="sr-only">Use {INBOX_NAME}</span>
                  </Check>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn(!inbox.on && 'opacity-45')}>
                    <span className="name">{INBOX_NAME}</span>
                    <Sub className="whitespace-normal">Always: {inbox.words}</Sub>
                  </span>
                  <OnPhone>
                    <Button variant="quiet" className="ml-auto" aria-label={`Edit ${INBOX_NAME}`} onClick={inbox.onEdit}>
                      Edit
                    </Button>
                  </OnPhone>
                </span>
              </span>
            </Td>
            <Td phone="hide" />
            <RowActions>
              <Button variant="quiet" aria-label={`Edit ${INBOX_NAME}`} onClick={inbox.onEdit}>
                Edit
              </Button>
            </RowActions>
          </Tr>
        ) : null}
        {suggestions.map((s, i) => (
          <Tr key={i}>
            <Td>
              <span className="flex items-start gap-3">
                <span className="flex h-6 items-center">
                  <Check checked={s.on} onChange={(on) => onChange(i, { on })}>
                    <span className="sr-only">Use {s.name}</span>
                  </Check>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn(!s.on && 'opacity-45')}>
                    <span className="name">{s.name}</span>
                    <Sub className="whitespace-normal">{s.description}</Sub>
                  </span>
                  <OnPhone>
                    <span className={cn(!s.on && 'opacity-45')}>
                      <Does action={s.disposition}>{word(s.disposition)}</Does>
                    </span>
                    <Button variant="quiet" className="ml-auto" aria-label={`Edit ${s.name}`} onClick={() => onEdit(i)}>
                      Edit
                    </Button>
                  </OnPhone>
                </span>
              </span>
            </Td>
            <Td phone="hide" className={cn('w-px whitespace-nowrap', !s.on && 'opacity-45')}>
              <Does action={s.disposition}>{word(s.disposition)}</Does>
            </Td>
            <RowActions>
              <Button variant="quiet" aria-label={`Edit ${s.name}`} onClick={() => onEdit(i)}>
                Edit
              </Button>
            </RowActions>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
