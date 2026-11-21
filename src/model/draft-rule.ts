import type { Api, AssistantMessage, Context, Model, Models, Tool, ToolCall } from '@earendil-works/pi-ai';
import {
  BY,
  FACT_WORDS,
  FILL_TOOL,
  FIND_TOOL,
  MAX_LOOKUPS,
  RULE_DRAFT_PROMPT,
  type RuleDrafter,
  buildRuleDraftPrompt,
  describeFound,
  readRuleDraft,
} from '../triage/rule-draft.ts';
import { DECIDED } from '../triage/types.ts';
import type { Usage } from '../triage/stages/model.ts';
import { describeFailure as failure } from '../triage/stages/model.ts';
import { chat, executeTool } from './chat.ts';
import type { Reasoning } from './reasoning.ts';

/** One attempt per turn, as for the judge; the person asks again. */
const CALL = { timeoutMs: 60_000, maxRetries: 0 };

/** Turns that may end without a usable rule: one more after an unusable one, told what is wrong with it, or after an answer in words. */
const MAX_FILLS = 2;

const find: Tool = {
  name: FIND_TOOL,
  description: 'Find senders Mild has recorded mail from, by words in their name, address, mailing list or newest subject.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'A name, brand, domain or a few words.' } },
    required: ['query'],
    additionalProperties: false,
  },
};

function fill(labels: readonly string[]): Tool {
  return {
    name: FILL_TOOL,
    description: 'Fill in the rule.',
    parameters: {
      type: 'object',
      // Written first, as the judge's reason is, so the rest follows from it rather than being worked out after.
      properties: {
        reading: {
          type: 'string',
          description:
            'A sentence: which mail they mean, and whether it gets one of their labels, an action alone, or an action once a model gives it a label.',
        },
        conditions: {
          type: 'array',
          description: 'Which mail. Several of one kind are alternatives; different kinds must all hold.',
          items: {
            type: 'object',
            properties: {
              by: {
                type: 'string',
                enum: [...BY],
                description: '`from` takes an address or a domain. A name (exactly, or containing these words) only beside a `from`.',
              },
              value: { type: 'string' },
            },
            required: ['by', 'value'],
            additionalProperties: false,
          },
        },
        facts: { type: 'array', items: { type: 'string', enum: FACT_WORDS } },
        name: { type: 'string', description: 'A few words, only for a rule with several values or kinds of condition; empty otherwise.' },
        label: { type: 'string', enum: ['', ...labels], description: 'One of their labels, or empty.' },
        onlyOnceLabelled: { type: 'boolean', description: 'Wait for a model to give the mail this label, then do `action` instead of what the label does.' },
        when: { type: 'string', description: 'A condition in the owner’s words, beside a label.' },
        action: { type: 'string', enum: ['', ...DECIDED], description: 'Needed with no label, or when it waits for one; empty beside a label that decides.' },
        markRead: { type: 'boolean' },
        unsubscribe: { type: 'boolean' },
        note: { type: 'string', description: 'What else they need, or what a rule cannot do; empty if nothing.' },
      },
      required: ['reading', 'conditions', 'facts', 'name', 'label', 'onlyOnceLabelled', 'when', 'action', 'markRead', 'unsubscribe', 'note'],
      additionalProperties: false,
    },
    constrainedSampling: { type: 'json_schema', strict: 'prefer' },
  };
}

const add = (a: Usage | undefined, b: Usage): Usage =>
  a ? { model: b.model, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, costUsd: a.costUsd + b.costUsd } : b;

/**
 * A RuleDrafter backed by a pi-ai model: a conversation of a few turns with the person's words and labels,
 * and two tools. One looks up senders in the person's own record and changes nothing; the other records
 * the rule, which is checked here before use and sent back once with what is wrong when it cannot be. The last
 * turn offers only the second.
 */
export function createRuleDrafter(models: Models, model: Model<Api>, reasoning: Reasoning): RuleDrafter {
  return async (input, findSenders) => {
    const record = fill(input.labels.map((l) => l.name));
    const context: Context = {
      systemPrompt: RULE_DRAFT_PROMPT,
      messages: [{ role: 'user', content: buildRuleDraftPrompt(input), timestamp: Date.now() }],
    };
    let usage: Usage | undefined;
    let lookups = 0;
    let fills = 0;
    const spent = () => ({ lookups, ...(usage ? { usage } : {}) });
    for (;;) {
      const last = lookups >= MAX_LOOKUPS;
      let message: AssistantMessage;
      try {
        message = await chat(models, model, { ...context, tools: last ? [record] : [find, record] }, { ...CALL, reasoning });
      } catch (error) {
        return { failed: failure(error), ...spent() };
      }
      usage = add(usage, {
        model: `${model.provider}/${model.id}`,
        inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
        outputTokens: message.usage.output,
        costUsd: message.usage.cost.total,
      });
      if (message.stopReason === 'error' || message.stopReason === 'aborted')
        return { failed: failure(message.errorMessage ?? message.stopReason), ...spent() };
      const calls = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
      const filled = calls.find((c) => c.name === FILL_TOOL);
      let unusable: string | undefined;
      if (filled) {
        const read = await executeTool(FILL_TOOL, filled.id, async (span) => {
          const result = readRuleDraft(filled.arguments, input.labels);
          if ('unusable' in result) span.fail();
          return result;
        });
        if ('draft' in read) return { draft: read.draft, ...spent() };
        unusable = read.unusable;
        fills += 1;
        if (fills >= MAX_FILLS) return { failed: `the model did not fill in a usable rule: ${unusable}`, ...spent() };
      }
      const asked = calls.filter((c) => c.name === FIND_TOOL);
      if (!filled && (last || asked.length === 0)) {
        // It answered in words. Asked once more, since nothing makes a model call a tool.
        fills += 1;
        if (fills >= MAX_FILLS || calls.length > 0) return { failed: 'the model did not fill in a rule', ...spent() };
        context.messages.push(message, { role: 'user', content: `Fill in the rule with ${FILL_TOOL}.`, timestamp: Date.now() });
        continue;
      }
      context.messages.push(message);
      if (filled)
        context.messages.push({
          role: 'toolResult',
          toolCallId: filled.id,
          toolName: FILL_TOOL,
          content: [{ type: 'text', text: `That rule cannot be used: ${unusable}. Fill it in again.` }],
          isError: true,
          timestamp: Date.now(),
        });
      for (const c of asked) {
        lookups += 1;
        const query = typeof c.arguments['query'] === 'string' ? c.arguments['query'] : '';
        const text =
          lookups > MAX_LOOKUPS
            ? 'No more look-ups: fill in the rule.'
            : await executeTool(FIND_TOOL, c.id, async () => describeFound(await findSenders(query)));
        context.messages.push({
          role: 'toolResult',
          toolCallId: c.id,
          toolName: FIND_TOOL,
          content: [{ type: 'text', text }],
          isError: false,
          timestamp: Date.now(),
        });
      }
    }
  };
}
