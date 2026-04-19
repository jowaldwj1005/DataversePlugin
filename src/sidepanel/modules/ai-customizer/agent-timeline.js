/**
 * AI Customizer — Agent Timeline UI Component
 *
 * Renders a step-by-step timeline of what the agent is doing,
 * with Markdown reasoning, status icons, and inline question input.
 */

const CSS = 'ac';

/**
 * Simple Markdown → HTML renderer for agent reasoning text.
 * Supports: bold, inline code, headings (##, ###), list items (-), newlines.
 */
function renderMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<strong style="font-size:0.78rem;">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:0.82rem;">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '&nbsp;&nbsp;\u2022 $1')
    .replace(/\n/g, '<br>');
}

const STATUS_ICONS = {
  running: `<span class="${CSS}-timeline-spinner"></span>`,
  done: '\u2713',
  error: '\u2717',
  waiting: '?',
};

export class AgentTimeline {
  #container;
  #steps = [];
  #stepElements = new Map();
  #onAnswer = null; // (answer: string) => void — set when question is pending

  constructor(container) {
    this.#container = container;
    this.#container.className = `${CSS}-timeline`;
  }

  /**
   * Set callback for when user answers an agent question.
   * @param {(answer: string) => void} fn
   */
  set onAnswer(fn) { this.#onAnswer = fn; }

  /**
   * Add or update a step. If step.id exists, updates it; otherwise adds new.
   * @param {{ id: string, type: string, label: string, reasoning?: string, status: string, startedAt: number, completedAt?: number }} step
   */
  updateStep(step) {
    const idx = this.#steps.findIndex(s => s.id === step.id);
    if (idx >= 0) {
      this.#steps[idx] = step;
      this.#renderStep(step);
    } else {
      this.#steps.push(step);
      this.#renderStep(step);
    }

    // Auto-scroll timeline container's parent
    const scrollParent = this.#container.closest(`.${CSS}-main-area`);
    if (scrollParent) {
      scrollParent.scrollTop = scrollParent.scrollHeight;
    }
  }

  clear() {
    this.#steps = [];
    this.#stepElements.clear();
    this.#container.innerHTML = '';
    // Note: do NOT clear #onAnswer — it's set once by the parent module
    // and must persist across clear() calls within the same session.
  }

  #renderStep(step) {
    let el = this.#stepElements.get(step.id);

    if (!el) {
      el = document.createElement('div');
      el.className = `${CSS}-timeline-step`;
      this.#stepElements.set(step.id, el);
      this.#container.appendChild(el);
    }

    el.className = `${CSS}-timeline-step ${CSS}-timeline-step-${step.status}`;

    // Duration
    let durationText = '';
    if (step.completedAt && step.startedAt) {
      const secs = ((step.completedAt - step.startedAt) / 1000).toFixed(1);
      durationText = `${secs}s`;
    } else if (step.status === 'running') {
      durationText = '...';
    }

    const iconHtml = STATUS_ICONS[step.status] || '';

    el.innerHTML = `
      <span class="${CSS}-timeline-icon">${iconHtml}</span>
      <span class="${CSS}-timeline-label">${this.#escapeHtml(step.label)}</span>
      <span class="${CSS}-timeline-duration">${durationText}</span>
    `;

    // Tool call details (expandable)
    if (step.toolCall && (step.type === 'tool_call' || step.type === 'tool_result')) {
      const details = document.createElement('details');
      details.className = `${CSS}-timeline-tool-details`;
      const summary = document.createElement('summary');
      summary.textContent = step.type === 'tool_call' ? 'Parameters' : 'Details';
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(step.toolCall.params, null, 2);
      if (step.toolResult) {
        pre.textContent += '\n\n--- Result ---\n' + (typeof step.toolResult === 'string' ? step.toolResult : JSON.stringify(step.toolResult, null, 2));
      }
      details.append(summary, pre);
      el.appendChild(details);
    }

    // Responses API metadata (reasoning summaries, web search calls, citations)
    if (step.responsesMetadata?.length && step.type === 'thinking') {
      const metaWrap = document.createElement('details');
      metaWrap.className = `${CSS}-timeline-responses-meta`;

      const hasSummaries = step.responsesMetadata.some(m => m.type === 'reasoning' && m.summary?.length);
      const searchCount = step.responsesMetadata.filter(m => m.type === 'web_search').length;
      const citationCount = step.responsesMetadata.filter(m => m.type === 'citation').length;

      const parts = [];
      if (hasSummaries) parts.push('reasoning');
      if (searchCount) parts.push(`${searchCount} search${searchCount > 1 ? 'es' : ''}`);
      if (citationCount) parts.push(`${citationCount} citation${citationCount > 1 ? 's' : ''}`);

      const sum = document.createElement('summary');
      sum.textContent = parts.join(', ') || 'API details';
      metaWrap.appendChild(sum);

      const inner = document.createElement('div');
      inner.className = `${CSS}-timeline-responses-inner`;

      for (const item of step.responsesMetadata) {
        if (item.type === 'reasoning' && item.summary?.length) {
          for (const s of item.summary) {
            const line = document.createElement('div');
            line.className = `${CSS}-timeline-responses-reasoning`;
            line.textContent = typeof s === 'string' ? s : (s.text || JSON.stringify(s));
            inner.appendChild(line);
          }
        } else if (item.type === 'web_search') {
          const line = document.createElement('div');
          line.className = `${CSS}-timeline-responses-search`;
          if (item.queries?.length) {
            line.innerHTML = `<span class="${CSS}-responses-search-icon">\u{1F50D}</span> ` +
              item.queries.map(q => this.#escapeHtml(q)).join('<br>');
          } else if (item.url) {
            const short = item.url.length > 80 ? item.url.slice(0, 77) + '...' : item.url;
            line.innerHTML = `<span class="${CSS}-responses-search-icon">\u{1F310}</span> <a href="${this.#escapeHtml(item.url)}" target="_blank" rel="noopener">${this.#escapeHtml(short)}</a>`;
          }
          inner.appendChild(line);
        } else if (item.type === 'citation') {
          const line = document.createElement('div');
          line.className = `${CSS}-timeline-responses-citation`;
          const title = item.title || item.url;
          const short = title.length > 80 ? title.slice(0, 77) + '...' : title;
          line.innerHTML = `<span class="${CSS}-responses-search-icon">\u{1F4CE}</span> <a href="${this.#escapeHtml(item.url)}" target="_blank" rel="noopener">${this.#escapeHtml(short)}</a>`;
          inner.appendChild(line);
        }
      }

      metaWrap.appendChild(inner);
      el.appendChild(metaWrap);
    }

    // Reasoning (only for thinking steps, not duplicated in final content)
    if (step.reasoning && step.type === 'thinking') {
      const reasoning = document.createElement('div');
      reasoning.className = `${CSS}-timeline-reasoning`;
      reasoning.innerHTML = renderMarkdown(step.reasoning);
      el.appendChild(reasoning);
    }

    // Question input
    if (step.type === 'question' && step.status === 'waiting') {
      const inputWrap = document.createElement('div');
      inputWrap.className = `${CSS}-timeline-question-input`;
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Your answer...';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          this.#submitAnswer(step, input.value.trim(), inputWrap);
        }
      });
      const btn = document.createElement('button');
      btn.className = `${CSS}-btn ${CSS}-btn-primary`;
      btn.textContent = 'Reply';
      btn.addEventListener('click', () => {
        if (input.value.trim()) {
          this.#submitAnswer(step, input.value.trim(), inputWrap);
        }
      });
      inputWrap.append(input, btn);
      el.appendChild(inputWrap);

      // Focus the input
      requestAnimationFrame(() => input.focus());
    }
  }

  #submitAnswer(step, answer, inputWrap) {
    // Replace input with the answer text
    inputWrap.innerHTML = `<span style="font-size:0.78rem;color:var(--color-text-primary);padding-left:24px;">\u2192 ${this.#escapeHtml(answer)}</span>`;
    step.status = 'done';
    step.completedAt = performance.now();
    this.#renderStep(step);
    this.#onAnswer?.(answer);
  }

  #escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
