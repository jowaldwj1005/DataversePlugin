/**
 * AI Customizer — Agent Runner
 *
 * Multi-turn agent loop that sends prompts to the AI provider,
 * handles tool calls (metadata requests), user questions, and
 * produces final view/form XML output.
 */

import { buildAiRequest, extractAiResponse, estimateTokens } from './provider-adapters.js';

let stepCounter = 0;

export class AgentRunner {
  #api;
  #cache;
  #settings;
  #onStep;
  #onLog;
  #onQuestion;
  #maxIterations;
  #aborted = false;

  // Conversation state (persists across continueWithAnswer calls)
  #systemPrompt = '';
  #messages = [];         // { role, content }[]
  #loadedEntities = new Map(); // entityName → { attributes, relationships }
  #context = null;
  #operation = null;
  #resolveQuestion = null; // resolve function for pending question

  /**
   * @param {object} api  DataverseClient
   * @param {object} cache  MetadataCache
   * @param {object} settings  AI provider settings
   * @param {object} callbacks
   * @param {(step: object) => void} callbacks.onStep  Timeline step callback
   * @param {(tag: string, summary: string, detail?: string) => void} callbacks.onLog  Debug console callback
   * @param {number} [callbacks.maxIterations=5]
   */
  constructor(api, cache, settings, { onStep, onLog, maxIterations = 5 }) {
    this.#api = api;
    this.#cache = cache;
    this.#settings = settings;
    this.#onStep = onStep;
    this.#onLog = onLog;
    this.#maxIterations = maxIterations;
  }

  /**
   * Run the agent loop.
   * @param {object} operation  The active OperationBase instance
   * @param {object} context  Operation context (entity, current XML, attributes, relationships)
   * @param {string} userPrompt
   * @returns {Promise<{ status: string, layoutxml?: string, fetchxml?: string, error?: string }>}
   */
  async run(operation, context, userPrompt) {
    this.#aborted = false;
    this.#context = context;
    this.#operation = operation;
    this.#loadedEntities.clear();

    // Store primary entity metadata
    this.#loadedEntities.set(context.entityLogicalName, {
      attributes: context.attributes,
      relationships: context.relationships,
    });

    // Build system prompt (allow override for debugging/customization)
    this.#systemPrompt = context.systemPromptOverride || operation.buildSystemPrompt(context);
    const sysTokens = estimateTokens(this.#systemPrompt);
    const userTokens = estimateTokens(userPrompt);
    this.#onLog('SEND', `System prompt: ~${sysTokens} tokens, User prompt: ~${userTokens} tokens`, this.#systemPrompt);

    // Initialize conversation
    this.#messages = [{ role: 'user', content: userPrompt }];

    return this.#loop();
  }

  /**
   * Continue after user answers a question.
   * @param {string} answer
   */
  continueWithAnswer(answer) {
    if (this.#resolveQuestion) {
      this.#resolveQuestion(answer);
      this.#resolveQuestion = null;
    }
  }

  abort() {
    this.#aborted = true;
    if (this.#resolveQuestion) {
      this.#resolveQuestion(null);
      this.#resolveQuestion = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal loop
  // ---------------------------------------------------------------------------

  async #loop() {
    for (let iteration = 0; iteration < this.#maxIterations; iteration++) {
      if (this.#aborted) return { status: 'error', error: 'Aborted by user' };

      // Send to AI
      const stepId = `step-${++stepCounter}`;
      this.#onStep({
        id: stepId,
        type: 'thinking',
        label: iteration === 0 ? 'Analyzing your request...' : 'Generating response...',
        reasoning: null,
        status: 'running',
        startedAt: performance.now(),
        completedAt: null,
      });

      let parsed;
      try {
        parsed = await this.#callAi();
      } catch (err) {
        this.#onStep({ id: stepId, type: 'error', label: `AI request failed: ${err.message}`, reasoning: null, status: 'error', startedAt: performance.now(), completedAt: performance.now() });
        return { status: 'error', error: err.message };
      }

      if (this.#aborted) return { status: 'error', error: 'Aborted by user' };

      // Update thinking step with reasoning
      this.#onStep({
        id: stepId,
        type: 'thinking',
        label: iteration === 0 ? 'Analyzed request' : 'Generated response',
        reasoning: parsed.reasoning || null,
        status: 'done',
        startedAt: performance.now(),
        completedAt: performance.now(),
      });

      // Handle status
      switch (parsed.status) {
        case 'done': {
          // Validate
          const validStepId = `step-${++stepCounter}`;
          const validation = this.#operation.validate(parsed, this.#context);

          if (!validation.valid) {
            // Critical errors — block apply, show errors
            for (const w of validation.warnings) {
              this.#onLog('ERR', w);
            }
            this.#onStep({
              id: validStepId,
              type: 'error',
              label: `Validation failed — ${validation.warnings.length} error(s)`,
              reasoning: validation.warnings.map(w => `- ${w}`).join('\n'),
              status: 'error',
              startedAt: performance.now(),
              completedAt: performance.now(),
            });
            return { status: 'error', error: 'Validation failed: ' + validation.warnings[0] };
          } else if (validation.warnings.length > 0) {
            for (const w of validation.warnings) {
              this.#onLog('WARN', w);
            }
            this.#onStep({
              id: validStepId,
              type: 'done',
              label: `Validated — ${validation.warnings.length} warning(s)`,
              reasoning: validation.warnings.map(w => `- ${w}`).join('\n'),
              status: 'done',
              startedAt: performance.now(),
              completedAt: performance.now(),
            });
          } else {
            this.#onStep({
              id: validStepId,
              type: 'done',
              label: 'Validated — all columns exist',
              reasoning: null,
              status: 'done',
              startedAt: performance.now(),
              completedAt: performance.now(),
            });
          }
          return parsed;
        }

        case 'need_metadata': {
          const entity = parsed.entity;
          if (!entity) {
            return { status: 'error', error: 'AI requested metadata but did not specify entity name' };
          }

          const metaStepId = `step-${++stepCounter}`;
          this.#onStep({
            id: metaStepId,
            type: 'tool_call',
            label: `Loading ${entity} metadata...`,
            reasoning: parsed.reasoning || null,
            status: 'running',
            startedAt: performance.now(),
            completedAt: null,
          });

          try {
            const meta = await this.#fetchEntityMetadata(entity);
            const attrCount = meta.attributes.length;
            const relCount = meta.relationships.length;

            this.#onStep({
              id: metaStepId,
              type: 'tool_result',
              label: `Loaded ${entity} — ${attrCount} attributes, ${relCount} relationships`,
              reasoning: null,
              status: 'done',
              startedAt: performance.now(),
              completedAt: performance.now(),
            });

            // Append AI's response + metadata as conversation turns
            this.#messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
            this.#messages.push({ role: 'user', content: this.#formatMetadataMessage(entity, meta) });

          } catch (err) {
            this.#onStep({
              id: metaStepId,
              type: 'error',
              label: `Failed to load ${entity}: ${err.message}`,
              reasoning: null,
              status: 'error',
              startedAt: performance.now(),
              completedAt: performance.now(),
            });
            return { status: 'error', error: `Failed to load metadata for ${entity}: ${err.message}` };
          }
          break; // Continue loop
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

          // Wait for user answer via promise
          const answer = await new Promise(resolve => {
            this.#resolveQuestion = resolve;
          });

          if (!answer || this.#aborted) {
            return { status: 'error', error: 'Aborted by user' };
          }

          // Append AI's response + user answer as conversation turns
          this.#messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
          this.#messages.push({ role: 'user', content: answer });
          break; // Continue loop
        }

        case 'error':
          return parsed;

        default:
          return { status: 'error', error: `Unknown AI response status: ${parsed.status}` };
      }
    }

    return { status: 'error', error: `Agent loop exceeded maximum iterations (${this.#maxIterations})` };
  }

  // ---------------------------------------------------------------------------
  // AI call
  // ---------------------------------------------------------------------------

  async #callAi() {
    const { url, headers, body } = buildAiRequest(
      this.#settings.aiProvider, this.#systemPrompt, this.#messages, this.#settings
    );

    // Safe logging — handle both OpenAI (body.messages) and Anthropic (body.messages without system)
    const allMessages = body.messages || [];
    const msgSummary = allMessages.map(m => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${m.role}] ${c.length > 200 ? c.slice(0, 200) + '…' : c}`;
    }).join('\n');
    this.#onLog('SEND', `POST ${url.replace(/\/\/.*@/, '//***@')} — ${allMessages.length} messages`, msgSummary);

    let responseData;
    const startTime = performance.now();
    try {
      responseData = await this.#api.requestExternal(url, { method: 'POST', headers, body });
    } catch (err) {
      const duration = ((performance.now() - startTime) / 1000).toFixed(1);
      this.#onLog('ERR', `Request failed after ${duration}s: ${err.message}`);
      throw err;
    }
    const duration = ((performance.now() - startTime) / 1000).toFixed(1);

    const { content, inputTokens, outputTokens } = extractAiResponse(this.#settings.aiProvider, responseData);
    const tokenInfo = inputTokens != null ? ` — in: ${inputTokens}, out: ${outputTokens}` : '';
    this.#onLog('RECV', `200 OK — ${duration}s${tokenInfo}`, content || '(empty response)');

    if (!content) {
      throw new Error('AI returned empty response');
    }

    // Parse JSON — strip markdown fences if present
    const cleaned = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      this.#onLog('ERR', `Failed to parse AI response as JSON: ${e.message}`, content);
      throw new Error(`Invalid JSON from AI: ${e.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Metadata fetching
  // ---------------------------------------------------------------------------

  async #fetchEntityMetadata(entityName) {
    // Check cache
    if (this.#loadedEntities.has(entityName)) {
      return this.#loadedEntities.get(entityName);
    }

    const [attributes, relationships] = await Promise.all([
      this.#cache.getAttributes(entityName),
      this.#cache.getRelationships(entityName),
    ]);

    const allRels = [
      ...(relationships.ManyToOne || []),
      ...(relationships.OneToMany || []),
    ];

    const meta = { attributes, relationships: allRels };
    this.#loadedEntities.set(entityName, meta);
    this.#onLog('META', `Loaded ${entityName}: ${attributes.length} attributes, ${allRels.length} relationships`);
    return meta;
  }

  #formatMetadataMessage(entityName, meta) {
    const attrLines = meta.attributes
      .map(a => {
        const dn = a.DisplayName?.UserLocalizedLabel?.Label || '';
        return `  ${a.LogicalName} (${a.AttributeType})${dn ? ` — "${dn}"` : ''}`;
      })
      .join('\n');

    const relLines = meta.relationships
      .map(r => {
        const dir = r.ReferencingEntity === entityName ? 'N:1' : '1:N';
        const related = dir === 'N:1' ? r.ReferencedEntity : r.ReferencingEntity;
        const lookupField = dir === 'N:1' ? r.ReferencingAttribute : r.ReferencedAttribute;
        return `  ${r.SchemaName} (${dir} → ${related}) lookup: ${lookupField || '—'}`;
      })
      .join('\n');

    return `Here are the attributes and relationships for "${entityName}":\n\nAttributes:\n${attrLines}\n\nRelationships:\n${relLines || '  (none)'}\n\nNow continue with your task. Respond with a JSON object.`;
  }
}
