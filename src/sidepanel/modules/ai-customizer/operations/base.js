/**
 * AI Customizer — Operation base class
 *
 * Abstract interface for customization operations (views, forms, subgrids, etc.).
 * Each operation type knows how to build its UI selectors, system prompt,
 * validate AI output, and apply/revert changes.
 */

export class OperationBase {
  constructor(api, cache, settings) {
    this.api = api;
    this.cache = cache;
    this.settings = settings;
  }

  /** @returns {string} Operation type id ('view', 'form', etc.) */
  get id() { throw new Error('abstract'); }

  /** @returns {string} Human-readable label */
  get label() { throw new Error('abstract'); }

  /**
   * Build operation-specific selector UI (view picker, form picker, etc.)
   * into the given container. Call onReady(context) when user has selected a target.
   * @param {HTMLElement} container
   * @param {(context: object) => void} onReady
   */
  buildSelectorUI(container, onReady) { throw new Error('abstract'); }

  /**
   * Build the system prompt for this operation type.
   * @param {object} context  Operation-specific context (entity, current XML, etc.)
   * @returns {string}
   */
  buildSystemPrompt(context) { throw new Error('abstract'); }

  /**
   * Validate AI output before showing diff.
   * @param {object} output  Parsed AI response (layoutxml, fetchxml, etc.)
   * @param {object} context
   * @returns {{ valid: boolean, warnings: string[] }}
   */
  validate(output, context) { return { valid: true, warnings: [] }; }

  /**
   * Apply changes to Dataverse.
   * @param {object} output  The AI-generated changes
   * @param {boolean} publish  Whether to publish after applying
   * @param {(tag: string, summary: string, detail?: string) => void} log  Logger callback
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async apply(output, publish, log) { throw new Error('abstract'); }

  /**
   * Revert to the backup state.
   * @param {(tag: string, summary: string, detail?: string) => void} log
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async revert(log) { throw new Error('abstract'); }

  /** @returns {boolean} Whether a backup exists to revert to */
  get canRevert() { return false; }
}
