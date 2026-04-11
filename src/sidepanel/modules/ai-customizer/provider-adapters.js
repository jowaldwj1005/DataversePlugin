/**
 * AI Customizer — Provider adapters
 *
 * Builds provider-specific HTTP requests and extracts responses.
 * Supports:
 * - OpenAI (Chat Completions)
 * - Azure OpenAI (Chat Completions)
 * - Azure OpenAI (Responses API) — stateful, previous_response_id multi-turn
 * - Anthropic (Messages)
 * - Custom (OpenAI-compatible)
 */

// ============================================================================
// Request builders
// ============================================================================

/**
 * Build a provider-specific HTTP request payload.
 * @param {string} provider  'openai' | 'azure' | 'anthropic' | 'custom'
 * @param {string} systemPrompt
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} settings
 * @param {Object} [opts]
 * @param {string} [opts.previousResponseId]  Azure Responses API: chain responses
 * @returns {{ url: string, headers: object, body: object }}
 */
export function buildAiRequest(provider, systemPrompt, messages, settings, opts = {}) {
  if (provider === 'azure' && settings.aiAzureApiMode === 'responses') {
    return _buildAzureResponses(systemPrompt, messages, settings, opts.previousResponseId);
  }

  switch (provider) {
    case 'openai':
    case 'custom':
      return {
        url: `${settings.aiEndpoint}/chat/completions`,
        headers: { Authorization: `Bearer ${settings.aiApiKey}` },
        body: {
          model: settings.aiModel,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
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
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
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
 * Azure Responses API request builder.
 *
 * Endpoint patterns (both supported):
 *   {base}/openai/v1/responses
 *   {base}/openai/responses?api-version=2025-04-01-preview
 *
 * Key differences from Chat Completions:
 * - `instructions` instead of system message in messages array
 * - `input` instead of `messages`
 * - `previous_response_id` for multi-turn (server manages state)
 * - `text.format` instead of `response_format`
 * - `max_output_tokens` instead of `max_tokens`
 * - Model specified in body (not in URL deployment path)
 */
function _buildAzureResponses(systemPrompt, messages, settings, previousResponseId) {
  // Derive base URL: strip /openai/deployments/... or /openai/v1/... if present
  let base = settings.aiEndpoint;
  const depIdx = base.indexOf('/openai/deployments');
  if (depIdx !== -1) base = base.slice(0, depIdx);
  base = base.replace(/\/openai\/v1\/?$/, '').replace(/\/openai\/?$/, '').replace(/\/+$/, '');

  // Use api-version format (matches what user shared as their actual endpoint)
  const url = `${base}/openai/responses?api-version=2025-04-01-preview`;

  // With previous_response_id: only send the NEW input (tool results / user reply)
  // Without: send full conversation as input items
  let input;
  if (previousResponseId) {
    // Only the latest messages since the last response
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    input = lastUserMsg ? [{ role: 'user', content: lastUserMsg.content }] : [];
  } else {
    input = messages.map(m => ({ role: m.role, content: m.content }));
  }

  const body = {
    model: settings.aiModel,
    instructions: systemPrompt,
    input,
    temperature: 0.2,
    max_output_tokens: settings.aiMaxTokens || 4096,
    text: { format: { type: 'json_object' } },
    store: false,  // Don't store conversation data on Azure by default
  };

  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  return { url, headers: { 'api-key': settings.aiApiKey }, body };
}

// ============================================================================
// Response extractors
// ============================================================================

/**
 * Extract content, tokens, and metadata from a provider response.
 * @param {string} provider
 * @param {object} data  Parsed response body
 * @param {Object} [settings]
 * @returns {{ content: string, inputTokens: number|null, outputTokens: number|null, responseId?: string }}
 */
export function extractAiResponse(provider, data, settings) {
  if (provider === 'azure' && settings?.aiAzureApiMode === 'responses') {
    return _extractAzureResponses(data);
  }

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
 * Extract content from Azure Responses API response.
 *
 * Response shape:
 * {
 *   id: "resp_...",
 *   output_text: "...",                              // convenience shortcut
 *   output: [
 *     { type: "message", content: [{ type: "output_text", text: "..." }] },
 *     { type: "web_search_call", ... },              // if web search enabled
 *     { type: "function_call", name, call_id, arguments },
 *   ],
 *   usage: { input_tokens, output_tokens, total_tokens, output_tokens_details },
 *   status: "completed",
 *   previous_response_id: "resp_..." | null
 * }
 */
function _extractAzureResponses(data) {
  return {
    content: data.output_text ?? '',
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
    responseId: data.id || null,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if the current settings use Azure Responses API.
 */
export function isAzureResponses(settings) {
  return settings?.aiProvider === 'azure' && settings?.aiAzureApiMode === 'responses';
}

/**
 * Rough token estimate (for display only — not billing-accurate).
 * ~4 chars per token for English/XML.
 */
export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}
