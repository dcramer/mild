import type { Api, AssistantMessage, Context, Model, Models, Tool } from '@earendil-works/pi-ai';
import { SYSTEM_PROMPT, VERDICT_TOOL, buildPrompt, forModel, fromModel } from '../triage/prompt.ts';
import { type Judge, UNSURE, describeFailure as failure } from '../triage/stages/model.ts';
import { chat, executeTool } from './chat.ts';

const MAX_REASON = 300;
/**
 * One attempt, with no retries inside the SDK: a hung call would otherwise hold up every person's pass for
 * the SDK's ten minutes, and each attempt must be a run of its own. The queue does the retrying.
 */
const CALL = { timeoutMs: 60_000, maxRetries: 0 };

/**
 * A Judge backed by a pi-ai model. One request per message, no conversation and no tools the model can
 * act with: its only output is a single structured verdict, which is validated here before use.
 * Any failure (provider error, no verdict, malformed verdict) is returned as one, never as `unsure`.
 */
export function createJudge(models: Models, model: Model<Api>): Judge {
  return async (input) => {
    const ids = [...input.labels.map((l) => forModel(l.id)), UNSURE];
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

    let message: AssistantMessage;
    try {
      message = await chat(models, model, context, CALL);
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

    const verdict = message.content.find((block) => block.type === 'toolCall' && block.name === VERDICT_TOOL);
    const args = verdict?.type === 'toolCall' ? verdict.arguments : undefined;
    return await executeTool(VERDICT_TOOL, verdict?.type === 'toolCall' ? verdict.id : undefined, async (span) => {
      const label = args?.['label'];
      const reason = args?.['reason'];
      const confidence = args?.['confidence'];
      if (typeof label !== 'string' || !ids.includes(label) || typeof reason !== 'string') {
        span.fail();
        return { failed: 'the model did not return a usable verdict', usage, unusable: true };
      }
      return {
        label: fromModel(label),
        reason: reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON),
        ...(typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? { confidence } : {}),
        usage,
      };
    });
  };
}
