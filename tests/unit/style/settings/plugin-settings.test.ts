import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Plugin settings styles', () => {
  it('removes only the verified static orphans and retains the colliding item and status selectors', () => {
    const css = readFileSync(path.resolve('src/style/settings/plugin-settings.css'), 'utf8');

    for (const orphan of [
      'claudian-plugin-error-badge',
      'claudian-plugin-item-error',
      'claudian-plugin-preview',
      'claudian-plugin-preview-error',
      'claudian-plugin-status-error',
      'claudian-plugin-version-badge',
    ]) {
      expect(css).not.toContain(orphan);
    }

    expect(css).toContain('.claudian-plugin-item {');
    expect(css).toContain('.claudian-plugin-item-disabled {');
    expect(css).toContain('.claudian-plugin-status {');
    expect(css).toContain('.claudian-plugin-status-enabled {');
    expect(css).toContain('.claudian-plugin-status-disabled {');
  });
});
