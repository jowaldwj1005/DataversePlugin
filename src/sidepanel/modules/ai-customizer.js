/**
 * AI Customizer v3 — Conversational Dataverse customization via BYOK LLM
 *
 * Chat-based UI with stateful context. Each exchange builds on the previous.
 * Supports view modification and creation.
 */

import { injectStyles } from './ai-customizer/styles.js';
import { estimateTokens } from './ai-customizer/provider-adapters.js';
import { renderXmlDiff } from './ai-customizer/xml-diff.js';
import { AgentRunner } from './ai-customizer/agent-runner.js';
import { AgentTimeline } from './ai-customizer/agent-timeline.js';
import { ViewOperation } from './ai-customizer/operations/view-operation.js';

const CSS = 'ac';
const STORAGE_KEY = 'dvt-settings';
const MAX_LOG_ENTRIES = 1000;

const TAG_COLORS = {
  META: '--color-info', SEND: '--color-accent-primary', RECV: '--color-success',
  DIFF: '--color-warning', WRITE: '--color-accent-secondary', PUB: '--color-success',
  ERR: '--color-error', WARN: '--color-warning',
};

let msgCounter = 0;

export default class AiCustomizer {
  #settings = {};
  #entities = [];
  #entitiesSorted = [];
  #selectedEntity = null;
  #activeOp = null;
  #opContext = null;
  #runner = null;
  #debugLog = [];
  #activeFilter = 'all';
  #autoScroll = true;
  #consoleExpanded = true;
  #systemPromptOverride = null;

  // DOM refs
  #entitySelect = null;
  #selectorContainer = null;
  #chatArea = null;
  #promptTextarea = null;
  #tokenEstimate = null;
  #sendBtn = null;
  #logContainer = null;

  constructor(container, apiClient, metadataCache) {
    this.container = container;
    this.api = apiClient;
    this.cache = metadataCache;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async render() {
    this.container.innerHTML = '';
    this.container.classList.add(`${CSS}-container`);
    injectStyles();

    const stored = await chrome.storage.local.get(STORAGE_KEY);
    this.#settings = stored[STORAGE_KEY] || {};

    if (!this.#settings.aiProvider || !this.#settings.aiEndpoint || !this.#settings.aiApiKey) {
      this.container.innerHTML = `
        <div class="${CSS}-unconfigured">
          <div class="${CSS}-unconfigured-icon">&#10024;</div>
          <h3>AI Customizer</h3>
          <p>Configure your AI provider in the <strong>Settings</strong> tab to get started.</p>
          <p class="${CSS}-unconfigured-hint">Supports OpenAI, Azure OpenAI, Anthropic, or any OpenAI-compatible endpoint.</p>
        </div>`;
      return;
    }

    this.#activeOp = new ViewOperation(this.api, this.cache, this.#settings);

    this._buildToolbar();
    this._buildChatArea();
    this._buildDebugConsole();
    this._buildInputBar();

    this._log('META', 'Loading entities...');
    try {
      this.#entities = await this.cache.getEntities();
      this.#entitiesSorted = [...this.#entities].sort((a, b) => {
        const aName = a.DisplayName?.UserLocalizedLabel?.Label || a.LogicalName;
        const bName = b.DisplayName?.UserLocalizedLabel?.Label || b.LogicalName;
        return aName.localeCompare(bName);
      });
      this._log('META', `${this.#entities.length} entities loaded`);
    } catch (err) {
      this._log('ERR', `Failed to load entities: ${err.message}`);
    }
  }

  onHide() {}

  // =========================================================================
  // Toolbar
  // =========================================================================

  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = `${CSS}-toolbar`;

    // Entity search
    const entityGroup = document.createElement('div');
    entityGroup.className = `${CSS}-select-group ${CSS}-entity-search-wrap`;
    const entityLabel = document.createElement('label');
    entityLabel.className = `${CSS}-select-label`;
    entityLabel.textContent = 'Entity';
    this.#entitySelect = document.createElement('input');
    this.#entitySelect.type = 'text';
    this.#entitySelect.className = `${CSS}-select ${CSS}-entity-input`;
    this.#entitySelect.placeholder = 'Search entity...';
    this.#entitySelect.autocomplete = 'off';
    const entityList = document.createElement('div');
    entityList.className = `${CSS}-entity-list`;
    entityList.style.display = 'none';
    this.#entitySelect.addEventListener('input', () => this._filterEntityList(entityList));
    this.#entitySelect.addEventListener('focus', () => this._filterEntityList(entityList));
    this.#entitySelect.addEventListener('blur', () => setTimeout(() => { entityList.style.display = 'none'; }, 180));
    entityGroup.append(entityLabel, this.#entitySelect, entityList);

    // Operation-specific selectors
    this.#selectorContainer = document.createElement('div');
    this.#selectorContainer.style.cssText = 'display:contents;';
    this.#activeOp.buildSelectorUI(this.#selectorContainer, (ctx) => this._onTargetReady(ctx));

    // Status dot
    const status = document.createElement('div');
    status.className = `${CSS}-status`;
    const dot = document.createElement('span');
    dot.className = `${CSS}-status-dot ${CSS}-status-connected`;
    const label = document.createElement('span');
    label.className = `${CSS}-status-label`;
    label.textContent = `${this.#settings.aiProvider} \u00B7 ${this.#settings.aiModel || 'default'}`;
    status.append(dot, label);

    toolbar.append(entityGroup, this.#selectorContainer, status);
    this.container.appendChild(toolbar);
  }

  _filterEntityList(listEl) {
    const filter = (this.#entitySelect.value || '').toLowerCase();
    listEl.innerHTML = '';
    const matches = this.#entitiesSorted.filter(e => {
      const dn = (e.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase();
      return e.LogicalName.toLowerCase().includes(filter) || dn.includes(filter);
    }).slice(0, 60);
    if (!matches.length) { listEl.style.display = 'none'; return; }
    for (const ent of matches) {
      const item = document.createElement('div');
      item.className = `${CSS}-entity-option`;
      const dn = ent.DisplayName?.UserLocalizedLabel?.Label;
      item.textContent = dn ? `${dn} (${ent.LogicalName})` : ent.LogicalName;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.#entitySelect.value = item.textContent;
        listEl.style.display = 'none';
        this._selectEntity(ent);
      });
      listEl.appendChild(item);
    }
    listEl.style.display = '';
  }

  async _selectEntity(ent) {
    this.#selectedEntity = ent;
    this.#activeOp.setEntity(ent);
    this.#opContext = null;
    this._log('META', `Loading views for ${ent.LogicalName}...`);
    try {
      const views = await this.#activeOp.loadViews();
      this._log('META', `${views.length} views found`);
    } catch (err) {
      this._log('ERR', `Failed to load views: ${err.message}`);
    }
  }

  _onTargetReady(context) {
    this.#opContext = context;
    this._log('META', `"${context.viewName}" selected`,
      `layoutxml: ${context.layoutxml?.length || 0} chars\nfetchxml: ${context.fetchxml?.length || 0} chars`);
  }

  // =========================================================================
  // Chat Area
  // =========================================================================

  _buildChatArea() {
    this.#chatArea = document.createElement('div');
    this.#chatArea.className = `${CSS}-chat-area`;
    this.container.appendChild(this.#chatArea);
  }

  _addUserMessage(text) {
    const msg = document.createElement('div');
    msg.className = `${CSS}-chat-msg ${CSS}-chat-user`;
    const bubble = document.createElement('div');
    bubble.className = `${CSS}-chat-bubble`;
    bubble.textContent = text;
    msg.appendChild(bubble);
    this.#chatArea.appendChild(msg);
    this._scrollChat();
    return msg;
  }

  _addAgentMessage() {
    const id = `agent-msg-${++msgCounter}`;
    const msg = document.createElement('div');
    msg.className = `${CSS}-chat-msg ${CSS}-chat-agent`;
    msg.id = id;
    const bubble = document.createElement('div');
    bubble.className = `${CSS}-chat-bubble`;

    // Timeline container (inside bubble)
    const timelineEl = document.createElement('div');
    bubble.appendChild(timelineEl);

    // Diff container (hidden until result)
    const diffEl = document.createElement('div');
    diffEl.className = `${CSS}-diff-panel`;
    diffEl.style.display = 'none';
    bubble.appendChild(diffEl);

    // Action bar (hidden until result)
    const actionBar = document.createElement('div');
    actionBar.className = `${CSS}-action-bar`;
    actionBar.style.display = 'none';
    bubble.appendChild(actionBar);

    // Status line
    const statusLine = document.createElement('div');
    statusLine.className = `${CSS}-chat-status`;
    bubble.appendChild(statusLine);

    msg.appendChild(bubble);
    this.#chatArea.appendChild(msg);
    this._scrollChat();

    return { id, element: msg, bubble, timelineEl, diffEl, actionBar, statusLine };
  }

  _scrollChat() {
    requestAnimationFrame(() => {
      this.#chatArea.scrollTop = this.#chatArea.scrollHeight;
    });
  }

  // =========================================================================
  // Input Bar (fixed at bottom)
  // =========================================================================

  _buildInputBar() {
    const bar = document.createElement('div');
    bar.className = `${CSS}-input-bar`;

    this.#promptTextarea = document.createElement('textarea');
    this.#promptTextarea.className = `${CSS}-prompt-input`;
    this.#promptTextarea.placeholder = 'Describe what you want to change...';
    this.#promptTextarea.rows = 2;
    this.#promptTextarea.addEventListener('input', () => this._updateTokenEstimate());
    this.#promptTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._onSend();
      }
    });

    const controls = document.createElement('div');
    controls.className = `${CSS}-input-controls`;

    this.#sendBtn = document.createElement('button');
    this.#sendBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    this.#sendBtn.textContent = 'Send';
    this.#sendBtn.addEventListener('click', () => this._onSend());

    const sysPromptBtn = document.createElement('button');
    sysPromptBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    sysPromptBtn.textContent = 'System Prompt';
    sysPromptBtn.addEventListener('click', () => this._showSystemPromptEditor());

    this.#tokenEstimate = document.createElement('span');
    this.#tokenEstimate.className = `${CSS}-token-estimate`;

    const hint = document.createElement('span');
    hint.className = `${CSS}-prompt-hint`;
    hint.textContent = 'Ctrl+Enter';

    controls.append(this.#sendBtn, sysPromptBtn, this.#tokenEstimate, hint);
    bar.append(this.#promptTextarea, controls);
    this.container.appendChild(bar);
  }

  _updateTokenEstimate() {
    const text = this.#promptTextarea?.value || '';
    this.#tokenEstimate.textContent = text.trim() ? `~${estimateTokens(text)} tokens` : '';
  }

  // =========================================================================
  // System Prompt Editor
  // =========================================================================

  _showSystemPromptEditor() {
    let defaultPrompt = '(Select an entity and view first)';
    if (this.#opContext && this.#selectedEntity) {
      try {
        const tempCtx = { ...this.#opContext, attributes: [], relationships: [] };
        defaultPrompt = this.#activeOp.buildSystemPrompt(tempCtx);
      } catch { /* ignore */ }
    }
    const currentValue = this.#systemPromptOverride ?? defaultPrompt;

    const overlay = document.createElement('div');
    overlay.className = `${CSS}-sysprompt-overlay`;
    const panel = document.createElement('div');
    panel.className = `${CSS}-sysprompt-panel`;

    const header = document.createElement('div');
    header.className = `${CSS}-sysprompt-header`;
    const title = document.createElement('span');
    title.textContent = 'System Prompt';
    title.style.cssText = 'font-weight:600;font-size:0.85rem;';
    const badge = document.createElement('span');
    badge.style.cssText = `font-size:0.65rem;padding:1px 6px;border-radius:8px;background:${this.#systemPromptOverride ? 'var(--color-warning)' : 'var(--color-success)'};color:#000;margin-left:6px;`;
    badge.textContent = this.#systemPromptOverride ? 'Custom' : 'Default';
    const tokenCount = document.createElement('span');
    tokenCount.style.cssText = 'font-size:0.68rem;color:var(--color-text-muted);margin-left:auto;';
    tokenCount.textContent = `~${estimateTokens(currentValue)} tokens`;
    header.append(title, badge, tokenCount);

    const textarea = document.createElement('textarea');
    textarea.className = `${CSS}-sysprompt-textarea`;
    textarea.value = currentValue;
    textarea.spellcheck = false;
    textarea.addEventListener('input', () => { tokenCount.textContent = `~${estimateTokens(textarea.value)} tokens`; });

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.68rem;color:var(--color-text-muted);padding:4px 0;';
    hint.textContent = 'Edit for this session. Attributes/relationships are injected at runtime. Resets on page reload.';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
    const resetBtn = document.createElement('button');
    resetBtn.className = `${CSS}-btn ${CSS}-btn-secondary`;
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => { this.#systemPromptOverride = null; overlay.remove(); this._log('META', 'System prompt reset'); });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = `${CSS}-btn ${CSS}-btn-secondary`;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    const saveBtn = document.createElement('button');
    saveBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    saveBtn.textContent = 'Use Custom';
    saveBtn.addEventListener('click', () => {
      const val = textarea.value.trim();
      if (val && val !== defaultPrompt) { this.#systemPromptOverride = val; this._log('META', `System prompt overridden (~${estimateTokens(val)} tokens)`); }
      else { this.#systemPromptOverride = null; }
      overlay.remove();
    });
    btnRow.append(resetBtn, cancelBtn, saveBtn);

    panel.append(header, textarea, hint, btnRow);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } });
    this.container.appendChild(overlay);
    textarea.focus();
  }

  // =========================================================================
  // Agent Execution
  // =========================================================================

  async _onSend() {
    const userPrompt = this.#promptTextarea?.value?.trim();
    if (!userPrompt) return;
    if (!this.#selectedEntity) { this._log('WARN', 'Select an entity first'); return; }
    if (!this.#opContext) { this._log('WARN', 'Select a view first'); return; }

    if (this.#runner) { this.#runner.abort(); this.#runner = null; this.#sendBtn.textContent = 'Send'; return; }

    // Clear input
    this.#promptTextarea.value = '';
    this._updateTokenEstimate();
    this.#sendBtn.textContent = 'Cancel';

    // Add user message to chat
    this._addUserMessage(userPrompt);

    // Add agent message container
    const agentMsg = this._addAgentMessage();
    const timeline = new AgentTimeline(agentMsg.timelineEl);
    timeline.onAnswer = (answer) => this.#runner?.continueWithAnswer(answer);

    // Load metadata
    this._log('META', `Loading attributes for ${this.#selectedEntity.LogicalName}...`);
    try {
      const [attributes, relationships] = await Promise.all([
        this.cache.getAttributes(this.#selectedEntity.LogicalName),
        this.cache.getRelationships(this.#selectedEntity.LogicalName),
      ]);
      const allRels = [...(relationships.ManyToOne || []), ...(relationships.OneToMany || [])];
      this._log('META', `${attributes.length} attributes, ${allRels.length} relationships`);

      // Use CURRENT state from the operation (reflects previous applies)
      const currentState = this.#activeOp.currentState;
      const context = {
        ...this.#opContext,
        ...currentState,
        attributes,
        relationships: allRels,
        systemPromptOverride: this.#systemPromptOverride,
      };

      this.#runner = new AgentRunner(this.api, this.cache, this.#settings, {
        onStep: (step) => { timeline.updateStep(step); this._scrollChat(); },
        onLog: (tag, summary, detail) => this._log(tag, summary, detail),
      });

      const result = await this.#runner.run(this.#activeOp, context, userPrompt);
      this.#runner = null;
      this.#sendBtn.textContent = 'Send';

      this._log('META', `Agent finished \u2014 status: ${result?.status}`);

      if (result.status === 'done') {
        const output = { layoutxml: result.layoutxml, fetchxml: result.fetchxml };
        this._renderDiffInMessage(agentMsg, output, currentState);
        this._renderActionsInMessage(agentMsg, output);
      } else if (result.status === 'error') {
        agentMsg.statusLine.textContent = `\u2717 ${result.error}`;
        agentMsg.statusLine.style.color = 'var(--color-error)';
        this._log('ERR', result.error);
      }
    } catch (err) {
      this._log('ERR', `Request failed: ${err.message}`);
      agentMsg.statusLine.textContent = `\u2717 ${err.message}`;
      agentMsg.statusLine.style.color = 'var(--color-error)';
      this.#runner = null;
      this.#sendBtn.textContent = 'Send';
    }
  }

  // =========================================================================
  // Diff + Actions (inside agent message)
  // =========================================================================

  _renderDiffInMessage(agentMsg, output, baselineState) {
    const { diffEl } = agentMsg;
    diffEl.style.display = '';
    diffEl.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = `${CSS}-diff-header`;
    const title = document.createElement('span');
    title.className = `${CSS}-diff-title`;
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    fullscreenBtn.textContent = 'Fullscreen';
    fullscreenBtn.addEventListener('click', () => {
      diffEl.classList.toggle(`${CSS}-diff-fullscreen`);
      if (diffEl.classList.contains(`${CSS}-diff-fullscreen`)) {
        const onEsc = (e) => { if (e.key === 'Escape') { diffEl.classList.remove(`${CSS}-diff-fullscreen`); document.removeEventListener('keydown', onEsc); } };
        document.addEventListener('keydown', onEsc);
      }
    });
    header.append(title, fullscreenBtn);

    // Body with sections
    const body = document.createElement('div');
    body.className = `${CSS}-diff-body`;

    const makeSec = (label, beforeXml, afterXml) => {
      const sec = document.createElement('div');
      sec.className = `${CSS}-diff-section`;
      const secTitle = document.createElement('div');
      secTitle.className = `${CSS}-diff-section-title`;
      secTitle.innerHTML = `<span>${label}</span>`;
      const copyBtn = document.createElement('button');
      copyBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => { navigator.clipboard.writeText(afterXml).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }); });
      secTitle.appendChild(copyBtn);
      const secBody = document.createElement('div');
      sec.append(secTitle, secBody);
      body.appendChild(sec);
      return renderXmlDiff(beforeXml, afterXml, secBody);
    };

    const lStats = makeSec('layoutxml', baselineState.layoutxml, output.layoutxml);
    const fStats = makeSec('fetchxml', baselineState.fetchxml, output.fetchxml);
    title.textContent = `Changes \u2014 +${lStats.added + fStats.added} / -${lStats.removed + fStats.removed}`;

    diffEl.append(header, body);
    this._log('DIFF', `${lStats.added + fStats.added} added, ${lStats.removed + fStats.removed} removed`);
    this._scrollChat();
  }

  _renderActionsInMessage(agentMsg, output) {
    const { actionBar, statusLine } = agentMsg;
    actionBar.style.display = '';
    actionBar.innerHTML = '';

    const applyBtn = document.createElement('button');
    applyBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    applyBtn.textContent = 'Apply & Publish';
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying...';
      this._log('META', 'Applying changes...');
      try {
        const result = await this.#activeOp.apply(output, true, (tag, s, d) => this._log(tag, s, d));
        if (result.success) {
          statusLine.textContent = '\u2713 Applied & Published \u2014 Ctrl+Shift+R to see changes';
          statusLine.style.color = 'var(--color-success)';
          actionBar.style.display = 'none';
          // Collapse diff after apply
          agentMsg.diffEl.style.display = 'none';
          this._log('META', 'Done \u2014 baseline updated for follow-up prompts');
        } else {
          statusLine.textContent = `\u2717 ${result.error}`;
          statusLine.style.color = 'var(--color-error)';
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply & Publish';
        }
      } catch (err) {
        this._log('ERR', err.message);
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply & Publish';
      }
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS}-btn ${CSS}-btn-secondary`;
    copyBtn.textContent = 'Copy XML';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(`<!-- layoutxml -->\n${output.layoutxml}\n\n<!-- fetchxml -->\n${output.fetchxml}`);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy XML'; }, 1500);
    });

    actionBar.append(applyBtn, copyBtn);
    this._scrollChat();
  }

  // =========================================================================
  // Debug Console
  // =========================================================================

  _buildDebugConsole() {
    const consoleEl = document.createElement('div');
    consoleEl.className = `${CSS}-console ${CSS}-console-expanded`;

    const header = document.createElement('div');
    header.className = `${CSS}-console-header`;
    const chevron = document.createElement('span');
    chevron.className = `${CSS}-console-chevron`;
    chevron.textContent = '\u25BC';
    const title = document.createElement('span');
    title.className = `${CSS}-console-title`;
    title.textContent = 'Debug Console';

    const filters = document.createElement('div');
    filters.className = `${CSS}-console-filters`;
    for (const f of ['All', 'Prompts', 'API', 'Errors']) {
      const btn = document.createElement('button');
      btn.className = `${CSS}-console-filter${f === 'All' ? ` ${CSS}-console-filter-active` : ''}`;
      btn.textContent = f;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._setLogFilter(f.toLowerCase(), btn); });
      filters.appendChild(btn);
    }

    const actions = document.createElement('div');
    actions.className = `${CSS}-console-actions`;
    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    copyBtn.textContent = 'Copy Log';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); this._copyLog(copyBtn); });
    const clearBtn = document.createElement('button');
    clearBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); this._clearLog(); });
    actions.append(copyBtn, clearBtn);

    header.append(chevron, title, filters, actions);
    header.addEventListener('click', () => {
      this.#consoleExpanded = !this.#consoleExpanded;
      consoleEl.classList.toggle(`${CSS}-console-collapsed`, !this.#consoleExpanded);
      consoleEl.classList.toggle(`${CSS}-console-expanded`, this.#consoleExpanded);
      chevron.textContent = this.#consoleExpanded ? '\u25BC' : '\u25B6';
    });

    const body = document.createElement('div');
    body.className = `${CSS}-console-body`;
    this.#logContainer = document.createElement('div');
    this.#logContainer.className = `${CSS}-console-log`;
    this.#logContainer.addEventListener('scroll', () => {
      this.#autoScroll = (this.#logContainer.scrollHeight - this.#logContainer.scrollTop - this.#logContainer.clientHeight) < 30;
    });
    body.appendChild(this.#logContainer);

    consoleEl.append(header, body);
    this.container.appendChild(consoleEl);

    for (const entry of this.#debugLog) this._appendLogEntry(entry);
  }

  // =========================================================================
  // Logging
  // =========================================================================

  _log(tag, summary, detail = null) {
    const entry = { time: new Date().toLocaleTimeString('de-DE', { hour12: false }), tag, summary, detail, expanded: false };
    this.#debugLog.push(entry);
    if (this.#debugLog.length > MAX_LOG_ENTRIES) this.#debugLog.shift();
    this._appendLogEntry(entry);
  }

  _appendLogEntry(entry) {
    if (!this.#logContainer) return;
    const visible = this._matchesFilter(entry.tag, this.#activeFilter);
    const row = document.createElement('div');
    row.className = `${CSS}-log-entry`;
    row.dataset.tag = entry.tag;
    if (!visible) row.style.display = 'none';

    row.innerHTML = `<span class="${CSS}-log-time">${entry.time}</span><span class="${CSS}-log-tag" style="color:var(${TAG_COLORS[entry.tag] || '--color-text-muted'})">[${entry.tag}]</span><span class="${CSS}-log-summary">${entry.summary}</span>`;

    if (entry.detail) {
      const expandBtn = document.createElement('button');
      expandBtn.className = `${CSS}-log-expand`;
      expandBtn.textContent = '\u25B6';
      const detail = document.createElement('pre');
      detail.className = `${CSS}-log-detail`;
      detail.textContent = entry.detail;
      detail.style.display = 'none';
      expandBtn.addEventListener('click', () => {
        entry.expanded = !entry.expanded;
        detail.style.display = entry.expanded ? '' : 'none';
        expandBtn.textContent = entry.expanded ? '\u25BC' : '\u25B6';
      });
      row.appendChild(expandBtn);
      this.#logContainer.append(row, detail);
    } else {
      this.#logContainer.appendChild(row);
    }

    if (this.#autoScroll) this.#logContainer.scrollTop = this.#logContainer.scrollHeight;
  }

  _matchesFilter(tag, filter) {
    if (filter === 'all') return true;
    if (filter === 'prompts') return tag === 'SEND' || tag === 'RECV';
    if (filter === 'api') return tag === 'WRITE' || tag === 'PUB' || tag === 'META';
    if (filter === 'errors') return tag === 'ERR' || tag === 'WARN';
    return true;
  }

  _setLogFilter(filter, activeBtn) {
    this.#activeFilter = filter;
    activeBtn.parentElement.querySelectorAll(`.${CSS}-console-filter`).forEach(b => b.classList.remove(`${CSS}-console-filter-active`));
    activeBtn.classList.add(`${CSS}-console-filter-active`);
    if (!this.#logContainer) return;
    for (const el of this.#logContainer.children) {
      const t = el.dataset?.tag;
      if (!t) continue;
      el.style.display = this._matchesFilter(t, filter) ? '' : 'none';
    }
  }

  _copyLog(btn) {
    navigator.clipboard.writeText(this.#debugLog.map(e => `${e.time} [${e.tag}] ${e.summary}`).join('\n'));
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Log'; }, 1500);
  }

  _clearLog() {
    this.#debugLog = [];
    if (this.#logContainer) this.#logContainer.innerHTML = '';
  }
}
