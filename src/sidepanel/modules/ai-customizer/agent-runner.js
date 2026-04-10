/**
 * Dataverse Agent — Agent Runner
 *
 * General-purpose multi-turn agent loop with tool calling.
 * The agent can call any registered tool, ask user questions,
 * and produce final results.
 */

import { buildAiRequest, extractAiResponse, estimateTokens } from './provider-adapters.js';

let stepCounter = 0;

export class AgentRunner {
  #api;
  #cache;
  #settings;
  #toolExecutor;
  #toolRegistry;
  #onStep;
  #onLog;
  #maxIterations;
  #aborted = false;

  // Conversation state
  #systemPrompt = '';
  #messages = [];
  #resolveQuestion = null;
  #resolveConfirmation = null;

  /**
   * @param {Object} api           DataverseClient
   * @param {Object} cache         MetadataCache
   * @param {Object} settings      AI provider settings
   * @param {Object} toolExecutor  ToolExecutor instance
   * @param {Object} toolRegistry  ToolRegistry instance
   * @param {Object} callbacks
   * @param {(step: Object) => void} callbacks.onStep
   * @param {(tag: string, summary: string, detail?: string) => void} callbacks.onLog
   * @param {number} [callbacks.maxIterations=10]
   */
  constructor(api, cache, settings, toolExecutor, toolRegistry, { onStep, onLog, maxIterations = 10 }) {
    this.#api = api;
    this.#cache = cache;
    this.#settings = settings;
    this.#toolExecutor = toolExecutor;
    this.#toolRegistry = toolRegistry;
    this.#onStep = onStep;
    this.#onLog = onLog;
    this.#maxIterations = maxIterations;
  }

  /**
   * Run the agent loop.
   * @param {string} systemPrompt  Full system prompt (with tool list, skills, context)
   * @param {string} userPrompt    User's message
   * @returns {Promise<{ status: string, result?: any, error?: string }>}
   */
  async run(systemPrompt, userPrompt) {
    this.#aborted = false;
    this.#systemPrompt = systemPrompt;
    this.#messages = [{ role: 'user', content: userPrompt }];

    const sysTokens = estimateTokens(systemPrompt);
    const userTokens = estimateTokens(userPrompt);
    this.#onLog('SEND', `System: ~${sysTokens} tokens, User: ~${userTokens} tokens`, systemPrompt);

    return this.#loop();
  }

  /**
   * Continue after user answers a question.
   */
  continueWithAnswer(answer) {
    if (this.#resolveQuestion) {
      this.#resolveQuestion(answer);
      this.#resolveQuestion = null;
    }
  }

  abort() {
    this.#aborted = true;
    if (this.#resolveQuestion) { this.#resolveQuestion(null); this.#resolveQuestion = null; }
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  async #loop() {
    for (let iteration = 0; iteration < this.#maxIterations; iteration++) {
      if (this.#aborted) return { status: 'error', error: 'Aborted by user' };

      // Step: calling AI
      const thinkStepId = `step-${++stepCounter}`;
      this.#onStep({
        id: thinkStepId,
        type: 'thinking',
        label: iteration === 0 ? 'Analyzing your request...' : 'Processing...',
        reasoning: null,
        status: 'running',
        startedAt: performance.now(),
        completedAt: null,
      });

      let parsed;
      try {
        parsed = await this.#callAi();
      } catch (err) {
        this.#onStep({ id: thinkStepId, type: 'error', label: `AI request failed: ${err.message}`, reasoning: null, status: 'error', startedAt: performance.now(), completedAt: performance.now() });
        return { status: 'error', error: err.message };
      }

      if (this.#aborted) return { status: 'error', error: 'Aborted by user' };

      // Update thinking step — don't show reasoning here if it's the final "done" response
      // (the main module renders reasoning as the final content to avoid duplication)
      const isTerminal = parsed.status === 'done' || parsed.status === 'error';
      this.#onStep({
        id: thinkStepId,
        type: 'thinking',
        label: iteration === 0 ? 'Analyzed request' : 'Processed',
        reasoning: isTerminal ? null : (parsed.reasoning || null),
        status: 'done',
        startedAt: performance.now(),
        completedAt: performance.now(),
      });

      // Dispatch by status
      switch (parsed.status) {
        case 'done':
          return { status: 'done', result: parsed.result || parsed, reasoning: parsed.reasoning };

        case 'tool_call': {
          const continueLoop = await this.#handleToolCall(parsed);
          if (!continueLoop) return { status: 'error', error: 'Tool call failed or rejected' };
          break;
        }

        case 'tool_calls': {
          if (Array.isArray(parsed.calls)) {
            for (const call of parsed.calls) {
              if (this.#aborted) return { status: 'error', error: 'Aborted by user' };
              const ok = await this.#handleToolCall({ ...call, reasoning: parsed.reasoning });
              if (!ok) return { status: 'error', error: 'Tool call failed or rejected' };
            }
          }
          break;
        }

        case 'question': {
          const qStepId = `step-${++stepCounter}`;
          this.#onStep({
            id: qStepId,
            type: 'question',
            label: parsed.question || 'The agent has a question',
            reasoning: parsed.reasoning || null,
            status: 'waiting',
            startedAt: performance.now(),
            completedAt: null,
          });

          const answer = await new Promise(resolve => { this.#resolveQuestion = resolve; });
          if (!answer || this.#aborted) return { status: 'error', error: 'Aborted by user' };

          this.#messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
          this.#messages.push({ role: 'user', content: answer });
          break;
        }

        case 'error':
          return { status: 'error', error: parsed.error, reasoning: parsed.reasoning };

        default:
          return { status: 'error', error: `Unknown status: ${parsed.status}` };
      }
    }

    return { status: 'error', error: `Agent loop exceeded ${this.#maxIterations} iterations` };
  }

  // ---------------------------------------------------------------------------
  // Tool call handling
  // ---------------------------------------------------------------------------

  async #handleToolCall(call) {
    const toolId = call.tool;
    const params = call.params || {};
    const reasoning = call.reasoning || '';

    const tool = this.#toolRegistry.get(toolId);
    const toolName = tool?.name || toolId;

    // Step: tool call
    const toolStepId = `step-${++stepCounter}`;
    this.#onStep({
      id: toolStepId,
      type: 'tool_call',
      label: `Calling: ${toolName}`,
      reasoning: reasoning || null,
      status: 'running',
      startedAt: performance.now(),
      completedAt: null,
      toolCall: { toolId, params },
    });

    // Execute via ToolExecutor (handles confirmation)
    const result = await this.#toolExecutor.execute(toolId, params, reasoning);

    // Update step
    const stepStatus = result.status === 'success' ? 'done' : 'error';
    const stepLabel = result.status === 'success'
      ? `${toolName} \u2014 done`
      : result.status === 'rejected'
        ? `${toolName} \u2014 rejected by user`
        : `${toolName} \u2014 failed: ${result.error}`;

    this.#onStep({
      id: toolStepId,
      type: 'tool_result',
      label: stepLabel,
      reasoning: null,
      status: stepStatus,
      startedAt: performance.now(),
      completedAt: performance.now(),
      toolCall: { toolId, params },
      toolResult: result.data,
    });

    // Append to conversation
    this.#messages.push({ role: 'assistant', content: JSON.stringify(call) });

    const resultText = result.status === 'success'
      ? (typeof result.data === 'object' ? JSON.stringify(result.data) : String(result.data ?? ''))
      : `Error: ${result.error || 'rejected'}`;

    // Truncate large results
    const maxLen = 8000;
    const truncated = resultText.length > maxLen
      ? resultText.slice(0, maxLen) + `\n...(truncated, ${resultText.length} chars total)`
      : resultText;

    this.#messages.push({
      role: 'user',
      content: `Tool "${toolId}" result:\n${truncated}\n\nContinue with your task. Respond with JSON.`,
    });

    return result.status === 'success';
  }

  // ---------------------------------------------------------------------------
  // AI call
  // ---------------------------------------------------------------------------

  async #callAi() {
    const { url, headers, body } = buildAiRequest(
      this.#settings.aiProvider, this.#systemPrompt, this.#messages, this.#settings
    );

    const allMessages = body.messages || [];
    const msgSummary = allMessages.map(m => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${m.role}] ${c.length > 200 ? c.slice(0, 200) + '\u2026' : c}`;
    }).join('\n');
    this.#onLog('SEND', `POST ${url.replace(/\/\/.*@/, '//***@')} \u2014 ${allMessages.length} msgs`, msgSummary);

    let responseData;
    const startTime = performance.now();
    try {
      responseData = await this.#api.requestExternal(url, { method: 'POST', headers, body });
    } catch (err) {
      const dur = ((performance.now() - startTime) / 1000).toFixed(1);
      this.#onLog('ERR', `Request failed after ${dur}s: ${err.message}`);
      throw err;
    }
    const duration = ((performance.now() - startTime) / 1000).toFixed(1);

    const { content, inputTokens, outputTokens } = extractAiResponse(this.#settings.aiProvider, responseData);
    const tokenInfo = inputTokens != null ? ` \u2014 in: ${inputTokens}, out: ${outputTokens}` : '';
    this.#onLog('RECV', `200 OK \u2014 ${duration}s${tokenInfo}`, content || '(empty)');

    if (!content) throw new Error('AI returned empty response');

    const cleaned = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      this.#onLog('ERR', `JSON parse failed: ${e.message}`, content);
      throw new Error(`Invalid JSON from AI: ${e.message}`);
    }
  }
}
