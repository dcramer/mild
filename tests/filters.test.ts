import { describe, expect, it } from 'vitest';
import { validateFilter } from '../src/actions/filters.ts';

describe('validateFilter', () => {
  it('accepts a label-and-skip-inbox filter', () => {
    expect(validateFilter({ criteria: { from: 'news@example.com' }, action: { addLabelIds: ['Label_1'], removeLabelIds: ['INBOX'] } })).toEqual([]);
  });

  it('rejects forwarding', () => {
    const problems = validateFilter({ criteria: { from: 'a@example.com' }, action: { addLabelIds: ['Label_1'], forward: 'x@example.net' } });
    expect(problems).toContain('forwarding filters are never allowed');
  });

  it('rejects filters with no positive criteria', () => {
    expect(validateFilter({ criteria: { negatedQuery: 'foo' }, action: { removeLabelIds: ['INBOX'] } })).toHaveLength(1);
    expect(validateFilter({ criteria: { from: '  ' }, action: { removeLabelIds: ['INBOX'] } })).toHaveLength(1);
  });

  it('rejects trash, spam and mark-read actions', () => {
    expect(validateFilter({ criteria: { from: 'a@example.com' }, action: { addLabelIds: ['TRASH'] } })).not.toEqual([]);
    expect(validateFilter({ criteria: { from: 'a@example.com' }, action: { addLabelIds: ['SPAM'] } })).not.toEqual([]);
    expect(validateFilter({ criteria: { from: 'a@example.com' }, action: { removeLabelIds: ['UNREAD'] } })).not.toEqual([]);
  });

  it('rejects more than one user label and empty actions', () => {
    expect(validateFilter({ criteria: { from: 'a@example.com' }, action: { addLabelIds: ['Label_1', 'Label_2'] } })).not.toEqual([]);
    expect(validateFilter({ criteria: { from: 'a@example.com' }, action: {} })).toEqual(['filter has no action']);
  });
});
