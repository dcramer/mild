import type { Api, AssistantMessage, Context, Model, Models, Tool } from '@earendil-works/pi-ai';
import { HIGHLIGHT_PROMPT, HIGHLIGHT_TOOL, type Highlighter, MAX_HIGHLIGHTS, buildHighlightPrompt, readHighlights } from '../triage/digest.ts';
import { describeFailure as failure } from '../triage/stages/model.ts';
import { chat, executeTool, usageOf } from './chat.ts';
import type { Reasoning } from './reasoning.ts';

/** One attempt, as for the judge: a digest that fails goes without highlights rather than wait. */
const CALL = { timeoutMs: 60_000, maxRetries: 0 };

/**
 * A Highlighter backed by a pi-ai model: one request with a day's headers, no bodies, and no tool but the one
 * that records its picks, which are checked here before use.
 */
export function createHighlighter(models: Models, model: Model<Api>, reasoning: Reasoning): Highlighter {
  return async (input) => {
    const tool: Tool = {
      name: HIGHLIGHT_TOOL,
      description: 'Record which emails are worth a look.',
      parameters: {
        type: 'object',
        properties: {
          picks: {
            type: 'array',
            maxItems: MAX_HIGHLIGHTS,
            items: {
              type: 'object',
              properties: {
                why: { type: 'string', description: 'Why it stands out, in a few plain words.' },
                item: { type: 'integer', minimum: 1, maximum: input.lines.length },
              },
              required: ['why', 'item'],
              additionalProperties: false,
            },
          },
        },
        required: ['picks'],
        additionalProperties: false,
      },
      constrainedSampling: { type: 'json_schema', strict: 'prefer' },
    };
    const context: Context = {
      systemPrompt: HIGHLIGHT_PROMPT,
      messages: [{ role: 'user', content: buildHighlightPrompt(input), timestamp: Date.now() }],
      tools: [tool],
    };

    let message: AssistantMessage;
    try {
      // Shown mail, so its prompt and answer stay off the span.
      message = await chat(models, model, context, { ...CALL, reasoning });
    } catch (error) {
      return { failed: failure(error) };
    }
    const usage = usageOf(model, message);
    if (message.stopReason === 'error' || message.stopReason === 'aborted') return { failed: failure(message.errorMessage ?? message.stopReason), usage };
    const call = message.content.find((block) => block.type === 'toolCall' && block.name === HIGHLIGHT_TOOL);
    return await executeTool(HIGHLIGHT_TOOL, call?.type === 'toolCall' ? call.id : undefined, async (span) => {
      const picks = readHighlights(call?.type === 'toolCall' ? call.arguments : undefined, input.lines.length);
      if (picks) return { picks, usage };
      span.fail();
      return { failed: 'the model did not return usable picks', usage };
    });
  };
}
