interface MentionLookupMatch {
  resolvedPath: string;
  endIndex: number;
}

const TRAILING_PUNCTUATION_REGEX = /[),.!?:;]+$/;
const BOUNDARY_PUNCTUATION = new Set([',', ')', '!', '?', ':', ';']);

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function collectMentionEndCandidates(text: string, pathStart: number): number[] {
  const candidates = new Set<number>();

  for (let index = pathStart; index < text.length; index++) {
    const char = text[index];
    if (isWhitespace(char)) {
      candidates.add(index);
      continue;
    }

    if (BOUNDARY_PUNCTUATION.has(char)) {
      candidates.add(index + 1);
    }
  }

  candidates.add(text.length);
  return Array.from(candidates).sort((a, b) => b - a);
}

/** Ends where a literal path may stop, including just before sentence punctuation. */
function collectLiteralMentionEndCandidates(text: string, pathStart: number): number[] {
  const candidates = new Set<number>();

  for (let index = pathStart; index < text.length; index++) {
    const char = text[index];
    if (isWhitespace(char) || BOUNDARY_PUNCTUATION.has(char)) {
      candidates.add(index);
      continue;
    }
    // A sentence period ends a literal path; a dot inside a name (`file.md`) continues it.
    if (char === '.' && (
      index + 1 === text.length
      || isWhitespace(text[index + 1])
      || TRAILING_PUNCTUATION_REGEX.test(text[index + 1])
    )) {
      candidates.add(index);
    }
  }

  candidates.add(text.length);
  return Array.from(candidates).sort((a, b) => b - a);
}

function isMentionStart(text: string, index: number): boolean {
  if (text[index] !== '@') return false;
  if (index === 0) return true;
  return isWhitespace(text[index - 1]);
}

function normalizeMentionPath(pathText: string): string {
  return pathText
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
}

function normalizeForPlatformLookup(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function lookupResolvedPath(rawPath: string, pathLookup: Map<string, string>): string | null {
  const normalizedPath = normalizeMentionPath(rawPath);
  if (!normalizedPath) return null;
  return pathLookup.get(normalizeForPlatformLookup(normalizedPath)) ?? null;
}

function findBestMentionLookupMatch(
  text: string,
  pathStart: number,
  pathLookup: Map<string, string>
): MentionLookupMatch | null {
  if (pathLookup.size === 0 || pathStart >= text.length) return null;

  // The longest known literal path keeps its own punctuation (`@Report!`); only
  // when no literal path matches may trailing characters be sentence punctuation.
  for (const endIndex of collectLiteralMentionEndCandidates(text, pathStart)) {
    if (endIndex <= pathStart) continue;

    const resolvedPath = lookupResolvedPath(text.slice(pathStart, endIndex), pathLookup);
    if (resolvedPath) {
      return {
        resolvedPath,
        endIndex,
      };
    }
  }

  for (const endIndex of collectMentionEndCandidates(text, pathStart)) {
    if (endIndex <= pathStart) continue;

    const rawPath = text.slice(pathStart, endIndex);
    const trailingPunctuation = rawPath.match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? '';
    if (!trailingPunctuation) continue;

    const resolvedPath = lookupResolvedPath(rawPath.slice(0, -trailingPunctuation.length), pathLookup);
    if (resolvedPath) {
      return {
        resolvedPath,
        endIndex,
      };
    }
  }

  return null;
}

/** Vault files named by whitespace-led `@path` mentions in a message, in first-seen order. */
export function resolveContextFiles(message: string, vaultFiles: readonly { path: string }[]): string[] {
  if (!message.includes('@')) return [];

  const pathLookup = new Map<string, string>();
  for (const file of vaultFiles) {
    // TFile paths are already Vault-relative; filesystem normalization would
    // expand literal `%VAR%`/`$VAR` segments and stat every file.
    const lookupKey = normalizeForPlatformLookup(normalizeMentionPath(file.path));
    if (lookupKey && !pathLookup.has(lookupKey)) {
      pathLookup.set(lookupKey, file.path);
    }
  }

  const resolved = new Set<string>();
  for (let index = 0; index < message.length; index++) {
    if (!isMentionStart(message, index)) continue;

    const vaultMatch = findBestMentionLookupMatch(message, index + 1, pathLookup);
    if (vaultMatch) {
      resolved.add(vaultMatch.resolvedPath);
      index = vaultMatch.endIndex - 1;
    }
  }

  return [...resolved];
}
