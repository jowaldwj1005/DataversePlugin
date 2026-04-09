/**
 * Dataverse Agent — Tool Executor
 *
 * Executes tools with human-in-the-loop confirmation for destructive actions.
 * Manages auto-approve state per session.
 */

export class ToolExecutor {
  #registry;
  #api;
  #cache;
  #onConfirmation;  // (tool, params, reasoning) => Promise<boolean>
  #onLog;

  /**
   * @param {Object} registry   ToolRegistry instance
   * @param {Object} api        DataverseClient
   * @param {Object} cache      MetadataCache
   * @param {Object} callbacks
   * @param {(tool: Object, params: Object, reasoning: string) => Promise<boolean>} callbacks.onConfirmation
   * @param {(tag: string, summary: string, detail?: string) => void} callbacks.onLog
   */
  constructor(registry, api, cache, { onConfirmation, onLog }) {
    this.#registry = registry;
    this.#api = api;
    this.#cache = cache;
    this.#onConfirmation = onConfirmation;
    this.#onLog = onLog;
  }

  /**
   * Execute a tool by ID with given parameters.
   * Handles confirmation flow for destructive tools.
   *
   * @param {string} toolId
   * @param {Object} params
   * @param {string} reasoning  Agent's reasoning for this call
   * @returns {Promise<{ status: 'success'|'rejected'|'error', data?: any, error?: string }>}
   */
  async execute(toolId, params, reasoning) {
    const tool = this.#registry.get(toolId);
    if (!tool) {
      return { status: 'error', error: `Unknown tool: ${toolId}` };
    }

    if (!tool.handler) {
      return { status: 'error', error: `Tool "${toolId}" has no handler (skill-based tools are not yet executable)` };
    }

    // Check confirmation requirement
    if (tool.requiresConfirmation && !tool.autoApproved) {
      this.#onLog('META', `Tool "${tool.name}" requires confirmation`, `Params: ${JSON.stringify(params, null, 2)}\nReasoning: ${reasoning}`);

      const approved = await this.#onConfirmation(tool, params, reasoning);
      if (!approved) {
        this.#onLog('META', `Tool "${tool.name}" rejected by user`);
        return { status: 'rejected', error: 'User declined the tool call' };
      }
    }

    // Execute
    const startTime = performance.now();
    this.#onLog('META', `Executing tool: ${tool.name}`, JSON.stringify(params, null, 2));

    try {
      const ctx = {
        api: this.#api,
        cache: this.#cache,
        log: this.#onLog,
      };
      const result = await tool.handler(params, ctx);
      const duration = ((performance.now() - startTime) / 1000).toFixed(1);
      this.#onLog('META', `Tool "${tool.name}" completed — ${duration}s`, typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
      return { status: 'success', data: result };
    } catch (err) {
      this.#onLog('ERR', `Tool "${tool.name}" failed: ${err.message}`);
      return { status: 'error', error: err.message };
    }
  }

  /**
   * Toggle auto-approve for a tool (session-only).
   * @param {string} toolId
   * @param {boolean} approved
   */
  setAutoApprove(toolId, approved) {
    const tool = this.#registry.get(toolId);
    if (tool && tool.autoApprovable) {
      tool.autoApproved = approved;
    }
  }
}
