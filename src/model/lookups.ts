import type { Api, AssistantMessage, Context, Model, Models, Tool, ToolCall } from '@earendil-works/pi-ai';
import { FIND_TOOL, type FoundSender, MAX_LOOKUPS, describeFound } from '../triage/rule-draft.ts';
import { describeFailure as failure } from '../triage/stages/model.ts';
import { type Usage } from '../triage/types.ts';
import { chat, executeTool, usageOf } from './chat.ts';
import type { Reasoning } from './reasoning.ts';

/** One attempt per turn; the person asks again. */
const CALL = { timeoutMs: 60_000, maxRetries: 0 };

/** Turns that may end without a usable answer: one more after an unusable one, told what is wrong, or after an answer in words. */
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

interface LookingUp<T> {
  systemPrompt: string;
  prompt: string;
  /** The tool the answer is recorded with. */
  record: Tool;
  /** Reads what the model recorded, given every sender the look-ups returned. */
  read: (args: Record<string, unknown>, found: readonly FoundSender[]) => { answer: T } | { unusable: string };
  findSenders: (query: string) => Promise<FoundSender[]>;
  /** What the model is told, and what the failures say, in the words of what it records. */
  words: {
    unusable: (why: string) => string;
    retry: (why: string) => string;
    noAnswer: string;
    nudge: string;
    noMoreLookups: string;
  };
}

const add = (a: Usage | undefined, b: Usage): Usage =>
  a ? { model: b.model, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, costUsd: a.costUsd + b.costUsd } : b;

/**
 * A conversation of a few turns with two tools: one looks up senders in the person's own record and changes
 * nothing; the other records the answer, which `read` checks and which is sent back once with what is wrong
 * when it cannot be used. The last turn offers only the second.
 */
export async function withLookups<T>(
  models: Models,
  model: Model<Api>,
  reasoning: Reasoning,
  asking: LookingUp<T>,
): Promise<({ answer: T } | { failed: string }) & { usage?: Usage; lookups: number }> {
  const { record, words } = asking;
  const context: Context = {
    systemPrompt: asking.systemPrompt,
    messages: [{ role: 'user', content: asking.prompt, timestamp: Date.now() }],
  };
  const found: FoundSender[] = [];
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
    usage = add(usage, usageOf(model, message));
    if (message.stopReason === 'error' || message.stopReason === 'aborted') return { failed: failure(message.errorMessage ?? message.stopReason), ...spent() };
    const calls = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
    const filled = calls.find((c) => c.name === record.name);
    let unusable: string | undefined;
    if (filled) {
      const read = await executeTool(record.name, filled.id, async (span) => {
        const result = asking.read(filled.arguments, found);
        if ('unusable' in result) span.fail();
        return result;
      });
      if ('answer' in read) return { answer: read.answer, ...spent() };
      unusable = read.unusable;
      fills += 1;
      if (fills >= MAX_FILLS) return { failed: words.unusable(unusable), ...spent() };
    }
    const asked = calls.filter((c) => c.name === FIND_TOOL);
    if (!filled && (last || asked.length === 0)) {
      // It answered in words. Asked once more, since nothing makes a model call a tool.
      fills += 1;
      if (fills >= MAX_FILLS || calls.length > 0) return { failed: words.noAnswer, ...spent() };
      context.messages.push(message, { role: 'user', content: words.nudge, timestamp: Date.now() });
      continue;
    }
    context.messages.push(message);
    if (filled && unusable !== undefined)
      context.messages.push({
        role: 'toolResult',
        toolCallId: filled.id,
        toolName: record.name,
        content: [{ type: 'text', text: words.retry(unusable) }],
        isError: true,
        timestamp: Date.now(),
      });
    for (const c of asked) {
      lookups += 1;
      const query = typeof c.arguments['query'] === 'string' ? c.arguments['query'] : '';
      const text =
        lookups > MAX_LOOKUPS
          ? words.noMoreLookups
          : await executeTool(FIND_TOOL, c.id, async () => {
              const senders = await asking.findSenders(query);
              found.push(...senders);
              return describeFound(senders);
            });
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
}
