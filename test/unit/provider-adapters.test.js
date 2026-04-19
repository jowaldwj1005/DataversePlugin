import { describe, it, expect } from 'vitest';
import { buildAiRequest, extractAiResponse, isResponsesApi, estimateTokens } from '../../src/sidepanel/modules/ai-customizer/provider-adapters.js';

// ---------------------------------------------------------------------------
// extractAiResponse — Responses API
// ---------------------------------------------------------------------------

describe('extractAiResponse — Responses API', () => {
  const responsesSettings = { aiProvider: 'openai', aiApiMode: 'responses' };

  it('extracts content from output_text convenience field', () => {
    const data = {
      output_text: '{"status":"done","reasoning":"Hello"}',
      output: [],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = extractAiResponse('openai', data, responsesSettings);
    expect(result.content).toBe('{"status":"done","reasoning":"Hello"}');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('falls back to output[] message when output_text is missing', () => {
    const data = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'fallback content' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = extractAiResponse('azure', data, responsesSettings);
    expect(result.content).toBe('fallback content');
  });

  it('returns null tokens when usage is missing', () => {
    const data = { output_text: 'test', output: [] };
    const result = extractAiResponse('openai', data, responsesSettings);
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it('returns no metadata when output has only messages', () => {
    const data = {
      output_text: 'hello',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'hello' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = extractAiResponse('openai', data, responsesSettings);
    expect(result.responsesMetadata).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractAiResponse — responsesMetadata
// ---------------------------------------------------------------------------

describe('extractAiResponse — responsesMetadata', () => {
  const settings = { aiProvider: 'azure', aiApiMode: 'responses' };

  it('extracts web_search_call with search queries', () => {
    const data = {
      output_text: 'result',
      output: [
        {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'search',
            queries: ['Dataverse create entity', 'EntityDefinitions POST'],
            query: 'Dataverse create entity',
          },
        },
        { type: 'message', content: [{ type: 'output_text', text: 'result' }] },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = extractAiResponse('azure', data, settings);
    expect(result.responsesMetadata).toHaveLength(1);
    expect(result.responsesMetadata[0]).toEqual({
      type: 'web_search',
      status: 'completed',
      queries: ['Dataverse create entity', 'EntityDefinitions POST'],
    });
  });

  it('extracts web_search_call with open_page URL', () => {
    const data = {
      output_text: 'result',
      output: [
        {
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'open_page', url: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api' },
        },
        { type: 'message', content: [{ type: 'output_text', text: 'result' }] },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = extractAiResponse('azure', data, settings);
    expect(result.responsesMetadata).toHaveLength(1);
    expect(result.responsesMetadata[0]).toEqual({
      type: 'web_search',
      status: 'completed',
      url: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api',
    });
  });

  it('extracts reasoning with non-empty summary', () => {
    const data = {
      output_text: 'result',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: ['Thinking about the query', 'Decided to search'] },
        { type: 'message', content: [{ type: 'output_text', text: 'result' }] },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = extractAiResponse('azure', data, settings);
    expect(result.responsesMetadata).toHaveLength(1);
    expect(result.responsesMetadata[0]).toEqual({
      type: 'reasoning',
      summary: ['Thinking about the query', 'Decided to search'],
    });
  });

  it('skips reasoning with empty summary', () => {
    const data = {
      output_text: 'result',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'result' }] },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = extractAiResponse('azure', data, settings);
    expect(result.responsesMetadata).toBeNull();
  });

  it('extracts URL citations from message annotations', () => {
    const data = {
      output_text: 'result',
      output: [
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'result',
            annotations: [{
              type: 'url_citation',
              url: 'https://learn.microsoft.com/en-us/example',
              title: 'Create and update table definitions',
            }],
          }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = extractAiResponse('azure', data, settings);
    expect(result.responsesMetadata).toHaveLength(1);
    expect(result.responsesMetadata[0]).toEqual({
      type: 'citation',
      url: 'https://learn.microsoft.com/en-us/example',
      title: 'Create and update table definitions',
    });
  });

  it('handles full real-world response with interleaved reasoning, searches, and citations', () => {
    // Mirrors the actual gpt-5.4-global response structure from the debug log
    const data = {
      output_text: '{"status":"tool_call","tool":"get_entities","params":{"filter":"test2"},"reasoning":"checking"}',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        {
          type: 'web_search_call', id: 'ws_1', status: 'completed',
          action: {
            type: 'search',
            queries: [
              'site:learn.microsoft.com Dataverse Web API create custom table',
              'site:learn.microsoft.com Dataverse EntityDefinitions 204 No Content',
            ],
            query: 'site:learn.microsoft.com Dataverse Web API create custom table',
          },
        },
        { type: 'reasoning', id: 'rs_2', summary: [] },
        {
          type: 'web_search_call', id: 'ws_2', status: 'completed',
          action: {
            type: 'open_page',
            url: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api',
          },
        },
        { type: 'reasoning', id: 'rs_3', summary: [] },
        {
          type: 'message', id: 'msg_1', phase: 'commentary',
          content: [{
            type: 'output_text',
            text: '{"status":"tool_call","tool":"get_entities","params":{"filter":"test2"},"reasoning":"checking"}',
            annotations: [],
          }],
        },
        {
          type: 'web_search_call', id: 'ws_3', status: 'completed',
          action: { type: 'search', queries: ['Dataverse primary name attribute required'] },
        },
        { type: 'reasoning', id: 'rs_4', summary: [] },
        {
          type: 'message', id: 'msg_2', phase: 'final_answer',
          content: [{
            type: 'output_text',
            text: '{"status":"tool_call","tool":"get_entities","params":{"filter":"test2"},"reasoning":"final"}',
            annotations: [{
              type: 'url_citation',
              url: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api',
              title: 'Create and update table definitions using the Web API',
            }],
          }],
        },
      ],
      usage: { input_tokens: 17459, output_tokens: 1370 },
    };

    const result = extractAiResponse('azure', data, settings);

    // Content should come from output_text
    expect(result.content).toBe('{"status":"tool_call","tool":"get_entities","params":{"filter":"test2"},"reasoning":"checking"}');
    expect(result.inputTokens).toBe(17459);
    expect(result.outputTokens).toBe(1370);

    // Metadata: 3 web searches + 1 citation (reasoning all empty → skipped)
    expect(result.responsesMetadata).toHaveLength(4);

    // First search — multiple queries
    expect(result.responsesMetadata[0].type).toBe('web_search');
    expect(result.responsesMetadata[0].queries).toHaveLength(2);

    // Second search — open_page
    expect(result.responsesMetadata[1].type).toBe('web_search');
    expect(result.responsesMetadata[1].url).toContain('learn.microsoft.com');

    // Third search
    expect(result.responsesMetadata[2].type).toBe('web_search');

    // Citation from final message
    expect(result.responsesMetadata[3].type).toBe('citation');
    expect(result.responsesMetadata[3].title).toBe('Create and update table definitions using the Web API');
  });
});

// ---------------------------------------------------------------------------
// extractAiResponse — Chat Completions / Anthropic
// ---------------------------------------------------------------------------

describe('extractAiResponse — Chat Completions', () => {
  it('extracts from OpenAI chat completions format', () => {
    const data = {
      choices: [{ message: { content: 'hello world' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    };
    const result = extractAiResponse('openai', data, { aiApiMode: 'chat' });
    expect(result.content).toBe('hello world');
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(20);
    expect(result.responsesMetadata).toBeUndefined();
  });

  it('extracts from Anthropic format', () => {
    const data = {
      content: [{ text: 'claude response' }],
      usage: { input_tokens: 30, output_tokens: 10 },
    };
    const result = extractAiResponse('anthropic', data, {});
    expect(result.content).toBe('claude response');
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// buildAiRequest — Responses API
// ---------------------------------------------------------------------------

describe('buildAiRequest — Responses API', () => {
  const baseSettings = {
    aiProvider: 'openai',
    aiEndpoint: 'https://api.openai.com/v1/responses',
    aiApiKey: 'sk-test',
    aiModel: 'gpt-5',
    aiMaxTokens: 4096,
    aiApiMode: 'responses',
    aiReasoning: '',
    aiWebSearch: '',
  };

  it('builds basic request without reasoning or web search', () => {
    const { url, headers, body } = buildAiRequest('openai', 'system', [{ role: 'user', content: 'hi' }], baseSettings);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(body.model).toBe('gpt-5');
    expect(body.instructions).toBe('system');
    expect(body.input).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.max_output_tokens).toBe(4096);
    expect(body.reasoning).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it('includes reasoning effort with summary auto when set', () => {
    const settings = { ...baseSettings, aiReasoning: 'high' };
    const { body } = buildAiRequest('openai', 'sys', [], settings);
    expect(body.reasoning).toEqual({ effort: 'high', summary: 'auto' });
  });

  it('includes web search tool when set to auto', () => {
    const settings = { ...baseSettings, aiWebSearch: 'auto' };
    const { body } = buildAiRequest('openai', 'sys', [], settings);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.tool_choice).toBeUndefined();
  });

  it('forces web search when set to required', () => {
    const settings = { ...baseSettings, aiWebSearch: 'required' };
    const { body } = buildAiRequest('openai', 'sys', [], settings);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.tool_choice).toEqual({ type: 'web_search' });
  });

  it('uses api-key header for Azure', () => {
    const settings = { ...baseSettings, aiProvider: 'azure', aiApiKey: 'azure-key' };
    const { headers } = buildAiRequest('azure', 'sys', [], settings);
    expect(headers['api-key']).toBe('azure-key');
    expect(headers.Authorization).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isResponsesApi / estimateTokens
// ---------------------------------------------------------------------------

describe('isResponsesApi', () => {
  it('returns true for openai with responses mode', () => {
    expect(isResponsesApi({ aiProvider: 'openai', aiApiMode: 'responses' })).toBe(true);
  });
  it('returns false for anthropic', () => {
    expect(isResponsesApi({ aiProvider: 'anthropic' })).toBe(false);
  });
  it('returns false for chat mode', () => {
    expect(isResponsesApi({ aiProvider: 'openai', aiApiMode: 'chat' })).toBe(false);
  });
});

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });
});
