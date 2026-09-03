import type { ConverseCommandInput, Message } from '@aws-sdk/client-bedrock-runtime';
import type { LLMClient, LLMMessage, LLMOptions, LLMResponse } from '@vocion/sdk';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

/**
 * Amazon Bedrock adapter for the provider-neutral `LLMClient`.
 *
 * Speaks the Converse API rather than `InvokeModel`, because Converse is the
 * one request shape that is the same for every model family on Bedrock —
 * `InvokeModel` takes a different JSON body per vendor, which would put a
 * per-model-family branch in here for no gain. Both of the Claude models we
 * default to support Converse.
 *
 * Bedrock's `system` prompt is a separate field, as it is on Anthropic direct,
 * so system messages are lifted out of the array the same way. `responseFormat`
 * has no equivalent parameter, so a JSON request becomes an appended system
 * instruction — again matching the Anthropic adapter. Callers that need strict
 * JSON should still validate on the way out.
 * @param client - A Bedrock runtime client, already carrying the region and the
 * credentials this call should spend.
 */
export function bedrockClient(client: BedrockRuntimeClient): LLMClient {
  return {
    provider: 'bedrock',
    async generate(opts: LLMOptions): Promise<LLMResponse> {
      const systemPrompt = buildSystemPrompt(opts);
      const request: ConverseCommandInput = {
        modelId: opts.model,
        messages: toConverseMessages(opts.messages),
        ...(systemPrompt ? { system: [{ text: systemPrompt }] } : {}),
        inferenceConfig: {
          // Bedrock rejects an explicit `undefined` on some fields, so only
          // send what the caller actually set.
          ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        },
      };

      const response = await client.send(new ConverseCommand(request));

      // Converse returns content as a list of blocks (text, tool use, reasoning).
      // Flatten just the text blocks, as the Anthropic adapter does.
      const content = (response.output?.message?.content ?? [])
        .map(block => block.text ?? '')
        .join('');

      return {
        content,
        finishReason: response.stopReason,
        usage: {
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
        },
      };
    },
  };
}

/**
 * The system text for a Converse request, or an empty string when there is none.
 *
 * Joins every system message the caller passed and appends the JSON instruction
 * when `responseFormat` asked for an object, since Converse has no
 * `response_format` parameter to carry that intent.
 * @param opts - The generation options as the caller supplied them.
 */
function buildSystemPrompt(opts: LLMOptions): string {
  const systemMessages = opts.messages
    .filter(message => message.role === 'system')
    .map(message => message.content);
  const jsonInstruction = opts.responseFormat === 'json_object'
    ? 'Respond with a single valid JSON object. No prose before or after.'
    : '';
  return [...systemMessages, jsonInstruction]
    .filter(part => part.trim() !== '')
    .join('\n\n');
}

/**
 * Turn our flat message array into the alternating user/assistant turns
 * Converse requires.
 *
 * Bedrock is stricter here than OpenAI or Anthropic: two messages with the same
 * role in a row are rejected outright with a `ValidationException`, so
 * consecutive same-role messages are merged into one turn rather than passed
 * through. Callers assembling a transcript from several sources hit this
 * routinely, and a failed request is a worse answer than a joined turn.
 * @param messages - The caller's messages, system entries included.
 */
function toConverseMessages(messages: LLMMessage[]): Message[] {
  const turns: Message[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }
    const previousTurn = turns[turns.length - 1];
    if (previousTurn?.role === message.role) {
      previousTurn.content = [...(previousTurn.content ?? []), { text: message.content }];
      continue;
    }
    turns.push({ role: message.role, content: [{ text: message.content }] });
  }
  return turns;
}

/**
 * A Bedrock runtime client for one region and one set of credentials.
 *
 * `credentials: undefined` is meaningful, not a placeholder: it leaves the AWS
 * SDK's own credential chain in charge, which is the only way a Bedrock API key
 * in `AWS_BEARER_TOKEN_BEDROCK` or a host's instance role can authenticate the
 * call. See `./bedrockCredentials` for which of the two a given org gets.
 * @param options - Region and credentials for this client.
 * @param options.region - The AWS region to send the request to.
 * @param options.credentials - An explicit key pair, or null to let the AWS SDK
 * resolve one.
 */
export function buildBedrockRuntimeClient(options: {
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string } | null;
}): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: options.region,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });
}
