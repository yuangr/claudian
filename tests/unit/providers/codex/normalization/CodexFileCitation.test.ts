import { stripCodexFileCitations } from '@/providers/codex/normalization/CodexFileCitation';

const citation = ':codex-file-citation{path="/vault/note.md" purpose="source"}';

it.each([
  citation,
  ':codex-file-citation[codex-file-citation]{line_range_start=3 path="/vault/note.md"}',
  ':codex-file-citation{path="/vault/a } file.md" page_number="4" artifact_kind="document"}',
  ':codex-file-citation{path="/vault/a [b] `code`.md"}',
  ':codex-file-citation{path=note.md}',
  ":codex-file-citation{path='note.md'}",
  String.raw`:codex-file-citation{path="C:\Users\me\"}`,
  String.raw`:codex-file-citation{path="a\"b.md"}`,
  `::${citation.slice(1)}`,
  `:::${citation.slice(1)}`,
])('removes a complete supported native file annotation: %s', source => {
  expect(stripCodexFileCitations(`Before.${source} After.`)).toBe('Before. After.');
});

it.each([
  '`' + citation + '`',
  '```text\n' + citation + '\n```',
  '    ' + citation,
  '$' + citation + '$',
  '$$\n' + citation + '\n$$',
  `[literal ${citation}](https://example.test)`,
  `![literal ${citation}](image.png)`,
  `[literal\n${citation}](https://example.test)`,
  `<pre>\n${citation}\n</pre>`,
  `<span title='${citation}'>literal</span>`,
  `[source]: <https://example.test/${citation}>`,
  `[${citation}]: /note.md`,
  '\\' + citation,
  '\\:codex-file-citation{path=":codex-file-citation{path=note.md}"}',
  `::::${citation.slice(1)}`,
  ':codex-file-citation{purpose="source"}',
  ':codex-file-citation{path=""}',
  ':codex-file-citation{path="unfinished}',
  ':codex-file-citation{path="first" path="duplicate"}',
])('preserves literal Markdown and incomplete or invalid annotations: %s', source => {
  expect(stripCodexFileCitations(source)).toBe(source);
});

it('removes adjacent annotations without consuming surrounding text or existing token-like text', () => {
  expect(stripCodexFileCitations(`:CC0} ${citation}${citation} End.`)).toBe(':CC0}  End.');
});

it('leaves malformed repeated candidates literal without unbounded fallback scans', () => {
  const malformed = ':codex-file-citation{path="'.repeat(2000);
  expect(stripCodexFileCitations(malformed)).toBe(malformed);
});
