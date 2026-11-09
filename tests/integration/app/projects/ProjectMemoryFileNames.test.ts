import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { App } from 'obsidian';

import { ProjectService } from '@/app/projects/ProjectService';
import { ProjectStore } from '@/app/projects/ProjectStore';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

describe('project memory files with long names', () => {
  let root: string;
  let files: VaultFileAdapter;
  let projects: ProjectService;
  let store: ProjectStore;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-project-memory-')));
    const resolve = (relative: string) => path.join(root, ...relative.split('/'));
    files = new VaultFileAdapter({
      vault: { adapter: {
        getBasePath: () => root,
        read: (relative: string) => fs.readFile(resolve(relative), 'utf8'),
        mkdir: (relative: string) => fs.mkdir(resolve(relative), { recursive: true }),
        stat: async (relative: string) => {
          const stat = await fs.stat(resolve(relative));
          return { type: stat.isFile() ? 'file' : 'folder', size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
        },
        list: async (relative: string) => {
          const entries = await fs.readdir(resolve(relative), { withFileTypes: true });
          return {
            files: entries.filter(entry => entry.isFile()).map(entry => `${relative}/${entry.name}`),
            folders: entries.filter(entry => entry.isDirectory()).map(entry => `${relative}/${entry.name}`),
          };
        },
      } },
    } as unknown as App);
    store = new ProjectStore(files);
    projects = new ProjectService([], { store, memory: files });
  });

  afterEach(async () => {
    await projects.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    ['ASCII', `${'a'.repeat(247)}.md`],
    ['multibyte', `${'记'.repeat(80)}.md`],
  ])('creates, saves and recreates a legal long %s basename without temporary leftovers', async (_label, name) => {
    const memoryPath = `Memory/${name}`;
    const record = await projects.create({ name: 'Long name', instructions: '', memoryPath });
    const initial = await projects.readMemory(record.id);
    if ('missing' in initial) throw new Error('Expected newly created memory');
    expect(initial.content).toContain('# Long name');

    await projects.saveMemory(record.id, '# Saved edits\n', initial.revision);

    expect(await fs.readFile(path.join(root, memoryPath), 'utf8')).toBe('# Saved edits\n');
    expect((await store.load()).records).toEqual([record]);
    expect(await fs.readdir(path.join(root, 'Memory'))).toEqual([name]);

    await fs.unlink(path.join(root, memoryPath));
    const recreated = await projects.recreateMemory(record.id);

    expect(recreated.content).toBe(initial.content);
    expect(await fs.readFile(path.join(root, memoryPath), 'utf8')).toBe(initial.content);
    expect(await fs.readdir(path.join(root, 'Memory'))).toEqual([name]);
  });
});
