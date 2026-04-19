import { describe, it, expect } from 'vitest';
import { prettyXml, diffLines } from '../../src/sidepanel/modules/ai-customizer/xml-diff.js';

// ---------------------------------------------------------------------------
// prettyXml
// ---------------------------------------------------------------------------

describe('prettyXml', () => {
  it('returns empty string for falsy input', () => {
    expect(prettyXml('')).toBe('');
    expect(prettyXml(null)).toBe('');
    expect(prettyXml(undefined)).toBe('');
  });

  it('indents nested elements', () => {
    const xml = '<root><child><inner/></child></root>';
    const result = prettyXml(xml);
    expect(result).toBe(
      '<root>\n' +
      '  <child>\n' +
      '    <inner/>\n' +
      '  </child>\n' +
      '</root>'
    );
  });

  it('handles self-closing tags without extra indent', () => {
    const xml = '<root><a/><b/></root>';
    const result = prettyXml(xml);
    expect(result).toBe(
      '<root>\n' +
      '  <a/>\n' +
      '  <b/>\n' +
      '</root>'
    );
  });

  it('preserves text content', () => {
    const xml = '<name>Hello World</name>';
    const result = prettyXml(xml);
    expect(result).toBe(
      '<name>\n' +
      '  Hello World\n' +
      '</name>'
    );
  });

  it('strips whitespace between tags before formatting', () => {
    const xml = '<root>   <child>   </child>   </root>';
    const result = prettyXml(xml);
    expect(result).toBe(
      '<root>\n' +
      '  <child>\n' +
      '  </child>\n' +
      '</root>'
    );
  });

  it('handles attributes on tags', () => {
    const xml = '<entity name="account"><attribute name="name"/></entity>';
    const result = prettyXml(xml);
    expect(result).toBe(
      '<entity name="account">\n' +
      '  <attribute name="name"/>\n' +
      '</entity>'
    );
  });
});

// ---------------------------------------------------------------------------
// diffLines
// ---------------------------------------------------------------------------

describe('diffLines', () => {
  it('returns empty array for two empty arrays', () => {
    expect(diffLines([], [])).toEqual([]);
  });

  it('marks all lines as additions when before is empty', () => {
    const result = diffLines([], ['a', 'b']);
    expect(result).toEqual([
      { type: 'add', line: 'a' },
      { type: 'add', line: 'b' },
    ]);
  });

  it('marks all lines as deletions when after is empty', () => {
    const result = diffLines(['a', 'b'], []);
    expect(result).toEqual([
      { type: 'del', line: 'a' },
      { type: 'del', line: 'b' },
    ]);
  });

  it('marks identical arrays as all equal', () => {
    const lines = ['foo', 'bar', 'baz'];
    const result = diffLines(lines, lines);
    expect(result).toEqual([
      { type: 'equal', line: 'foo' },
      { type: 'equal', line: 'bar' },
      { type: 'equal', line: 'baz' },
    ]);
  });

  it('detects a single line change', () => {
    const before = ['<root>', '  <old/>', '</root>'];
    const after = ['<root>', '  <new/>', '</root>'];
    const result = diffLines(before, after);

    expect(result).toEqual([
      { type: 'equal', line: '<root>' },
      { type: 'del', line: '  <old/>' },
      { type: 'add', line: '  <new/>' },
      { type: 'equal', line: '</root>' },
    ]);
  });

  it('detects added lines in the middle', () => {
    const before = ['a', 'c'];
    const after = ['a', 'b', 'c'];
    const result = diffLines(before, after);

    expect(result).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'add', line: 'b' },
      { type: 'equal', line: 'c' },
    ]);
  });

  it('detects removed lines in the middle', () => {
    const before = ['a', 'b', 'c'];
    const after = ['a', 'c'];
    const result = diffLines(before, after);

    expect(result).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'del', line: 'b' },
      { type: 'equal', line: 'c' },
    ]);
  });
});
