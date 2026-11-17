import type { Api, AssistantMessage, Context, Model, Models } from '@earendil-works/pi-ai';
import { type Attributes, type Traced, traced } from '../telemetry.ts';

/**
 * What the call's span says of the answer, under the names Sentry's AI monitoring reads (OpenTelemetry's
 * GenAI conventions, as Sentry's own pi-ai integration sets them): the model, why it stopped, tokens and
 * cost. Never what was asked or answered. Cached tokens count in the input, and their cost in its cost.
 */
function answered(message: AssistantMessage): Attributes {
  const { usage } = message;
  const finish = message.stopReason === 'toolUse' ? 'tool_call' : message.stopReason;
  // A failed call reports zero of everything, which would read as a free one.
  const billed = (message.stopReason !== 'error' && message.stopReason !== 'deferred') || usage.totalTokens > 0;
  return {
    'gen_ai.response.model': message.responseModel ?? message.model,
    'gen_ai.response.id': message.responseId,
    'gen_ai.response.finish_reasons': JSON.stringify([finish]),
    ...(billed
      ? {
          'gen_ai.usage.input_tokens': usage.input + usage.cacheRead + usage.cacheWrite,
          'gen_ai.usage.output_tokens': usage.output,
          'gen_ai.usage.total_tokens': usage.totalTokens,
          'gen_ai.usage.cache_read.input_tokens': usage.cacheRead,
          'gen_ai.usage.cache_creation.input_tokens': usage.cacheWrite,
          'gen_ai.usage.reasoning.output_tokens': usage.reasoning,
          'gen_ai.cost.input_tokens': usage.cost.input + usage.cost.cacheRead + usage.cost.cacheWrite,
          'gen_ai.cost.output_tokens': usage.cost.output,
          'gen_ai.cost.total_tokens': usage.cost.total,
          'gen_ai.cost.cache_read.input_tokens': usage.cost.cacheRead,
          'gen_ai.cost.cache_creation.input_tokens': usage.cost.cacheWrite,
        }
      : {}),
  };
}

/** One request to the model, as a `gen_ai.chat` span. Rejects as `complete` does. */
export const chat = (models: Models, model: Model<Api>, context: Context, options: { timeoutMs: number; maxRetries: number }): Promise<AssistantMessage> =>
  traced(
    'gen_ai.chat',
    `chat ${model.id}`,
    { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': model.provider, 'gen_ai.request.model': model.id },
    async (span) => {
      const settled = await models.complete(model, context, options);
      span.set(answered(settled));
      if (settled.stopReason === 'error' || settled.stopReason === 'aborted') span.fail();
      return settled;
    },
  );

/**
 * Sift carrying out a tool call the model made, as a `gen_ai.execute_tool` span. Recording an answer counts:
 * its span says whether the answer was usable, never what it was.
 */
export const executeTool = <T>(name: string, callId: string | undefined, work: (span: Traced) => Promise<T>): Promise<T> =>
  traced(
    'gen_ai.execute_tool',
    `execute_tool ${name}`,
    { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, 'gen_ai.tool.type': 'function', 'gen_ai.tool.call.id': callId },
    work,
  );
