import type { Api, AssistantMessage, Context, Model, Models, Tool } from '@earendil-works/pi-ai';
import { type Attributes, traced } from '../telemetry.ts';
import { SYSTEM_PROMPT, VERDICT_TOOL, buildPrompt } from '../triage/prompt.ts';
import { type Judge, UNSURE, describeFailure as failure } from '../triage/stages/model.ts';

const MAX_REASON = 300;
/**
 * One attempt, with no retries inside the SDK: a hung call would otherwise hold up every person's pass for
 * the SDK's ten minutes, and each attempt must be a run of its own. The queue does the retrying.
 */
const CALL = { timeoutMs: 60_000, maxRetries: 0 };

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

/**
 * A Judge backed by a pi-ai model. One request per message, no conversation and no tools the model can
 * act with: its only output is a single structured verdict, which is validated here before use.
 * Any failure (provider error, no verdict, malformed verdict) is returned as one, never as `unsure`.
 */
export function createJudge(models: Models, model: Model<Api>): Judge {
  return async (input) => {
    const ids = [...input.labels.map((l) => l.id), UNSURE];
    const tool: Tool = {
      name: VERDICT_TOOL,
      description: 'Record which label this email gets.',
      // The model writes the properties in this order: the reason comes first so the label follows from it,
      // rather than being explained after it was chosen.
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'One short sentence: what this email is, and so which label fits.' },
          label: { type: 'string', enum: ids, description: 'The id of the single best label.' },
          confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How sure you are, from 0 to 1.' },
        },
        required: ['reason', 'label', 'confidence'],
        additionalProperties: false,
      },
      constrainedSampling: { type: 'json_schema', strict: 'prefer' },
    };
    const context: Context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(input), timestamp: Date.now() }],
      tools: [tool],
    };

    const call = { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': model.provider, 'gen_ai.request.model': model.id };
    let message: AssistantMessage;
    try {
      message = await traced('gen_ai.chat', `chat ${model.id}`, call, async (span) => {
        const settled = await models.complete(model, context, CALL);
        span.set(answered(settled));
        if (settled.stopReason === 'error' || settled.stopReason === 'aborted') span.fail();
        return settled;
      });
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

    const content = message.content;
    // The verdict is the tool's one use: its span says whether it was usable, not what it said.
    return await traced(
      'gen_ai.execute_tool',
      `execute_tool ${VERDICT_TOOL}`,
      { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': VERDICT_TOOL, 'gen_ai.tool.type': 'function' },
      async (span) => {
        const verdict = content.find((block) => block.type === 'toolCall' && block.name === VERDICT_TOOL);
        const args = verdict?.type === 'toolCall' ? verdict.arguments : undefined;
        const label = args?.['label'];
        const reason = args?.['reason'];
        const confidence = args?.['confidence'];
        if (typeof label !== 'string' || !ids.includes(label) || typeof reason !== 'string') {
          span.fail();
          return { failed: 'the model did not return a usable verdict', usage, unusable: true };
        }
        return {
          label,
          reason: reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON),
          ...(typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
          usage,
        };
      },
    );
  };
}
