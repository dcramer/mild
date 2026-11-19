import type { Api, AssistantMessage, Model, Models, Tool } from '@earendil-works/pi-ai';
import { SUMMARY_PROMPT, SUMMARY_TOOL, type Summarizer, buildSummaryPrompt, readSummary } from '../triage/mail-summary.ts';
import { describeFailure as failure } from '../triage/stages/model.ts';
import { chat, executeTool } from './chat.ts';
import type { Reasoning } from './reasoning.ts';

const CALL = { timeoutMs: 60_000, maxRetries: 0 };

const record: Tool = {
  name: SUMMARY_TOOL,
  description: 'Record what the conversation says.',
  parameters: {
    type: 'object',
    properties: { summary: { type: 'string', description: 'At most three short sentences.' } },
    required: ['summary'],
    additionalProperties: false,
  },
  constrainedSampling: { type: 'json_schema', strict: 'prefer' },
};

/** A Summarizer backed by a pi-ai model: one request with the conversation's text, and no tool but the one that records the summary. */
export function createSummarizer(models: Models, model: Model<Api>, reasoning: Reasoning): Summarizer {
  return async (conversation) => {
    let message: AssistantMessage;
    try {
      // Shown mail, so its prompt and answer stay off the span.
      message = await chat(
        models,
        model,
        { systemPrompt: SUMMARY_PROMPT, messages: [{ role: 'user', content: buildSummaryPrompt(conversation), timestamp: Date.now() }], tools: [record] },
        { ...CALL, reasoning },
      );
    } catch (error) {
      return { failed: failure(error) };
    }
    const usage = {
      model: `${model.provider}/${model.id}`,
      inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
      outputTokens: message.usage.output,
      costUsd: message.usage.cost.total,
    };
    if (message.stopReason === 'error' || message.stopReason === 'aborted') return { failed: failure(message.errorMessage ?? message.stopReason), usage };
    const called = message.content.find((block) => block.type === 'toolCall' && block.name === SUMMARY_TOOL);
    return await executeTool(SUMMARY_TOOL, called?.type === 'toolCall' ? called.id : undefined, async (span) => {
      const summary = readSummary(called?.type === 'toolCall' ? called.arguments : undefined);
      if (summary) return { summary, usage };
      span.fail();
      return { failed: 'the model did not summarize it', usage };
    });
  };
}
