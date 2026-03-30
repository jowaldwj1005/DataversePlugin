/**
 * Dataverse Toolkit - Code Editor Module
 *
 * A lightweight, dependency-free code editor component providing syntax
 * highlighting for JSON, XML/FetchXML, C#, and JavaScript. Uses a textarea
 * with a synchronized pre/code overlay for reliable editing plus visual
 * highlighting.
 *
 * @module code-editor
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CSS_PREFIX = 'dvt-editor';

const LANGUAGES = Object.freeze({
  JSON: 'json',
  XML: 'xml',
  CSHARP: 'csharp',
  JAVASCRIPT: 'javascript',
});

/** Syntax color palette (VS Code dark+ inspired) */
const COLORS = Object.freeze({
  key: '#9cdcfe',
  string: '#ce9178',
  number: '#b5cea8',
  boolean: '#569cd6',
  null: '#569cd6',
  brace: '#ffd700',
  punctuation: '#cccccc',
  tag: '#569cd6',
  attrName: '#9cdcfe',
  attrValue: '#ce9178',
  text: '#cccccc',
  comment: '#6a9955',
  cdata: '#dcdcaa',
  keyword: '#569cd6',
  type: '#4ec9b0',
  function: '#dcdcaa',
  operator: '#d4d4d4',
  regex: '#d16969',
});

const FONT_FAMILY = "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace";
const FONT_SIZE = '13px';
const LINE_HEIGHT = '20px';
const TAB_SIZE = 2;

// ---------------------------------------------------------------------------
// Tokenizers
// ---------------------------------------------------------------------------

/**
 * Tokenize JSON source into spans with syntax-highlighting classes.
 * @param {string} code
 * @returns {string} HTML string
 */
function highlightJSON(code) {
  return code.replace(
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(\b(?:true|false)\b)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]])|([,:])|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,
    (match, key, str, bool, nul, num, brace, punct, comment) => {
      if (key) return `<span class="${CSS_PREFIX}-key">${escapeHtml(key)}</span>:`;
      if (str) return `<span class="${CSS_PREFIX}-string">${escapeHtml(str)}</span>`;
      if (bool) return `<span class="${CSS_PREFIX}-boolean">${escapeHtml(bool)}</span>`;
      if (nul) return `<span class="${CSS_PREFIX}-null">${escapeHtml(nul)}</span>`;
      if (num) return `<span class="${CSS_PREFIX}-number">${escapeHtml(num)}</span>`;
      if (brace) return `<span class="${CSS_PREFIX}-brace">${escapeHtml(brace)}</span>`;
      if (punct) return `<span class="${CSS_PREFIX}-punctuation">${escapeHtml(punct)}</span>`;
      if (comment) return `<span class="${CSS_PREFIX}-comment">${escapeHtml(comment)}</span>`;
      return escapeHtml(match);
    }
  );
}

/**
 * Tokenize XML/FetchXML source.
 * @param {string} code
 * @returns {string} HTML string
 */
function highlightXML(code) {
  let result = '';
  let i = 0;
  const len = code.length;

  while (i < len) {
    // CDATA section
    if (code.startsWith('<![CDATA[', i)) {
      const end = code.indexOf(']]>', i);
      const slice = end === -1 ? code.slice(i) : code.slice(i, end + 3);
      result += `<span class="${CSS_PREFIX}-cdata">${escapeHtml(slice)}</span>`;
      i += slice.length;
      continue;
    }

    // Comment
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i);
      const slice = end === -1 ? code.slice(i) : code.slice(i, end + 3);
      result += `<span class="${CSS_PREFIX}-comment">${escapeHtml(slice)}</span>`;
      i += slice.length;
      continue;
    }

    // Processing instruction
    if (code.startsWith('<?', i)) {
      const end = code.indexOf('?>', i);
      const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
      result += `<span class="${CSS_PREFIX}-comment">${escapeHtml(slice)}</span>`;
      i += slice.length;
      continue;
    }

    // Tags (opening, closing, self-closing)
    if (code[i] === '<') {
      const tagMatch = code.slice(i).match(/^(<\/?)([\w:.-]+)([\s\S]*?)(\/?>)/);
      if (tagMatch) {
        const [full, open, tagName, attrs, close] = tagMatch;
        result += `<span class="${CSS_PREFIX}-tag">${escapeHtml(open)}</span>`;
        result += `<span class="${CSS_PREFIX}-tag">${escapeHtml(tagName)}</span>`;
        result += highlightXMLAttributes(attrs);
        result += `<span class="${CSS_PREFIX}-tag">${escapeHtml(close)}</span>`;
        i += full.length;
        continue;
      }
    }

    // Plain text content
    const nextTag = code.indexOf('<', i + 1);
    if (nextTag === -1) {
      result += `<span class="${CSS_PREFIX}-text">${escapeHtml(code.slice(i))}</span>`;
      break;
    }
    if (i < nextTag) {
      result += `<span class="${CSS_PREFIX}-text">${escapeHtml(code.slice(i, nextTag))}</span>`;
      i = nextTag;
    } else {
      result += escapeHtml(code[i]);
      i++;
    }
  }

  return result;
}

function highlightXMLAttributes(attrStr) {
  return attrStr.replace(
    /([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g,
    (_, name, value) =>
      `<span class="${CSS_PREFIX}-attr-name"> ${escapeHtml(name)}</span>=<span class="${CSS_PREFIX}-attr-value">${escapeHtml(value)}</span>`
  ).replace(/^([^<]*?)(?=<span|$)/, (m) => escapeHtml(m));
}

/**
 * Tokenize C# source (simplified).
 * @param {string} code
 * @returns {string} HTML string
 */
function highlightCSharp(code) {
  const keywords = 'abstract|as|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|goto|if|implicit|in|int|interface|internal|is|lock|long|namespace|new|null|object|operator|out|override|params|private|protected|public|readonly|ref|return|sbyte|sealed|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unchecked|unsafe|ushort|using|virtual|void|volatile|while|var|async|await|dynamic|nameof|when|where|yield';
  const types = 'Action|Boolean|Byte|Char|DateTime|Decimal|Double|Entity|EntityCollection|EntityReference|Func|Guid|IOrganizationService|IPluginExecutionContext|IServiceProvider|ITracingService|Int16|Int32|Int64|List|Money|OptionSetValue|Single|String|Task|TimeSpan';

  const pattern = new RegExp(
    `(\/\/[^\n]*|\/\\*[\\s\\S]*?\\*\\/)|` +       // comments
    `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|` + // strings
    `(\\b(?:${keywords})\\b)|` +                    // keywords
    `(\\b(?:${types})\\b)|` +                       // types
    `(\\b\\d+(?:\\.\\d+)?[fFdDmMlL]?\\b)|` +       // numbers
    `(\\b[A-Z]\\w*(?=\\s*\\())|` +                  // method calls
    `([{}\\[\\]();,.])|` +                          // punctuation
    `([+\\-*/%=!<>&|^~?:]+)`,                       // operators
    'g'
  );

  return code.replace(pattern, (match, comment, str, kw, type, num, fn, punct, op) => {
    if (comment) return `<span class="${CSS_PREFIX}-comment">${escapeHtml(comment)}</span>`;
    if (str) return `<span class="${CSS_PREFIX}-string">${escapeHtml(str)}</span>`;
    if (kw) return `<span class="${CSS_PREFIX}-keyword">${escapeHtml(kw)}</span>`;
    if (type) return `<span class="${CSS_PREFIX}-type">${escapeHtml(type)}</span>`;
    if (num) return `<span class="${CSS_PREFIX}-number">${escapeHtml(num)}</span>`;
    if (fn) return `<span class="${CSS_PREFIX}-function">${escapeHtml(fn)}</span>`;
    if (punct) return `<span class="${CSS_PREFIX}-punctuation">${escapeHtml(punct)}</span>`;
    if (op) return `<span class="${CSS_PREFIX}-operator">${escapeHtml(op)}</span>`;
    return escapeHtml(match);
  });
}

/**
 * Tokenize JavaScript source (simplified).
 * @param {string} code
 * @returns {string} HTML string
 */
function highlightJavaScript(code) {
  const keywords = 'async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|with|yield';

  const pattern = new RegExp(
    `(\/\/[^\n]*|\/\\*[\\s\\S]*?\\*\\/)|` +       // comments
    `(\`(?:[^\`\\\\]|\\\\.)*\`|"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|` + // strings
    `(\\b(?:${keywords})\\b)|` +                    // keywords
    `(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?\\b)|` + // numbers
    `(\\b[A-Z]\\w*\\b)|` +                         // types/constructors
    `(\\b\\w+(?=\\s*\\())|` +                       // function calls
    `(\/(?:[^\\/\\n]|\\\\.)+\\/[gimsuy]*)|` +       // regex
    `([{}\\[\\]();,.])|` +                          // punctuation
    `([+\\-*/%=!<>&|^~?:]+)`,                       // operators
    'g'
  );

  return code.replace(pattern, (match, comment, str, kw, num, type, fn, regex, punct, op) => {
    if (comment) return `<span class="${CSS_PREFIX}-comment">${escapeHtml(comment)}</span>`;
    if (str) return `<span class="${CSS_PREFIX}-string">${escapeHtml(str)}</span>`;
    if (kw) return `<span class="${CSS_PREFIX}-keyword">${escapeHtml(kw)}</span>`;
    if (num) return `<span class="${CSS_PREFIX}-number">${escapeHtml(num)}</span>`;
    if (type) return `<span class="${CSS_PREFIX}-type">${escapeHtml(type)}</span>`;
    if (fn) return `<span class="${CSS_PREFIX}-function">${escapeHtml(fn)}</span>`;
    if (regex) return `<span class="${CSS_PREFIX}-regex">${escapeHtml(regex)}</span>`;
    if (punct) return `<span class="${CSS_PREFIX}-punctuation">${escapeHtml(punct)}</span>`;
    if (op) return `<span class="${CSS_PREFIX}-operator">${escapeHtml(op)}</span>`;
    return escapeHtml(match);
  });
}

// ---------------------------------------------------------------------------
// XML Formatter
// ---------------------------------------------------------------------------

function formatXML(xml) {
  let formatted = '';
  let indent = 0;
  const lines = xml.replace(/>\s*</g, '>\n<').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Closing tag
    if (line.startsWith('</')) {
      indent = Math.max(0, indent - 1);
    }

    formatted += ' '.repeat(indent * TAB_SIZE) + line + '\n';

    // Opening tag (not self-closing, not closing)
    if (line.startsWith('<') && !line.startsWith('</') && !line.startsWith('<?') &&
        !line.startsWith('<!') && !line.endsWith('/>') && !line.includes('</')) {
      indent++;
    }
  }

  return formatted.trimEnd();
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Bracket matching pairs
// ---------------------------------------------------------------------------

const BRACKET_PAIRS = {
  '{': '}', '}': '{',
  '[': ']', ']': '[',
  '(': ')', ')': '(',
};

const OPEN_BRACKETS = new Set(['{', '[', '(']);
const CLOSE_BRACKETS = new Set(['}', ']', ')']);

const AUTO_CLOSE_MAP = {
  '{': '}',
  '[': ']',
  '(': ')',
  '"': '"',
  "'": "'",
};

// ---------------------------------------------------------------------------
// CodeEditor class
// ---------------------------------------------------------------------------

export class CodeEditor {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} [options]
   * @param {'json'|'xml'|'csharp'|'javascript'} [options.language='json']
   * @param {boolean} [options.readOnly=false]
   * @param {string} [options.value='']
   * @param {Function} [options.onChange] - Callback when content changes
   * @param {boolean} [options.lineNumbers=true]
   * @param {boolean} [options.wordWrap=true]
   */
  constructor(container, options = {}) {
    this.container = container;

    this._language = options.language || LANGUAGES.JSON;
    this._readOnly = options.readOnly || false;
    this._value = options.value || '';
    this._onChange = options.onChange || null;
    this._showLineNumbers = options.lineNumbers !== false;
    this._wordWrap = options.wordWrap !== false;

    this._root = null;
    this._textarea = null;
    this._pre = null;
    this._codeEl = null;
    this._lineNumbers = null;
    this._searchBar = null;
    this._searchMatches = [];
    this._currentMatchIndex = -1;
    this._searchVisible = false;

    this._injectStyles();
    this._build();
    this._syncHighlight();
    this._updateLineNumbers();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getValue() {
    return this._textarea?.value || '';
  }

  setValue(text) {
    if (!this._textarea) return;
    this._value = text || '';
    this._textarea.value = this._value;
    this._syncHighlight();
    this._updateLineNumbers();
  }

  setLanguage(lang) {
    if (!Object.values(LANGUAGES).includes(lang)) return;
    this._language = lang;
    this._syncHighlight();
  }

  setReadOnly(readOnly) {
    this._readOnly = readOnly;
    if (this._textarea) {
      this._textarea.readOnly = readOnly;
      this._root.classList.toggle(`${CSS_PREFIX}-readonly`, readOnly);
    }
  }

  setWordWrap(wrap) {
    this._wordWrap = wrap;
    if (this._textarea && this._pre) {
      const wrapVal = wrap ? 'pre-wrap' : 'pre';
      this._textarea.style.whiteSpace = wrapVal;
      this._textarea.style.overflowWrap = wrap ? 'break-word' : 'normal';
      this._pre.style.whiteSpace = wrapVal;
      this._pre.style.overflowWrap = wrap ? 'break-word' : 'normal';
      this._updateLineNumbers();
    }
  }

  focus() {
    this._textarea?.focus();
  }

  destroy() {
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
  }

  // -----------------------------------------------------------------------
  // Build UI
  // -----------------------------------------------------------------------

  _build() {
    const root = document.createElement('div');
    root.className = `${CSS_PREFIX}-root${this._readOnly ? ` ${CSS_PREFIX}-readonly` : ''}`;
    this._root = root;

    // Toolbar
    root.appendChild(this._buildToolbar());

    // Search bar (hidden initially)
    root.appendChild(this._buildSearchBar());

    // Editor body
    const body = document.createElement('div');
    body.className = `${CSS_PREFIX}-body`;

    // Line numbers
    const lineNums = document.createElement('div');
    lineNums.className = `${CSS_PREFIX}-line-numbers`;
    if (!this._showLineNumbers) lineNums.style.display = 'none';
    this._lineNumbers = lineNums;
    body.appendChild(lineNums);

    // Editor area (textarea + pre overlay)
    const editorArea = document.createElement('div');
    editorArea.className = `${CSS_PREFIX}-editor-area`;

    // Textarea (actual editing surface)
    const textarea = document.createElement('textarea');
    textarea.className = `${CSS_PREFIX}-textarea`;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.autocapitalize = 'off';
    textarea.readOnly = this._readOnly;
    textarea.value = this._value;
    textarea.setAttribute('wrap', this._wordWrap ? 'soft' : 'off');
    this._textarea = textarea;

    // Pre/code overlay (syntax highlighted display)
    const pre = document.createElement('pre');
    pre.className = `${CSS_PREFIX}-pre`;
    pre.setAttribute('aria-hidden', 'true');
    const codeEl = document.createElement('code');
    codeEl.className = `${CSS_PREFIX}-code`;
    pre.appendChild(codeEl);
    this._pre = pre;
    this._codeEl = codeEl;

    editorArea.appendChild(textarea);
    editorArea.appendChild(pre);
    body.appendChild(editorArea);
    root.appendChild(body);

    // Event listeners
    this._attachEvents();

    this.container.appendChild(root);
  }

  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = `${CSS_PREFIX}-toolbar`;

    // Language indicator
    const langLabel = document.createElement('span');
    langLabel.className = `${CSS_PREFIX}-lang-label`;
    langLabel.textContent = this._language.toUpperCase();
    toolbar.appendChild(langLabel);

    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    toolbar.appendChild(spacer);

    // Word wrap toggle
    const wrapBtn = document.createElement('button');
    wrapBtn.className = `${CSS_PREFIX}-toolbar-btn${this._wordWrap ? ' active' : ''}`;
    wrapBtn.textContent = 'Wrap';
    wrapBtn.title = 'Toggle word wrap';
    wrapBtn.addEventListener('click', () => {
      this._wordWrap = !this._wordWrap;
      wrapBtn.classList.toggle('active', this._wordWrap);
      this.setWordWrap(this._wordWrap);
    });
    toolbar.appendChild(wrapBtn);

    // Format button
    const formatBtn = document.createElement('button');
    formatBtn.className = `${CSS_PREFIX}-toolbar-btn`;
    formatBtn.textContent = 'Format';
    formatBtn.title = 'Prettify code';
    formatBtn.addEventListener('click', () => this._format());
    toolbar.appendChild(formatBtn);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS_PREFIX}-toolbar-btn`;
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy all';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.getValue());
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      } catch {
        // Fallback
        this._textarea.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
    });
    toolbar.appendChild(copyBtn);

    return toolbar;
  }

  _buildSearchBar() {
    const bar = document.createElement('div');
    bar.className = `${CSS_PREFIX}-search-bar`;
    bar.style.display = 'none';
    this._searchBar = bar;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = `${CSS_PREFIX}-search-input`;
    input.placeholder = 'Search...';
    input.addEventListener('input', () => this._performSearch(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this._navigateSearch(-1);
        } else {
          this._navigateSearch(1);
        }
      }
      if (e.key === 'Escape') {
        this._hideSearch();
      }
    });
    bar.appendChild(input);

    const countLabel = document.createElement('span');
    countLabel.className = `${CSS_PREFIX}-search-count`;
    countLabel.textContent = '0 results';
    bar.appendChild(countLabel);

    const prevBtn = document.createElement('button');
    prevBtn.className = `${CSS_PREFIX}-toolbar-btn`;
    prevBtn.textContent = '\u2191';
    prevBtn.title = 'Previous match';
    prevBtn.addEventListener('click', () => this._navigateSearch(-1));
    bar.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = `${CSS_PREFIX}-toolbar-btn`;
    nextBtn.textContent = '\u2193';
    nextBtn.title = 'Next match';
    nextBtn.addEventListener('click', () => this._navigateSearch(1));
    bar.appendChild(nextBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = `${CSS_PREFIX}-toolbar-btn`;
    closeBtn.textContent = '\u00D7';
    closeBtn.title = 'Close search';
    closeBtn.addEventListener('click', () => this._hideSearch());
    bar.appendChild(closeBtn);

    return bar;
  }

  // -----------------------------------------------------------------------
  // Event handling
  // -----------------------------------------------------------------------

  _attachEvents() {
    const ta = this._textarea;

    // Sync highlight and line numbers on input
    ta.addEventListener('input', () => {
      this._value = ta.value;
      this._syncHighlight();
      this._updateLineNumbers();
      if (this._onChange) this._onChange(ta.value);
    });

    // Sync scroll between textarea and pre
    ta.addEventListener('scroll', () => {
      this._pre.scrollTop = ta.scrollTop;
      this._pre.scrollLeft = ta.scrollLeft;
      if (this._lineNumbers) {
        this._lineNumbers.scrollTop = ta.scrollTop;
      }
    });

    // Tab key inserts spaces
    ta.addEventListener('keydown', (e) => {
      this._handleKeyDown(e);
    });

    // Ctrl+F for search
    this._root.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this._showSearch();
      }
    });
  }

  _handleKeyDown(e) {
    const ta = this._textarea;

    // Tab key -> insert spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const spaces = ' '.repeat(TAB_SIZE);

      if (e.shiftKey) {
        // Outdent: remove leading spaces from current line
        const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
        const lineText = ta.value.slice(lineStart, start);
        const spacesToRemove = Math.min(TAB_SIZE, lineText.length - lineText.trimStart().length);
        if (spacesToRemove > 0) {
          ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + spacesToRemove);
          ta.selectionStart = ta.selectionEnd = start - spacesToRemove;
          this._onInput();
        }
      } else {
        ta.value = ta.value.slice(0, start) + spaces + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + TAB_SIZE;
        this._onInput();
      }
      return;
    }

    // Enter key -> auto-indent
    if (e.key === 'Enter') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);

      // Get current line indentation
      const lineStart = before.lastIndexOf('\n') + 1;
      const currentLine = before.slice(lineStart);
      const indent = currentLine.match(/^(\s*)/)[1];

      // Check if we should increase indent (after { or [ or >)
      const lastChar = before.trimEnd().slice(-1);
      const nextChar = after.trimStart()[0];
      let newIndent = indent;
      let extraLine = '';

      if ((lastChar === '{' || lastChar === '[' || (lastChar === '>' && this._language === 'xml')) &&
          (nextChar === '}' || nextChar === ']' || (nextChar === '<' && this._language === 'xml'))) {
        // Cursor between matching brackets
        newIndent = indent + ' '.repeat(TAB_SIZE);
        extraLine = '\n' + indent;
      } else if (lastChar === '{' || lastChar === '[' || (lastChar === '>' && this._language === 'xml')) {
        newIndent = indent + ' '.repeat(TAB_SIZE);
      }

      const insertion = '\n' + newIndent + extraLine;
      ta.value = before + insertion + after;
      ta.selectionStart = ta.selectionEnd = start + 1 + newIndent.length;
      this._onInput();
      return;
    }

    // Auto-close brackets and quotes (JSON mode)
    if (this._language === 'json' || this._language === 'javascript') {
      const closeChar = AUTO_CLOSE_MAP[e.key];
      if (closeChar && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;

        // Don't auto-close quotes if we're inside a string (simple heuristic)
        if ((e.key === '"' || e.key === "'") && start === end) {
          const charAfter = ta.value[start];
          if (charAfter === e.key) {
            // Skip over existing closing quote
            e.preventDefault();
            ta.selectionStart = ta.selectionEnd = start + 1;
            return;
          }
        }

        if (start === end && OPEN_BRACKETS.has(e.key)) {
          e.preventDefault();
          ta.value = ta.value.slice(0, start) + e.key + closeChar + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + 1;
          this._onInput();
          return;
        }

        if ((e.key === '"' || e.key === "'") && start === end) {
          e.preventDefault();
          ta.value = ta.value.slice(0, start) + e.key + closeChar + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + 1;
          this._onInput();
          return;
        }
      }

      // Skip over closing brackets
      if (CLOSE_BRACKETS.has(e.key)) {
        const start = ta.selectionStart;
        if (ta.value[start] === e.key) {
          e.preventDefault();
          ta.selectionStart = ta.selectionEnd = start + 1;
          return;
        }
      }
    }

    // Auto-close tags in XML mode
    if (this._language === 'xml' && e.key === '>' && !e.ctrlKey) {
      const start = ta.selectionStart;
      const before = ta.value.slice(0, start);

      // Check if this is an opening tag (not self-closing, not closing)
      const tagMatch = before.match(/<(\w[\w:.-]*)(?:\s[^>]*)?\s*$/);
      if (tagMatch && !before.endsWith('/')) {
        e.preventDefault();
        const tagName = tagMatch[1];
        const closeTag = `</${tagName}>`;
        ta.value = ta.value.slice(0, start) + '>' + closeTag + ta.value.slice(start);
        ta.selectionStart = ta.selectionEnd = start + 1;
        this._onInput();
        return;
      }
    }
  }

  _onInput() {
    this._value = this._textarea.value;
    this._syncHighlight();
    this._updateLineNumbers();
    if (this._onChange) this._onChange(this._textarea.value);
  }

  // -----------------------------------------------------------------------
  // Syntax highlighting
  // -----------------------------------------------------------------------

  _syncHighlight() {
    if (!this._codeEl) return;
    const code = this._textarea?.value || '';

    let highlighted;
    switch (this._language) {
      case LANGUAGES.JSON:
        highlighted = highlightJSON(code);
        break;
      case LANGUAGES.XML:
        highlighted = highlightXML(code);
        break;
      case LANGUAGES.CSHARP:
        highlighted = highlightCSharp(code);
        break;
      case LANGUAGES.JAVASCRIPT:
        highlighted = highlightJavaScript(code);
        break;
      default:
        highlighted = escapeHtml(code);
    }

    // Append a trailing newline so the pre element matches textarea height
    this._codeEl.innerHTML = highlighted + '\n';
  }

  // -----------------------------------------------------------------------
  // Line numbers
  // -----------------------------------------------------------------------

  _updateLineNumbers() {
    if (!this._lineNumbers || !this._showLineNumbers) return;

    const lineCount = (this._textarea?.value || '').split('\n').length;
    const lines = [];
    for (let i = 1; i <= lineCount; i++) {
      lines.push(`<span class="${CSS_PREFIX}-line-num">${i}</span>`);
    }
    this._lineNumbers.innerHTML = lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  _showSearch() {
    if (!this._searchBar) return;
    this._searchVisible = true;
    this._searchBar.style.display = 'flex';
    const input = this._searchBar.querySelector(`.${CSS_PREFIX}-search-input`);
    input?.focus();
    input?.select();
  }

  _hideSearch() {
    if (!this._searchBar) return;
    this._searchVisible = false;
    this._searchBar.style.display = 'none';
    this._searchMatches = [];
    this._currentMatchIndex = -1;
    this._syncHighlight(); // Remove search highlights
    this._textarea?.focus();
  }

  _performSearch(term) {
    this._searchMatches = [];
    this._currentMatchIndex = -1;

    if (!term) {
      this._updateSearchCount();
      this._syncHighlight();
      return;
    }

    const text = this._textarea.value;
    const lowerTerm = term.toLowerCase();
    const lowerText = text.toLowerCase();
    let idx = 0;

    while (idx < lowerText.length) {
      const found = lowerText.indexOf(lowerTerm, idx);
      if (found === -1) break;
      this._searchMatches.push({ start: found, end: found + term.length });
      idx = found + 1;
    }

    if (this._searchMatches.length > 0) {
      this._currentMatchIndex = 0;
      this._scrollToMatch(0);
    }

    this._updateSearchCount();
    this._highlightSearchMatches();
  }

  _navigateSearch(direction) {
    if (this._searchMatches.length === 0) return;
    this._currentMatchIndex = (this._currentMatchIndex + direction + this._searchMatches.length) % this._searchMatches.length;
    this._scrollToMatch(this._currentMatchIndex);
    this._updateSearchCount();
    this._highlightSearchMatches();
  }

  _scrollToMatch(index) {
    const match = this._searchMatches[index];
    if (!match || !this._textarea) return;
    this._textarea.setSelectionRange(match.start, match.end);
    this._textarea.focus();

    // Scroll the textarea to show the match
    const textBefore = this._textarea.value.slice(0, match.start);
    const lineNumber = textBefore.split('\n').length;
    const lineHeight = 20; // matches LINE_HEIGHT
    this._textarea.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
  }

  _updateSearchCount() {
    const label = this._searchBar?.querySelector(`.${CSS_PREFIX}-search-count`);
    if (!label) return;
    const total = this._searchMatches.length;
    if (total === 0) {
      label.textContent = '0 results';
    } else {
      label.textContent = `${this._currentMatchIndex + 1} of ${total}`;
    }
  }

  _highlightSearchMatches() {
    // Re-run syntax highlight with search highlights overlaid
    this._syncHighlight();
    // Search highlighting is visual feedback via textarea selection
    // The actual match is shown via setSelectionRange above
  }

  // -----------------------------------------------------------------------
  // Format / Prettify
  // -----------------------------------------------------------------------

  _format() {
    const text = this.getValue();
    if (!text.trim()) return;

    let formatted;
    try {
      switch (this._language) {
        case LANGUAGES.JSON:
          formatted = JSON.stringify(JSON.parse(text), null, TAB_SIZE);
          break;
        case LANGUAGES.XML:
          formatted = formatXML(text);
          break;
        default:
          // No formatter for other languages
          return;
      }
    } catch (err) {
      // If formatting fails (e.g., invalid JSON), do nothing
      return;
    }

    if (formatted && formatted !== text) {
      this.setValue(formatted);
      if (this._onChange) this._onChange(formatted);
    }
  }

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(`${CSS_PREFIX}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${CSS_PREFIX}-styles`;
    style.textContent = `
      .${CSS_PREFIX}-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        border: 1px solid var(--dvt-border, #333);
        border-radius: 4px;
        overflow: hidden;
        font-family: ${FONT_FAMILY};
        font-size: ${FONT_SIZE};
        line-height: ${LINE_HEIGHT};
        background: #1e1e1e;
        color: #cccccc;
      }
      .${CSS_PREFIX}-readonly .${CSS_PREFIX}-textarea {
        cursor: default;
      }

      /* Toolbar */
      .${CSS_PREFIX}-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: #252526;
        border-bottom: 1px solid #333;
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-lang-label {
        font-size: 10px;
        color: #888;
        text-transform: uppercase;
        font-weight: 600;
        letter-spacing: 0.5px;
        padding: 2px 6px;
        background: #333;
        border-radius: 3px;
      }
      .${CSS_PREFIX}-toolbar-btn {
        padding: 3px 10px;
        border: 1px solid #444;
        border-radius: 3px;
        background: #2d2d2d;
        color: #ccc;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }
      .${CSS_PREFIX}-toolbar-btn:hover {
        background: #3c3c3c;
      }
      .${CSS_PREFIX}-toolbar-btn.active {
        background: #0078d4;
        border-color: #0078d4;
        color: #fff;
      }

      /* Search bar */
      .${CSS_PREFIX}-search-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: #252526;
        border-bottom: 1px solid #333;
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-search-input {
        flex: 1;
        padding: 4px 8px;
        border: 1px solid #444;
        border-radius: 3px;
        background: #3c3c3c;
        color: #ccc;
        font-size: 12px;
        font-family: inherit;
        outline: none;
      }
      .${CSS_PREFIX}-search-input:focus {
        border-color: #0078d4;
      }
      .${CSS_PREFIX}-search-count {
        font-size: 11px;
        color: #888;
        white-space: nowrap;
      }

      /* Editor body */
      .${CSS_PREFIX}-body {
        display: flex;
        flex: 1;
        overflow: hidden;
        position: relative;
      }

      /* Line numbers */
      .${CSS_PREFIX}-line-numbers {
        width: 48px;
        flex-shrink: 0;
        padding: 10px 0;
        background: #1e1e1e;
        border-right: 1px solid #333;
        text-align: right;
        overflow: hidden;
        user-select: none;
        color: #858585;
        font-family: ${FONT_FAMILY};
        font-size: ${FONT_SIZE};
        line-height: ${LINE_HEIGHT};
      }
      .${CSS_PREFIX}-line-num {
        display: block;
        padding: 0 8px 0 4px;
        line-height: ${LINE_HEIGHT};
      }

      /* Editor area (textarea + pre overlay) */
      .${CSS_PREFIX}-editor-area {
        flex: 1;
        position: relative;
        overflow: hidden;
      }

      .${CSS_PREFIX}-textarea,
      .${CSS_PREFIX}-pre {
        margin: 0;
        padding: 10px;
        border: none;
        font-family: ${FONT_FAMILY};
        font-size: ${FONT_SIZE};
        line-height: ${LINE_HEIGHT};
        tab-size: ${TAB_SIZE};
        white-space: pre-wrap;
        overflow-wrap: break-word;
        word-break: normal;
        overflow: auto;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        resize: none;
      }

      .${CSS_PREFIX}-textarea {
        color: transparent;
        caret-color: #aeafad;
        background: transparent;
        outline: none;
        z-index: 2;
        -webkit-text-fill-color: transparent;
      }

      .${CSS_PREFIX}-textarea::selection {
        background: rgba(38, 79, 120, 0.6);
        -webkit-text-fill-color: transparent;
      }

      .${CSS_PREFIX}-pre {
        z-index: 1;
        pointer-events: none;
        background: #1e1e1e;
        margin: 0;
      }
      .${CSS_PREFIX}-code {
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
      }

      /* Syntax colors */
      .${CSS_PREFIX}-key { color: ${COLORS.key}; }
      .${CSS_PREFIX}-string { color: ${COLORS.string}; }
      .${CSS_PREFIX}-number { color: ${COLORS.number}; }
      .${CSS_PREFIX}-boolean { color: ${COLORS.boolean}; }
      .${CSS_PREFIX}-null { color: ${COLORS.null}; }
      .${CSS_PREFIX}-brace { color: ${COLORS.brace}; }
      .${CSS_PREFIX}-punctuation { color: ${COLORS.punctuation}; }
      .${CSS_PREFIX}-tag { color: ${COLORS.tag}; }
      .${CSS_PREFIX}-attr-name { color: ${COLORS.attrName}; }
      .${CSS_PREFIX}-attr-value { color: ${COLORS.attrValue}; }
      .${CSS_PREFIX}-text { color: ${COLORS.text}; }
      .${CSS_PREFIX}-comment { color: ${COLORS.comment}; font-style: italic; }
      .${CSS_PREFIX}-cdata { color: ${COLORS.cdata}; }
      .${CSS_PREFIX}-keyword { color: ${COLORS.keyword}; }
      .${CSS_PREFIX}-type { color: ${COLORS.type}; }
      .${CSS_PREFIX}-function { color: ${COLORS.function}; }
      .${CSS_PREFIX}-operator { color: ${COLORS.operator}; }
      .${CSS_PREFIX}-regex { color: ${COLORS.regex}; }
    `;
    document.head.appendChild(style);
  }
}

export default CodeEditor;
