import { transformMarkdownSegments } from '@/utils/markdownSegments';

interface ScanBudget { remaining: number; }

/** Reads native attributes using literal quotes first, with escaped-quote compatibility. */
function readCitationEnd(source: string, start: number, escapedQuotes: boolean, budget: ScanBudget): number | null {
  let cursor = start;
  const attributes = new Set<string>();
  let hasPath = false;
  const take = (): string | undefined => budget.remaining-- > 0 ? source[cursor++] : undefined;
  const skipSpace = (): boolean => {
    while (source[cursor] === ' ' || source[cursor] === '\t') if (take() === undefined) return false;
    return true;
  };
  while (cursor < source.length && budget.remaining > 0) {
    if (!skipSpace()) return null;
    if (source[cursor] === '}') return hasPath ? cursor + 1 : null;
    let key = '';
    while (/[A-Za-z0-9_-]/.test(source[cursor] ?? '')) {
      const character = take();
      if (character === undefined) return null;
      key += character;
    }
    if (!key || attributes.has(key) || !skipSpace() || take() !== '=' || !skipSpace()) return null;
    const quote = source[cursor] === '"' || source[cursor] === "'" ? take() : undefined;
    let value = '';
    if (quote) {
      let closed = false;
      while (cursor < source.length) {
        const character = take();
        if (character === undefined || character === '\n' || character === '\r') return null;
        if (character === quote) { closed = true; break; }
        if (escapedQuotes && character === '\\' && source[cursor] === quote) {
          if (take() === undefined) return null;
          value += quote;
        } else {
          value += character;
        }
      }
      if (!closed) return null;
    } else {
      while (cursor < source.length && !/[\t \r\n}]/.test(source[cursor])) {
        const character = take();
        if (character === undefined) return null;
        value += character;
      }
      if (!value) return null;
    }
    attributes.add(key);
    if (key === 'path') hasPath = value.length > 0;
  }
  return null;
}

/** Presentation-only native annotations; stored assistant text and literal Markdown stay intact. */
export function stripCodexFileCitations(markdown: string): string {
  if (!markdown.includes('codex-file-citation')) return markdown;
  const marker = /:{1,3}codex-file-citation(?:\[codex-file-citation\])?\{/g;
  const tokenPattern = /:CC\d+}/g;
  const occupied = new Set(markdown.match(tokenPattern));
  const originals = new Map<string, string>();
  const preferred = { remaining: markdown.length * 4 };
  const fallback = { remaining: markdown.length * 4 };
  const parts: string[] = [];
  let offset = 0;
  let nextToken = 0;
  for (let match = marker.exec(markdown); match; match = marker.exec(markdown)) {
    if (markdown[match.index - 1] === ':') continue;
    let slashes = 0;
    for (let index = match.index - 1; markdown[index] === '\\'; index--) slashes++;
    const end = readCitationEnd(markdown, marker.lastIndex, false, preferred)
      ?? readCitationEnd(markdown, marker.lastIndex, true, fallback);
    if (end === null) continue;
    marker.lastIndex = end;
    if (slashes % 2 !== 0) continue;
    let token: string;
    do { token = `:CC${nextToken++}}`; } while (occupied.has(token));
    originals.set(token, markdown.slice(match.index, end));
    parts.push(markdown.slice(offset, match.index), token);
    offset = end;
  }
  if (originals.size === 0) return markdown;
  parts.push(markdown.slice(offset));
  // Mask annotation interiors before segmentation so quoted paths cannot become Markdown syntax.
  const transformed = transformMarkdownSegments(parts.join(''), {
    preserveLiterals: true,
    text: text => text.replace(tokenPattern, token => originals.has(token) ? '' : token),
  });
  return transformed.replace(tokenPattern, token => originals.get(token) ?? token);
}
