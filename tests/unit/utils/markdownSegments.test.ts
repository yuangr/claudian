import { transformMarkdownSegments } from '@/utils/markdownSegments';

it.each([
  { preserveLiterals: false, expected: 'new [new](same.md) ![new](same.png) $new$\n\n$$\nnew\n$$\n' },
  { preserveLiterals: true, expected: 'new [same](same.md) ![same](same.png) $same$\n\n$$\nsame\n$$\n' },
])('keeps existing transforms compatible while optionally preserving literal math and links ($preserveLiterals)', ({ preserveLiterals, expected }) => {
  const source = 'same [same](same.md) ![same](same.png) $same$\n\n$$\nsame\n$$\n';
  expect(transformMarkdownSegments(source, {
    preserveLiterals,
    text: value => value.replaceAll('same', 'new'),
  })).toBe(expected);
});

it('preserves a complete multiline link while still transforming the surrounding prose', () => {
  const source = 'same [same\n`same` and same](same.md) same';
  expect(transformMarkdownSegments(source, {
    preserveLiterals: true,
    text: value => value.replaceAll('same', 'new'),
  })).toBe('new [same\n`same` and same](same.md) new');
});
