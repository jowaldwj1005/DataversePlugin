/**
 * AI Customizer — XML Diff Renderer
 *
 * Line-by-line diff with color-coded additions/removals.
 * Word-level highlighting for adjacent del/add pairs.
 * Uses a simple LCS (Longest Common Subsequence) algorithm.
 */

// ---------------------------------------------------------------------------
// Pretty-print XML
// ---------------------------------------------------------------------------

export function prettyXml(xml) {
  if (!xml) return '';
  let s = xml.replace(/>\s+</g, '><').trim();
  let indent = 0;
  const lines = [];
  const tokens = s.match(/<[^>]+>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('</')) {
      indent = Math.max(0, indent - 1);
      lines.push('  '.repeat(indent) + token);
    } else if (token.startsWith('<') && token.endsWith('/>')) {
      lines.push('  '.repeat(indent) + token);
    } else if (token.startsWith('<')) {
      lines.push('  '.repeat(indent) + token);
      indent++;
    } else {
      const text = token.trim();
      if (text) lines.push('  '.repeat(indent) + text);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LCS-based diff
// ---------------------------------------------------------------------------

export function diffLines(beforeLines, afterLines) {
  const m = beforeLines.length;
  const n = afterLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      result.push({ type: 'equal', line: beforeLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', line: afterLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'del', line: beforeLines[i - 1] });
      i--;
    }
  }
  result.reverse();
  return result;
}

// ---------------------------------------------------------------------------
// Word-level diff for adjacent del+add pairs
// ---------------------------------------------------------------------------

/**
 * Split a line into tokens for word-level comparison.
 * Splits on spaces, quotes, angle brackets, equals — keeping delimiters.
 */
function tokenize(line) {
  return line.match(/\s+|[<>="'/]+|[^\s<>="'/]+/g) || [line];
}

/**
 * Produce word-level diff HTML for a del/add pair.
 * Returns { delHtml, addHtml } with <mark> spans around changed words.
 */
function wordDiffPair(delLine, addLine) {
  const delTokens = tokenize(delLine);
  const addTokens = tokenize(addLine);

  // Quick LCS on tokens
  const m = delTokens.length, n = addTokens.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = delTokens[i - 1] === addTokens[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const ops = [];
  let ii = m, jj = n;
  while (ii > 0 || jj > 0) {
    if (ii > 0 && jj > 0 && delTokens[ii - 1] === addTokens[jj - 1]) {
      ops.push({ type: 'equal', del: delTokens[ii - 1], add: addTokens[jj - 1] });
      ii--; jj--;
    } else if (jj > 0 && (ii === 0 || dp[ii][jj - 1] >= dp[ii - 1][jj])) {
      ops.push({ type: 'add', add: addTokens[jj - 1] });
      jj--;
    } else {
      ops.push({ type: 'del', del: delTokens[ii - 1] });
      ii--;
    }
  }
  ops.reverse();

  let delHtml = '', addHtml = '';
  for (const op of ops) {
    if (op.type === 'equal') {
      delHtml += escapeHtml(op.del);
      addHtml += escapeHtml(op.add);
    } else if (op.type === 'del') {
      delHtml += `<mark class="ac-diff-word-change">${escapeHtml(op.del)}</mark>`;
    } else {
      addHtml += `<mark class="ac-diff-word-change">${escapeHtml(op.add)}</mark>`;
    }
  }
  return { delHtml, addHtml };
}

// ---------------------------------------------------------------------------
// Render diff into DOM
// ---------------------------------------------------------------------------

export function renderXmlDiff(beforeXml, afterXml, container) {
  container.innerHTML = '';

  const beforeFormatted = prettyXml(beforeXml);
  const afterFormatted = prettyXml(afterXml);
  const beforeLines = beforeFormatted.split('\n');
  const afterLines = afterFormatted.split('\n');
  const ops = diffLines(beforeLines, afterLines);

  let added = 0, removed = 0;

  const pre = document.createElement('pre');
  pre.className = 'ac-diff-pre';

  // Process ops, pairing adjacent del+add for word-level diff
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];

    if (op.type === 'del' && k + 1 < ops.length && ops[k + 1].type === 'add') {
      // Adjacent del+add pair — use word-level diff
      const addOp = ops[k + 1];
      const { delHtml, addHtml } = wordDiffPair(op.line, addOp.line);

      const delDiv = document.createElement('div');
      delDiv.className = 'ac-diff-line ac-diff-line-del';
      delDiv.innerHTML = `<span class="ac-diff-gutter">-</span><span class="ac-diff-text">${delHtml}</span>`;
      pre.appendChild(delDiv);

      const addDiv = document.createElement('div');
      addDiv.className = 'ac-diff-line ac-diff-line-add';
      addDiv.innerHTML = `<span class="ac-diff-gutter">+</span><span class="ac-diff-text">${addHtml}</span>`;
      pre.appendChild(addDiv);

      removed++;
      added++;
      k++; // Skip the add op
    } else {
      const line = document.createElement('div');
      const escaped = escapeHtml(op.line);

      switch (op.type) {
        case 'del':
          line.className = 'ac-diff-line ac-diff-line-del';
          line.innerHTML = `<span class="ac-diff-gutter">-</span><span class="ac-diff-text">${escaped}</span>`;
          removed++;
          break;
        case 'add':
          line.className = 'ac-diff-line ac-diff-line-add';
          line.innerHTML = `<span class="ac-diff-gutter">+</span><span class="ac-diff-text">${escaped}</span>`;
          added++;
          break;
        default:
          line.className = 'ac-diff-line';
          line.innerHTML = `<span class="ac-diff-gutter"> </span><span class="ac-diff-text">${escaped}</span>`;
      }
      pre.appendChild(line);
    }
  }

  container.appendChild(pre);
  return { added, removed };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
