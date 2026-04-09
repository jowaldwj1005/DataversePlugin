/**
 * AI Customizer — Provider adapters
 *
 * Builds provider-specific HTTP requests and extracts responses
 * for OpenAI, Azure OpenAI, Anthropic, and custom endpoints.
 */

/**
 * Build a provider-specific HTTP request payload for a multi-turn conversation.
 * @param {string} provider  'openai' | 'azure' | 'anthropic' | 'custom'
 * @param {string} systemPrompt
 * @param {Array<{role: string, content: string}>} messages  Conversation messages (user + assistant turns)
 * @param {{ aiEndpoint: string, aiApiKey: string, aiModel: string, aiMaxTokens: number }} settings
 * @returns {{ url: string, headers: object, body: object }}
 */
export function buildAiRequest(provider, systemPrompt, messages, settings) {
  switch (provider) {
    case 'openai':
    case 'custom':
      return {
        url: `${settings.aiEndpoint}/chat/completions`,
        headers: { Authorization: `Bearer ${settings.aiApiKey}` },
        body: {
          model: settings.aiModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: 0.2,
          max_tokens: settings.aiMaxTokens || 4096,
          response_format: { type: 'json_object' },
        },
      };

    case 'azure':
      return {
        url: `${settings.aiEndpoint}/chat/completions?api-version=2024-06-01`,
        headers: { 'api-key': settings.aiApiKey },
        body: {
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: 0.2,
          max_tokens: settings.aiMaxTokens || 4096,
          response_format: { type: 'json_object' },
        },
      };

    case 'anthropic':
      return {
        url: `${settings.aiEndpoint}/messages`,
        headers: {
          'x-api-key': settings.aiApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: {
          model: settings.aiModel,
          max_tokens: settings.aiMaxTokens || 4096,
          system: systemPrompt,
          messages,
          temperature: 0.2,
        },
      };

    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

/**
 * Extract content and token usage from a provider-specific response.
 * @param {string} provider
 * @param {object} data  Parsed response body
 * @returns {{ content: string, inputTokens: number|null, outputTokens: number|null }}
 */
export function extractAiResponse(provider, data) {
  switch (provider) {
    case 'openai':
    case 'azure':
    case 'custom':
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
      };

    case 'anthropic':
      return {
        content: data.content?.[0]?.text ?? '',
        inputTokens: data.usage?.input_tokens ?? null,
        outputTokens: data.usage?.output_tokens ?? null,
      };

    default:
      return { content: JSON.stringify(data), inputTokens: null, outputTokens: null };
  }
}

/**
 * Rough token estimate (for display only — not billing-accurate).
 * ~4 chars per token for English/XML.
 */
export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}
