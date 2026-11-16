import type { Api, Context, Model, Models, Tool } from '@earendil-works/pi-ai';
import { SYSTEM_PROMPT, VERDICT_TOOL, buildPrompt } from '../triage/prompt.ts';
import { type Judge, UNSURE } from '../triage/stages/model.ts';

const MAX_REASON = 300;

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
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', enum: ids, description: 'The id of the single best label.' },
          confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How sure you are, from 0 to 1.' },
          reason: { type: 'string', description: 'One short sentence explaining the choice.' },
        },
        required: ['label', 'confidence', 'reason'],
        additionalProperties: false,
      },
      constrainedSampling: { type: 'json_schema', strict: 'prefer' },
    };
    const context: Context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(input), timestamp: Date.now() }],
      tools: [tool],
    };

    let message;
    try {
      message = await models.complete(model, context);
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
    const usage = {
      model: `${model.provider}/${model.id}`,
      inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
      outputTokens: message.usage.output,
      costUsd: message.usage.cost.total,
    };
    if (message.stopReason === 'error' || message.stopReason === 'aborted')
      return { failed: message.errorMessage ?? `model stopped: ${message.stopReason}`, usage };

    const call = message.content.find((block) => block.type === 'toolCall' && block.name === VERDICT_TOOL);
    const args = call?.type === 'toolCall' ? call.arguments : undefined;
    const label = args?.['label'];
    const reason = args?.['reason'];
    const confidence = args?.['confidence'];
    if (typeof label !== 'string' || !ids.includes(label) || typeof reason !== 'string') return { failed: 'the model did not return a usable verdict', usage };

    return {
      label,
      reason: reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON),
      ...(typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
      usage,
    };
  };
}
