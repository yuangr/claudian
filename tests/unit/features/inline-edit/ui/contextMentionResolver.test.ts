import { resolveContextFiles } from '@/features/inline-edit/ui/contextMentionResolver';

const files = (...paths: string[]) => paths.map(path => ({ path }));

describe('resolveContextFiles', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('resolves mentions at the start of the message or after whitespace only', () => {
    const vault = files('note.md', 'test.com');
    expect(resolveContextFiles('@note.md', vault)).toEqual(['note.md']);
    expect(resolveContextFiles('check\n@note.md', vault)).toEqual(['note.md']);
    expect(resolveContextFiles('email@test.com', vault)).toEqual([]);
  });

  it('prefers the longest Vault path and stops before trailing punctuation', () => {
    expect(resolveContextFiles('Check @src/my file.md, then continue', files('src/my', 'src/my file.md')))
      .toEqual(['src/my file.md']);
  });

  it.each([
    {
      name: 'only a punctuation-ended path is known',
      vault: ['Report!'],
      message: 'Improve @Report!',
      expected: ['Report!'],
    },
    {
      name: 'a shorter stem is known as well',
      vault: ['Report', 'Report!'],
      message: 'Improve @Report!',
      expected: ['Report!'],
    },
    {
      name: 'sentence punctuation follows a punctuation-ended path',
      vault: ['Report', 'Report!'],
      message: 'Improve @Report!,please',
      expected: ['Report!'],
    },
    {
      name: 'sentence punctuation follows a normal path',
      vault: ['note.md'],
      message: 'Improve @note.md, please',
      expected: ['note.md'],
    },
    {
      name: 'a sentence period follows a spaced path',
      vault: ['src/my', 'src/my file.md'],
      message: 'Check @src/my file.md. then continue',
      expected: ['src/my file.md'],
    },
    {
      name: 'a repeated period follows a period-ended path',
      vault: ['Report', 'Report.'],
      message: 'Improve @Report..',
      expected: ['Report.'],
    },
    {
      name: 'an unknown Unicode extension does not attach its shorter stem',
      vault: ['Report'],
      message: 'Improve @Report.\u4e2d\u6587',
      expected: [],
    },
    {
      name: 'a known Unicode extension remains a literal path',
      vault: ['Report', 'Report.\u4e2d\u6587'],
      message: 'Improve @Report.\u4e2d\u6587',
      expected: ['Report.\u4e2d\u6587'],
    },
    {
      name: 'an unknown ordinary extension does not attach its shorter stem',
      vault: ['Report'],
      message: 'Improve @Report.md',
      expected: [],
    },
    {
      name: 'an unknown dollar suffix does not attach its shorter stem',
      vault: ['Report'],
      message: 'Improve @Report.$draft',
      expected: [],
    },
  ])('keeps the longest known literal path before punctuation fallback: $name', ({ vault, message, expected }) => {
    expect(resolveContextFiles(message, files(...vault))).toEqual(expected);
  });

  it('normalizes typed separators and leading ./ but returns the Vault path', () => {
    expect(resolveContextFiles('Use @./src\\folder//file.md/ please', files('src/folder/file.md')))
      .toEqual(['src/folder/file.md']);
  });

  it('matches case-insensitively only on Windows', () => {
    const vault = files('SRC/FILE.MD');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(resolveContextFiles('@src/file.md', vault)).toEqual(['SRC/FILE.MD']);
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(resolveContextFiles('@src/file.md', vault)).toEqual([]);
  });

  it('deduplicates repeated mentions in first-seen order and ignores unknown paths', () => {
    expect(resolveContextFiles('@b.md @missing/path @a.md @b.md', files('a.md', 'b.md')))
      .toEqual(['b.md', 'a.md']);
  });
});
