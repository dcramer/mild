import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { proposeLabels } from '../src/learn/labels.ts';
import { createProposer } from '../src/model/propose.ts';
import { loadKeyring } from '../src/secrets.ts';
import { connectAccount } from '../src/store/accounts.ts';
import { latestLabelProposal } from '../src/store/labels.ts';
import { MAX_DRAFTS, PROPOSAL_TOOL, type Proposer, buildProposalPrompt, readProposal } from '../src/triage/proposal.ts';
import { freshStore, raw } from './fixtures.ts';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('../src/telemetry.ts', async (actual) => ({ ...(await actual<object>()), reportError }));

const ACCOUNT = 'me@example.com';
const PITCHES = { why: 'fewer pitches', name: 'Cold outreach', description: 'Pitches from strangers.', action: 'archive', markRead: false, unsubscribe: true };

describe('what the model suggests', () => {
  const readDrafts = (args: unknown, labels: { name: string; description: string }[]) => readProposal(args, labels)?.drafts ?? null;

  it('keeps the usable drafts, tidied, and drops the rest', () => {
    expect(
      readDrafts(
        {
          labels: [
            { ...PITCHES, name: '  Cold\n outreach ' },
            { ...PITCHES, action: 'block' },
            { ...PITCHES, name: '' },
            { ...PITCHES, name: 'Scams', action: 'spam', markRead: true, unsubscribe: false },
            { ...PITCHES, name: 'Builds', action: 'digest', markRead: true, unsubscribe: false },
          ],
        },
        [],
      ),
    ).toEqual([
      { name: 'Cold outreach', description: 'Pitches from strangers.', disposition: 'archive', unsubscribe: true, why: 'fewer pitches' },
      { name: 'Scams', description: 'Pitches from strangers.', disposition: 'spam', why: 'fewer pitches' },
      { name: 'Builds', description: 'Pitches from strangers.', disposition: 'digest', markRead: true, why: 'fewer pitches' },
    ]);
    expect(readDrafts({ labels: Array.from({ length: 20 }, (_, i) => ({ ...PITCHES, name: `L${i}` })) }, [])).toHaveLength(MAX_DRAFTS);
    expect(readDrafts({ labels: [] }, [])).toBeNull();
    expect(readDrafts(undefined, [])).toBeNull();
  });

  it('drops a draft named like a label they have or an earlier draft, since one repeat refuses the whole batch', () => {
    const drafts = readDrafts(
      { labels: [PITCHES, { ...PITCHES, name: 'RECEIPTS' }, { ...PITCHES, name: 'cold outreach' }, { ...PITCHES, name: 'Scams', action: 'spam' }] },
      [{ name: 'Receipts', description: 'What I bought.' }],
    );
    expect(drafts?.map((d) => d.name)).toEqual(['Cold outreach', 'Scams']);
    // Nor may one take the name of Leave in inbox, which is not among their labels.
    expect(readDrafts({ labels: [{ ...PITCHES, name: 'Leave in Inbox' }] }, [])).toBeNull();
  });

  it('may suggest no labels when it says why, as when one they have covers it already', () => {
    const covered = { labels: [], note: ' Your Receipts\nlabel covers these already. ' };
    expect(readProposal(covered, [])).toEqual({ drafts: [], note: 'Your Receipts label covers these already.' });
    expect(readProposal({ labels: [PITCHES], note: '' }, [])).toEqual({ drafts: [expect.objectContaining({ name: 'Cold outreach' })] });
    expect(readProposal({ labels: [{ ...PITCHES, name: 'Receipts' }], note: '' }, [{ name: 'Receipts', description: 'd' }])).toBeNull();
  });

  it('is asked with the person’s words and the labels they have, and nothing from their mail', () => {
    const prompt = buildProposalPrompt({ goal: 'Fewer sales pitches.', labels: [{ name: 'Receipts', description: 'What I bought.' }] });
    expect(prompt).toContain('Fewer sales pitches.');
    expect(prompt).toContain('- Receipts: What I bought.');
  });

  it('comes from one call with no tool but the one that records it', async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const complete = vi.spyOn(models, 'complete');
    const propose = createProposer(models, faux.getModel());
    faux.setResponses([fauxAssistantMessage([fauxToolCall(PROPOSAL_TOOL, { labels: [PITCHES] })], { stopReason: 'toolUse' })]);
    expect(await propose({ goal: 'Fewer pitches', labels: [] })).toMatchObject({
      drafts: [{ name: 'Cold outreach', disposition: 'archive', unsubscribe: true }],
      usage: { model: expect.stringContaining('/') },
    });
    expect(complete.mock.calls[0]?.[1].tools?.map((t) => t.name)).toEqual([PROPOSAL_TOOL]);

    faux.setResponses([fauxAssistantMessage([fauxText('Try a Marketing label.')])]);
    expect(await propose({ goal: 'Fewer pitches', labels: [] })).toMatchObject({ failed: 'the model did not suggest any usable labels' });
  });
});

describe('asking for labels', () => {
  async function person() {
    const store = await freshStore(loadKeyring({ SIFT_KEY: 'proposal-key' }));
    return await store.user(await connectAccount(store, ACCOUNT, '1', 0));
  }
  const usage = { model: 'p/m', inputTokens: 10, outputTokens: 20, costUsd: 0.01 };

  it('records the call with what it cost, its words encrypted, and keeps the latest suggestions', async () => {
    const db = await person();
    const asked: unknown[] = [];
    const propose: Proposer = async (input) => (
      asked.push(input),
      { drafts: [{ name: 'Cold outreach', description: 'Pitches.', disposition: 'archive', why: 'w' }], usage }
    );
    const proposal = await proposeLabels({ db, propose, model: 'p/m', now: () => 5 }, { accountId: ACCOUNT, goal: 'Stop pitches from Acme' });
    // Leave in inbox is the prompt's to explain, not one of the person's labels.
    expect(asked).toEqual([{ goal: 'Stop pitches from Acme', labels: [] }]);
    expect(await latestLabelProposal(db, [ACCOUNT])).toEqual(proposal);
    const row = await raw(db).get('SELECT * FROM label_proposals');
    expect(row).toMatchObject({ model: 'p/m', started_at: 5, finished_at: 5, input_tokens: 10, output_tokens: 20, cost_usd: 0.01, error: null });
    expect(JSON.stringify(row)).not.toContain('Acme');
    expect(JSON.stringify(row)).not.toContain('Cold outreach');
  });

  it('records what it says its labels leave out, encrypted, and keeps it with them', async () => {
    const db = await person();
    const propose: Proposer = async () => ({ drafts: [], note: 'Your Receipts label covers Acme already.', usage });
    const proposal = await proposeLabels({ db, propose, model: 'p/m' }, { accountId: ACCOUNT, goal: 'Receipts from Acme' });
    expect(proposal).toMatchObject({ drafts: [], note: 'Your Receipts label covers Acme already.' });
    expect(await latestLabelProposal(db, [ACCOUNT])).toEqual(proposal);
    expect(JSON.stringify(await raw(db).get('SELECT note FROM label_proposals'))).not.toContain('Acme');
  });

  it('records and reports a failed call, refuses with what went wrong, and keeps the last suggestions that came', async () => {
    const db = await person();
    const good: Proposer = async () => ({ drafts: [{ name: 'Scams', description: 'Deceit.', disposition: 'spam', why: 'w' }] });
    const first = await proposeLabels({ db, propose: good, model: 'p/m' }, { accountId: ACCOUNT, goal: 'No scams' });
    const failing: Proposer = async () => ({ failed: 'rate limited', usage });
    await expect(proposeLabels({ db, propose: failing, model: 'p/m' }, { accountId: ACCOUNT, goal: 'Again' })).rejects.toThrow('rate limited');
    expect(reportError).toHaveBeenCalledWith(new Error('Label suggestion failed: rate limited'));
    expect(await raw(db).all('SELECT error, cost_usd FROM label_proposals ORDER BY id')).toEqual([
      { error: null, cost_usd: 0 },
      { error: 'rate limited', cost_usd: 0.01 },
    ]);
    expect(await latestLabelProposal(db, [ACCOUNT])).toEqual(first);
  });
});
