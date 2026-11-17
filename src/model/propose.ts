import type { Api, AssistantMessage, Context, Model, Models, Tool } from '@earendil-works/pi-ai';
import { traced } from '../telemetry.ts';
import { DRAFT_ACTIONS, MAX_DRAFTS, PROPOSAL_PROMPT, PROPOSAL_TOOL, type Proposer, buildProposalPrompt, readDrafts } from '../triage/proposal.ts';
import { describeFailure as failure } from '../triage/stages/model.ts';
import { answered } from './judge.ts';

/** One attempt, as for the judge; the person asks again. Longer, since it writes several labels. */
const CALL = { timeoutMs: 120_000, maxRetries: 0 };

/**
 * A Proposer backed by a pi-ai model: one request with the person's own words, no mail, and no tool but the
 * one that records its suggestions, which are checked here before use.
 */
export function createProposer(models: Models, model: Model<Api>): Proposer {
  return async (input) => {
    const tool: Tool = {
      name: PROPOSAL_TOOL,
      description: 'Record the labels you suggest.',
      parameters: {
        type: 'object',
        properties: {
          labels: {
            type: 'array',
            maxItems: MAX_DRAFTS,
            items: {
              type: 'object',
              properties: {
                why: { type: 'string', description: 'Which part of what the owner said this serves, in a few words.' },
                name: { type: 'string' },
                description: { type: 'string', description: 'What belongs, and what looks similar but does not.' },
                action: { type: 'string', enum: [...DRAFT_ACTIONS] },
                markRead: { type: 'boolean' },
                unsubscribe: { type: 'boolean' },
              },
              required: ['why', 'name', 'description', 'action', 'markRead', 'unsubscribe'],
              additionalProperties: false,
            },
          },
        },
        required: ['labels'],
        additionalProperties: false,
      },
      constrainedSampling: { type: 'json_schema', strict: 'prefer' },
    };
    const context: Context = {
      systemPrompt: PROPOSAL_PROMPT,
      messages: [{ role: 'user', content: buildProposalPrompt(input), timestamp: Date.now() }],
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
    const proposed = message.content.find((block) => block.type === 'toolCall' && block.name === PROPOSAL_TOOL);
    const drafts = readDrafts(proposed?.type === 'toolCall' ? proposed.arguments : undefined);
    return drafts ? { drafts, usage } : { failed: 'the model did not suggest any usable labels', usage };
  };
}
