/**
 * AI Customizer — Provider adapters
 *
 * Builds provider-specific HTTP requests and extracts responses.
 * The endpoint URL is the FULL URL to POST to (user enters it completely).
 *
 * Two API modes (applies to OpenAI, Azure, Custom):
 * - Responses API (default): `input`, `instructions`, `max_output_tokens`
 * - Chat Completions:        `messages`, `max_tokens`
 *
 * Anthropic always uses its own Messages format.
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
 * @returns {{ url: string, headers: object, body: object }}
 */
export function buildAiRequest(provider, systemPrompt, messages, settings) {
  // Anthropic — always Messages format
  if (provider === 'anthropic') {
    return _buildAnthropic(systemPrompt, messages, settings);
  }

  // Responses API (default for OpenAI / Azure / Custom)
  if (settings.aiApiMode !== 'chat') {
    return _buildResponses(provider, systemPrompt, messages, settings);
  }

  // Chat Completions
  return _buildChatCompletions(provider, systemPrompt, messages, settings);
}

/**
 * Responses API request builder.
 * Endpoint URL is used as-is — user provides the full URL.
 */
function _buildResponses(provider, systemPrompt, messages, settings) {
  const headers = provider === 'azure'
    ? { 'api-key': settings.aiApiKey }
    : { Authorization: `Bearer ${settings.aiApiKey}` };

  const body = {
    model: settings.aiModel,
    instructions: systemPrompt,
    input: messages.map(m => ({ role: m.role, content: m.content })),
    max_output_tokens: settings.aiMaxTokens || 4096,
  };

  // Reasoning effort (off by default)
  if (settings.aiReasoning) {
    body.reasoning = { effort: settings.aiReasoning };
  }

  // Web search tool
  if (settings.aiWebSearch) {
    body.tools = [{ type: 'web_search' }];
    if (settings.aiWebSearch === 'required') {
      body.tool_choice = { type: 'web_search' };
    }
  }

  return { url: settings.aiEndpoint, headers, body };
}

/**
 * Chat Completions request builder.
 * Endpoint URL is used as-is — user provides the full URL.
 */
function _buildChatCompletions(provider, systemPrompt, messages, settings) {
  const headers = provider === 'azure'
    ? { 'api-key': settings.aiApiKey }
    : { Authorization: `Bearer ${settings.aiApiKey}` };

  const body = {
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: 0.2,
    max_tokens: settings.aiMaxTokens || 4096,
    response_format: { type: 'json_object' },
  };

  // Azure: model is in the URL (deployment name), not in the body
  if (provider !== 'azure') {
    body.model = settings.aiModel;
  }

  return { url: settings.aiEndpoint, headers, body };
}

/**
 * Anthropic Messages API request builder.
 * Endpoint URL is used as-is — user provides the full URL.
 */
function _buildAnthropic(systemPrompt, messages, settings) {
  return {
    url: settings.aiEndpoint,
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
}

// ============================================================================
// Response extractors
// ============================================================================

/**
 * Extract content, tokens, and metadata from a provider response.
 * @param {string} provider
 * @param {object} data  Parsed response body
 * @param {Object} [settings]
 * @returns {{ content: string, inputTokens: number|null, outputTokens: number|null }}
 */
export function extractAiResponse(provider, data, settings) {
  // Responses API (any provider except Anthropic)
  if (provider !== 'anthropic' && settings?.aiApiMode !== 'chat') {
    return _extractResponses(data);
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
 * Extract content from Responses API response.
 *
 * Response shape:
 * {
 *   id: "resp_...",
 *   output_text: "...",
 *   output: [
 *     { type: "message", content: [{ type: "output_text", text: "..." }] },
 *     { type: "web_search_call", ... },
 *     { type: "function_call", name, call_id, arguments },
 *   ],
 *   usage: { input_tokens, output_tokens, total_tokens },
 *   status: "completed"
 * }
 */
function _extractResponses(data) {
  // output_text is a convenience field (OpenAI adds it, Azure may not)
  // Fallback: walk output[] → find message → extract text
  let content = data.output_text ?? '';
  const responsesMetadata = [];

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        if (!content) {
          for (const block of item.content) {
            if (block.type === 'output_text' && block.text) {
              content = block.text;
              break;
            }
          }
        }
        // Collect URL citations from annotations
        for (const block of item.content) {
          if (block.annotations?.length) {
            for (const ann of block.annotations) {
              if (ann.type === 'url_citation') {
                responsesMetadata.push({ type: 'citation', url: ann.url, title: ann.title });
              }
            }
          }
        }
      } else if (item.type === 'reasoning') {
        if (item.summary?.length) {
          responsesMetadata.push({ type: 'reasoning', summary: item.summary });
        }
      } else if (item.type === 'web_search_call') {
        const meta = { type: 'web_search', status: item.status };
        if (item.action?.type === 'search') {
          meta.queries = item.action.queries || [item.action.query];
        } else if (item.action?.type === 'open_page') {
          meta.url = item.action.url;
        }
        responsesMetadata.push(meta);
      }
    }
  }

  return {
    content,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
    responsesMetadata: responsesMetadata.length ? responsesMetadata : null,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if the current settings use Responses API mode.
 */
export function isResponsesApi(settings) {
  return settings?.aiProvider !== 'anthropic' && settings?.aiApiMode !== 'chat';
}

/**
 * Rough token estimate (for display only — not billing-accurate).
 * ~4 chars per token for English/XML.
 */
export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}
