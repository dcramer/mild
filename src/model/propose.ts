import type { Api, AssistantMessage, Context, Model, Models, Tool } from '@earendil-works/pi-ai';
import { DRAFT_ACTIONS, MAX_DRAFTS, PROPOSAL_PROMPT, PROPOSAL_TOOL, type Proposer, buildProposalPrompt, readProposal } from '../triage/proposal.ts';
import { describeFailure as failure } from '../triage/stages/model.ts';
import { chat, executeTool } from './chat.ts';

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
          note: { type: 'string', description: 'What of what they asked these labels leave out, and why; empty if nothing.' },
        },
        required: ['labels', 'note'],
        additionalProperties: false,
      },
      constrainedSampling: { type: 'json_schema', strict: 'prefer' },
    };
    const context: Context = {
      systemPrompt: PROPOSAL_PROMPT,
      messages: [{ role: 'user', content: buildProposalPrompt(input), timestamp: Date.now() }],
      tools: [tool],
    };

    let message: AssistantMessage;
    try {
      // Asked with the person's own words and labels, never mail, so the call's prompt and answer go on its span.
      message = await chat(models, model, context, CALL, true);
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
    return await executeTool(PROPOSAL_TOOL, proposed?.type === 'toolCall' ? proposed.id : undefined, async (span) => {
      const proposal = readProposal(proposed?.type === 'toolCall' ? proposed.arguments : undefined, input.labels);
      if (proposal) return { ...proposal, usage };
      span.fail();
      return { failed: 'the model did not suggest any usable labels', usage };
    });
  };
}
