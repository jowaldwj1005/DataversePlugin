/**
 * AI Customizer — All CSS styles
 * Extracted from the main module for maintainability.
 */

const CSS = 'ac';
let injected = false;

export function injectStyles() {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = `${CSS}-styles`;
  style.textContent = `
    /* Container */
    .${CSS}-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0;
      overflow: hidden;
      position: relative;
    }

    /* Unconfigured state */
    .${CSS}-unconfigured {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 8px;
      color: var(--color-text-muted);
      text-align: center;
      padding: 32px;
    }
    .${CSS}-unconfigured-icon { font-size: 2rem; }
    .${CSS}-unconfigured h3 { color: var(--color-text-bright); margin: 0; }
    .${CSS}-unconfigured p { margin: 4px 0; font-size: 0.85rem; }
    .${CSS}-unconfigured-hint { font-size: 0.75rem; opacity: 0.7; }
    .${CSS}-unconfigured-btn {
      margin-top: 12px;
      padding: 8px 20px;
      border: none;
      border-radius: 4px;
      background: var(--dvt-accent, #0078d4);
      color: #fff;
      font-size: 0.85rem;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s;
    }
    .${CSS}-unconfigured-btn:hover {
      background: var(--dvt-accent-hover, #106ebe);
    }

    /* Toolbar */
    .${CSS}-toolbar {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-border-subtle);
      background: var(--color-bg-panel);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .${CSS}-select-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .${CSS}-select-label {
      font-size: 0.68rem;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .${CSS}-select {
      padding: 4px 6px;
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      color: var(--color-text-primary);
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      min-width: 0;
    }
    .${CSS}-select:focus { border-color: var(--color-border-focus); }

    /* Entity search dropdown */
    .${CSS}-entity-search-wrap { position: relative; }
    .${CSS}-entity-input { width: 100%; box-sizing: border-box; }
    .${CSS}-entity-list {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      max-height: 240px;
      overflow-y: auto;
      background: var(--color-bg-dropdown, var(--color-bg-panel));
      border: 1px solid var(--color-border);
      border-top: none;
      border-radius: 0 0 var(--radius-sm) var(--radius-sm);
      z-index: 500;
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.3));
    }
    .${CSS}-entity-option {
      padding: 5px 8px;
      font-size: 0.78rem;
      color: var(--color-text-primary);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .${CSS}-entity-option:hover {
      background: var(--color-bg-hover);
      color: var(--color-text-bright);
    }

    /* Session bar */
    .${CSS}-session-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    /* Collapsible context (entity/type/view) */
    .${CSS}-context-details {
      flex: 1;
      min-width: 0;
    }
    .${CSS}-context-summary {
      font-size: 0.72rem;
      color: var(--color-text-muted);
      cursor: pointer;
      user-select: none;
      padding: 2px 0;
    }
    .${CSS}-context-summary:hover { color: var(--color-text-primary); }
    .${CSS}-context-body {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 4px 0 0;
    }

    .${CSS}-status {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      padding-bottom: 4px;
    }
    .${CSS}-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .${CSS}-status-connected { background: var(--color-success); }
    .${CSS}-status-disconnected { background: var(--color-error); }
    .${CSS}-status-label {
      font-size: 0.68rem;
      color: var(--color-text-muted);
      white-space: nowrap;
    }

    /* ================================================================
     * Chat Area
     * ================================================================ */
    .${CSS}-chat-area {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 0;
    }
    .${CSS}-chat-msg {
      padding: 4px 12px;
    }
    .${CSS}-chat-bubble {
      padding: 8px 10px;
      border-radius: var(--radius-md, 6px);
      font-size: 0.82rem;
      line-height: 1.5;
      max-width: 100%;
      user-select: text;
      cursor: text;
    }
    .${CSS}-chat-user .${CSS}-chat-bubble {
      background: var(--color-accent-primary);
      color: #fff;
      border-radius: var(--radius-md, 6px) var(--radius-md, 6px) 2px var(--radius-md, 6px);
      margin-left: 32px;
    }
    .${CSS}-chat-agent .${CSS}-chat-bubble {
      background: var(--color-bg-panel);
      border: 1px solid var(--color-border-subtle);
      border-radius: 2px var(--radius-md, 6px) var(--radius-md, 6px) var(--radius-md, 6px);
    }
    .${CSS}-chat-status {
      font-size: 0.72rem;
      margin-top: 6px;
      min-height: 0;
    }

    /* Agent content (rendered Markdown) */
    .${CSS}-agent-content {
      font-size: 0.82rem;
      line-height: 1.6;
      color: var(--color-text-primary);
      margin-top: 6px;
      user-select: text;
      cursor: text;
    }
    .${CSS}-agent-content p { margin: 4px 0; }
    .${CSS}-agent-content ul { margin: 4px 0 4px 8px; padding-left: 12px; }
    .${CSS}-agent-content li { margin: 2px 0; }
    .${CSS}-agent-content strong { color: var(--color-text-bright); }
    .${CSS}-agent-content em { color: var(--color-text-muted); }
    .${CSS}-agent-content code {
      background: var(--color-bg-input);
      padding: 1px 4px;
      border-radius: 2px;
      font-size: 0.78rem;
    }
    .${CSS}-agent-data {
      margin-top: 6px;
      font-size: 0.72rem;
    }
    .${CSS}-agent-data summary {
      cursor: pointer;
      color: var(--color-text-muted);
    }
    .${CSS}-agent-data pre {
      margin: 4px 0;
      padding: 6px;
      background: var(--color-bg-input);
      border-radius: var(--radius-sm);
      overflow-x: auto;
      font-size: 0.68rem;
      max-height: 200px;
      overflow-y: auto;
    }

    /* Slash command palette */
    .${CSS}-palette {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      max-height: 240px;
      overflow-y: auto;
      background: var(--color-bg-panel);
      border: 1px solid var(--color-border);
      border-bottom: none;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      box-shadow: var(--shadow-lg);
      z-index: 100;
    }
    .${CSS}-palette-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 12px;
      cursor: pointer;
      font-size: 0.82rem;
    }
    .${CSS}-palette-item:hover,
    .${CSS}-palette-item.selected {
      background: var(--color-bg-hover, rgba(255,255,255,0.06));
    }
    .${CSS}-palette-cmd {
      font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', monospace);
      font-weight: 600;
      color: var(--color-accent-primary);
      min-width: 90px;
      flex-shrink: 0;
    }
    .${CSS}-palette-desc {
      color: var(--color-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* System messages (slash command output) */
    .${CSS}-system-msg {
      padding: 8px 14px;
      margin: 4px 12px;
      background: var(--color-bg-sidebar, rgba(255,255,255,0.03));
      border-left: 3px solid var(--color-accent-secondary, #888);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      font-size: 0.82rem;
      color: var(--color-text-secondary);
    }
    .${CSS}-system-msg p { margin: 4px 0; }
    .${CSS}-system-msg strong { color: var(--color-text-primary); }
    .${CSS}-system-msg code {
      background: var(--color-bg-input);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.78rem;
    }

    /* Input bar (fixed at bottom) */
    .${CSS}-input-bar {
      flex-shrink: 0;
      padding: 8px 12px;
      border-top: 1px solid var(--color-border);
      background: var(--color-bg-panel);
      position: relative;
    }
    .${CSS}-prompt-input {
      width: 100%;
      padding: 6px 8px;
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      color: var(--color-text-primary);
      border-radius: var(--radius-sm);
      font-family: inherit;
      font-size: 0.82rem;
      resize: vertical;
      min-height: 36px;
      box-sizing: border-box;
    }
    .${CSS}-prompt-input:focus { border-color: var(--color-border-focus); outline: none; }
    .${CSS}-prompt-input::placeholder { color: var(--color-text-disabled); }
    .${CSS}-input-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    .${CSS}-token-estimate {
      font-size: 0.72rem;
      color: var(--color-text-muted);
    }
    .${CSS}-prompt-hint {
      font-size: 0.68rem;
      color: var(--color-text-disabled);
      margin-left: auto;
    }

    /* Responses API inline toggles */
    .${CSS}-responses-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 4px;
      padding: 2px 0;
    }
    .${CSS}-responses-group {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .${CSS}-responses-label {
      font-size: 0.68rem;
      color: var(--color-text-muted);
      margin-right: 4px;
      white-space: nowrap;
    }
    .${CSS}-responses-opt {
      padding: 1px 6px;
      font-size: 0.66rem;
      border: 1px solid var(--color-border);
      background: transparent;
      color: var(--color-text-secondary);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .${CSS}-responses-opt:hover {
      background: var(--color-bg-hover);
    }
    .${CSS}-responses-opt.active {
      background: var(--color-accent);
      color: var(--color-bg);
      border-color: var(--color-accent);
    }

    /* Buttons */
    .${CSS}-btn {
      padding: 4px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-family: inherit;
      font-size: 0.78rem;
      cursor: pointer;
      background: var(--color-bg-panel);
      color: var(--color-text-primary);
      transition: background var(--transition-fast, 0.1s);
    }
    .${CSS}-btn:hover { background: var(--color-bg-hover); }
    .${CSS}-btn:disabled { opacity: 0.5; cursor: default; }
    .${CSS}-btn-primary {
      background: var(--color-accent-primary);
      color: #fff;
      border-color: var(--color-accent-primary);
    }
    .${CSS}-btn-primary:hover { background: var(--color-accent-primary-hover, var(--color-accent-primary)); }
    .${CSS}-btn-secondary { background: var(--color-bg-panel); }
    .${CSS}-btn-danger {
      color: var(--color-error);
      border-color: var(--color-error);
      background: transparent;
    }
    .${CSS}-btn-danger:hover { background: var(--color-error-bg, rgba(244,71,71,0.1)); }
    .${CSS}-btn-tiny {
      padding: 2px 6px;
      font-size: 0.7rem;
    }

    /* (chat-area replaces the old main-area — see Chat Area section above) */

    /* ================================================================
     * Agent Timeline
     * ================================================================ */
    .${CSS}-timeline {
      padding: 8px 12px;
    }
    .${CSS}-timeline:empty { display: none; }
    .${CSS}-timeline-step {
      display: flex;
      flex-wrap: wrap;
      gap: 0 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .${CSS}-timeline-step:last-child { border-bottom: none; }
    .${CSS}-timeline-icon {
      width: 16px;
      flex-shrink: 0;
      text-align: center;
      font-size: 0.72rem;
      line-height: 1.5;
    }
    .${CSS}-timeline-label {
      flex: 1;
      min-width: 0;
      font-size: 0.78rem;
      color: var(--color-text-bright);
      line-height: 1.5;
    }
    .${CSS}-timeline-duration {
      font-size: 0.68rem;
      color: var(--color-text-disabled);
      flex-shrink: 0;
      line-height: 1.5;
    }
    .${CSS}-timeline-reasoning {
      width: 100%;
      padding: 2px 0 0 24px;
      font-size: 0.72rem;
      color: var(--color-text-muted);
      line-height: 1.5;
    }
    .${CSS}-timeline-reasoning code {
      background: var(--color-bg-input);
      padding: 1px 3px;
      border-radius: 2px;
      font-size: 0.68rem;
    }
    .${CSS}-timeline-reasoning strong {
      color: var(--color-text-primary);
    }

    /* Spinner animation */
    .${CSS}-timeline-spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--color-border-subtle);
      border-top-color: var(--color-accent-primary);
      border-radius: 50%;
      animation: ${CSS}-spin 0.6s linear infinite;
    }
    @keyframes ${CSS}-spin {
      to { transform: rotate(360deg); }
    }

    /* Step status colors */
    .${CSS}-timeline-step-done .${CSS}-timeline-icon { color: var(--color-success); }
    .${CSS}-timeline-step-error .${CSS}-timeline-icon { color: var(--color-error); }
    .${CSS}-timeline-step-waiting .${CSS}-timeline-icon { color: var(--color-warning); }
    .${CSS}-timeline-step-error .${CSS}-timeline-label { color: var(--color-error); }

    /* Question input inline in timeline */
    .${CSS}-timeline-question-input {
      width: 100%;
      margin: 4px 0 0 24px;
      display: flex;
      gap: 4px;
    }
    .${CSS}-timeline-question-input input {
      flex: 1;
      padding: 4px 6px;
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      color: var(--color-text-primary);
      border-radius: var(--radius-sm);
      font-family: inherit;
      font-size: 0.78rem;
    }
    .${CSS}-timeline-question-input input:focus { border-color: var(--color-border-focus); outline: none; }

    /* Tool call expandable details */
    .${CSS}-timeline-tool-details {
      width: 100%;
      padding-left: 24px;
      margin-top: 2px;
    }
    .${CSS}-timeline-tool-details summary {
      font-size: 0.68rem;
      color: var(--color-text-disabled);
      cursor: pointer;
    }
    .${CSS}-timeline-tool-details summary:hover { color: var(--color-text-muted); }
    .${CSS}-timeline-tool-details pre {
      font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
      font-size: 0.65rem;
      line-height: 1.4;
      background: var(--color-bg-input);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-sm);
      padding: 4px 6px;
      margin: 2px 0 0;
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--color-text-muted);
    }

    /* Responses API metadata (reasoning, web search, citations) */
    .${CSS}-timeline-responses-meta {
      width: 100%;
      padding-left: 24px;
      margin-top: 2px;
    }
    .${CSS}-timeline-responses-meta summary {
      font-size: 0.68rem;
      color: var(--color-accent-secondary, var(--color-text-muted));
      cursor: pointer;
      user-select: none;
    }
    .${CSS}-timeline-responses-meta summary:hover { color: var(--color-text-primary); }
    .${CSS}-timeline-responses-inner {
      padding: 4px 0 2px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .${CSS}-timeline-responses-reasoning {
      font-size: 0.7rem;
      color: var(--color-text-muted);
      line-height: 1.4;
      font-style: italic;
    }
    .${CSS}-timeline-responses-search,
    .${CSS}-timeline-responses-citation {
      font-size: 0.68rem;
      color: var(--color-text-secondary);
      line-height: 1.4;
    }
    .${CSS}-timeline-responses-search a,
    .${CSS}-timeline-responses-citation a {
      color: var(--color-accent-secondary, var(--color-accent));
      text-decoration: none;
    }
    .${CSS}-timeline-responses-search a:hover,
    .${CSS}-timeline-responses-citation a:hover {
      text-decoration: underline;
    }
    .${CSS}-responses-search-icon {
      font-size: 0.62rem;
    }

    /* ================================================================
     * Diff Panel
     * ================================================================ */
    .${CSS}-diff-panel {
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .${CSS}-diff-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      background: var(--color-bg-sidebar, var(--color-bg-panel));
      border-bottom: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    }
    .${CSS}-diff-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-text-bright);
      flex: 1;
    }
    .${CSS}-diff-body { padding: 0; }
    .${CSS}-diff-section { margin-bottom: 2px; }
    .${CSS}-diff-section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 12px;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--color-text-muted);
      background: var(--color-bg-panel);
      border-bottom: 1px solid var(--color-border-subtle);
    }

    /* Diff lines */
    .ac-diff-pre {
      margin: 0;
      padding: 0;
      font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
    }
    .ac-diff-line {
      display: flex;
      padding: 0 12px 0 0;
      min-height: 1.5em;
    }
    .ac-diff-line-del { background: var(--color-error-bg, rgba(244,71,71,0.12)); }
    .ac-diff-line-add { background: var(--color-success-bg, rgba(78,201,176,0.12)); }
    .ac-diff-gutter {
      width: 20px;
      flex-shrink: 0;
      text-align: center;
      color: var(--color-text-disabled);
      user-select: none;
    }
    .ac-diff-line-del .ac-diff-gutter { color: var(--color-error); }
    .ac-diff-line-add .ac-diff-gutter { color: var(--color-success); }
    .ac-diff-text { white-space: pre; }
    .ac-diff-word-change {
      background: rgba(255,255,100,0.25);
      border-radius: 2px;
    }

    /* Fullscreen diff overlay */
    .${CSS}-diff-fullscreen {
      position: fixed !important;
      inset: 0;
      z-index: var(--z-modal, 400);
      background: var(--color-bg-base);
      overflow-y: auto;
    }
    .${CSS}-diff-fullscreen .${CSS}-diff-header {
      position: sticky;
      top: 0;
      z-index: 2;
    }

    /* Success banner */
    .${CSS}-success-banner {
      padding: 8px 12px;
      background: var(--color-success-bg, rgba(78,201,176,0.15));
      border-left: 3px solid var(--color-success);
      color: var(--color-success);
      font-size: 0.78rem;
      font-weight: 500;
      animation: ${CSS}-fade-in 0.3s ease;
    }
    @keyframes ${CSS}-fade-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Tool Confirmation */
    .${CSS}-confirm {
      margin: 8px 12px;
      padding: 10px;
      background: var(--color-bg-panel);
      border: 1px solid var(--color-warning);
      border-left: 3px solid var(--color-warning);
      border-radius: var(--radius-md, 6px);
      animation: ${CSS}-fade-in 0.2s ease;
    }
    .${CSS}-confirm-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--color-text-bright);
      margin-bottom: 6px;
    }
    .${CSS}-confirm-icon { font-size: 1rem; }
    .${CSS}-confirm-params {
      font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
      font-size: 0.7rem;
      background: var(--color-bg-input);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-sm);
      padding: 6px 8px;
      margin: 4px 0;
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
      color: var(--color-text-primary);
    }
    .${CSS}-confirm-reasoning {
      font-size: 0.72rem;
      color: var(--color-text-muted);
      margin: 4px 0;
    }
    .${CSS}-confirm-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    /* Action bar */
    .${CSS}-action-bar {
      display: flex;
      gap: 6px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border-subtle);
      background: var(--color-bg-panel);
      user-select: none;
      cursor: default;
    }

    /* System Prompt Editor Overlay */
    .${CSS}-sysprompt-overlay {
      position: absolute;
      inset: 0;
      background: var(--color-bg-overlay, rgba(0,0,0,0.5));
      z-index: var(--z-modal, 400);
      display: flex;
      align-items: stretch;
      padding: 12px;
    }
    .${CSS}-sysprompt-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--color-bg-panel);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md, 4px);
      padding: 12px;
      overflow: hidden;
    }
    .${CSS}-sysprompt-header {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .${CSS}-sysprompt-textarea {
      flex: 1;
      min-height: 0;
      padding: 8px;
      background: var(--color-bg-input);
      border: 1px solid var(--color-border);
      color: var(--color-text-primary);
      border-radius: var(--radius-sm);
      font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
      font-size: 0.72rem;
      line-height: 1.5;
      resize: none;
      white-space: pre;
      overflow: auto;
    }
    .${CSS}-sysprompt-textarea:focus {
      border-color: var(--color-border-focus);
      outline: none;
    }

    /* ================================================================
     * Debug Console (collapsible)
     * ================================================================ */
    .${CSS}-console {
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      background: var(--color-bg-base);
      border-top: 1px solid var(--color-border);
    }
    .${CSS}-console-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: var(--color-bg-sidebar, var(--color-bg-panel));
      border-bottom: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
      cursor: pointer;
      user-select: none;
    }
    .${CSS}-console-header:hover { background: var(--color-bg-hover); }
    .${CSS}-console-chevron {
      font-size: 0.6rem;
      color: var(--color-text-disabled);
      transition: transform 0.15s ease;
    }
    .${CSS}-console-expanded .${CSS}-console-chevron { transform: rotate(90deg); }
    .${CSS}-console-title {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--color-text-bright);
      white-space: nowrap;
    }
    .${CSS}-console-filters {
      display: flex;
      gap: 2px;
    }
    .${CSS}-console-filter {
      padding: 1px 6px;
      font-size: 0.65rem;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
    }
    .${CSS}-console-filter:hover { color: var(--color-text-primary); }
    .${CSS}-console-filter-active {
      background: var(--color-bg-active, rgba(255,255,255,0.08));
      color: var(--color-text-bright);
      border-color: var(--color-border-subtle);
    }
    .${CSS}-console-actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
    .${CSS}-console-body {
      overflow: hidden;
      transition: max-height 0.25s ease;
      max-height: 35vh;
    }
    .${CSS}-console-collapsed .${CSS}-console-body {
      max-height: 0 !important;
      overflow: hidden;
    }

    /* Log entries */
    .${CSS}-console-log {
      overflow-y: auto;
      max-height: 35vh;
      padding: 4px 0;
      font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
      font-size: 0.72rem;
      line-height: 1.5;
    }
    .${CSS}-log-entry {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 1px 12px;
    }
    .${CSS}-log-entry:hover { background: var(--color-bg-hover); }
    .${CSS}-log-time {
      color: var(--color-text-disabled);
      flex-shrink: 0;
      font-size: 0.68rem;
    }
    .${CSS}-log-tag {
      font-weight: 600;
      flex-shrink: 0;
      font-size: 0.68rem;
    }
    .${CSS}-log-summary {
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .${CSS}-log-expand {
      background: none;
      border: none;
      color: var(--color-text-disabled);
      cursor: pointer;
      font-size: 0.6rem;
      padding: 0 2px;
      flex-shrink: 0;
    }
    .${CSS}-log-expand:hover { color: var(--color-text-primary); }
    .${CSS}-log-detail {
      margin: 0;
      padding: 4px 12px 4px 80px;
      font-size: 0.68rem;
      color: var(--color-text-muted);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
      background: var(--color-bg-panel);
      border-left: 2px solid var(--color-border-subtle);
    }

    /* ================================================================
       Skill Drawer
       ================================================================ */
    .${CSS}-skill-drawer {
      position: absolute;
      top: 0;
      left: 0;
      width: 300px;
      height: 100%;
      background: var(--color-bg-base);
      border-right: 1px solid var(--color-border-subtle);
      box-shadow: 4px 0 12px rgba(0,0,0,0.3);
      z-index: 50;
      display: flex;
      flex-direction: column;
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      overflow: hidden;
    }
    .${CSS}-skill-drawer.open { transform: translateX(0); }

    .${CSS}-skill-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-bottom: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }
    .${CSS}-skill-drawer-header h3 {
      margin: 0;
      font-size: 0.85rem;
      color: var(--color-text-bright);
    }
    .${CSS}-skill-drawer-actions {
      display: flex;
      gap: 4px;
    }
    .${CSS}-skill-drawer-actions button {
      background: none;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 0.9rem;
      padding: 2px 4px;
      border-radius: var(--radius-sm);
    }
    .${CSS}-skill-drawer-actions button:hover {
      color: var(--color-text-bright);
      background: var(--color-bg-hover);
    }

    .${CSS}-skill-tags-bar {
      display: flex;
      gap: 4px;
      padding: 6px 10px;
      overflow-x: auto;
      flex-shrink: 0;
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .${CSS}-skill-tag-chip {
      padding: 2px 8px;
      font-size: 0.65rem;
      border-radius: 10px;
      border: 1px solid var(--color-border-subtle);
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .${CSS}-skill-tag-chip:hover { border-color: var(--color-text-muted); }
    .${CSS}-skill-tag-chip.active {
      background: var(--color-accent);
      color: var(--color-bg);
      border-color: var(--color-accent);
    }

    .${CSS}-skill-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .${CSS}-skill-empty {
      color: var(--color-text-muted);
      text-align: center;
      padding: 32px 16px;
      font-size: 0.78rem;
      line-height: 1.5;
    }

    .${CSS}-skill-card {
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-sm);
      margin-bottom: 8px;
      overflow: hidden;
      background: var(--color-bg-panel);
    }
    .${CSS}-skill-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      cursor: pointer;
      font-size: 0.78rem;
    }
    .${CSS}-skill-card-header:hover { background: var(--color-bg-hover); }
    .${CSS}-skill-card-name {
      flex: 1;
      font-weight: 500;
      color: var(--color-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .${CSS}-skill-card-toggle {
      position: relative;
      width: 28px;
      height: 16px;
      border-radius: 8px;
      background: var(--color-border-subtle);
      border: none;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .${CSS}-skill-card-toggle.on { background: var(--color-accent); }
    .${CSS}-skill-card-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: white;
      transition: left 0.15s;
    }
    .${CSS}-skill-card-toggle.on::after { left: 14px; }

    .${CSS}-skill-card-meta {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      padding: 2px 10px 6px;
    }
    .${CSS}-skill-card-meta-tag {
      font-size: 0.62rem;
      padding: 2px 6px;
      border-radius: 8px;
      background: var(--color-bg-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border-subtle);
    }
    .${CSS}-skill-card-trigger {
      padding: 2px 10px 6px;
      font-size: 0.68rem;
      color: var(--color-text-muted);
      font-style: italic;
      line-height: 1.3;
    }

    .${CSS}-skill-card-body {
      display: none;
      padding: 8px 10px;
      border-top: 1px solid var(--color-border-subtle);
      font-size: 0.75rem;
      line-height: 1.5;
      color: var(--color-text-secondary);
      max-height: 300px;
      overflow-y: auto;
    }
    .${CSS}-skill-card-body.open { display: block; }
    .${CSS}-skill-card-body code {
      background: var(--color-bg-input);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.7rem;
    }
    .${CSS}-skill-card-body pre {
      margin: 6px 0;
      padding: 8px;
      background: var(--color-bg-input);
      border-radius: var(--radius-sm);
      font-size: 0.68rem;
      overflow-x: auto;
      line-height: 1.4;
    }
    .${CSS}-skill-card-body strong {
      color: var(--color-text-bright);
    }
    .${CSS}-skill-card-body-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--color-border-subtle);
    }
    .${CSS}-skill-card-body-actions button {
      font-size: 0.7rem;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--color-border-subtle);
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;
    }
    .${CSS}-skill-card-body-actions button:hover {
      color: var(--color-text-bright);
      border-color: var(--color-text-muted);
    }
    .${CSS}-skill-card-body-actions button.danger:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    /* Skill edit form */
    .${CSS}-skill-form {
      padding: 10px;
      border-top: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
      max-height: 55%;
      overflow-y: auto;
      background: var(--color-bg-panel);
    }
    .${CSS}-skill-form label {
      display: block;
      font-size: 0.68rem;
      color: var(--color-text-muted);
      margin-bottom: 2px;
      margin-top: 6px;
    }
    .${CSS}-skill-form label:first-child { margin-top: 0; }
    .${CSS}-skill-form input,
    .${CSS}-skill-form textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 6px;
      font-size: 0.72rem;
      background: var(--color-bg-input);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-sm);
      color: var(--color-text-primary);
      font-family: inherit;
    }
    .${CSS}-skill-form textarea {
      min-height: 80px;
      resize: vertical;
      font-family: monospace;
    }
    .${CSS}-skill-form-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
  `;
  document.head.appendChild(style);
}
