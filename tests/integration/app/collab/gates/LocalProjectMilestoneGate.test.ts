import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type CollabAuthorityTransferStatus } from '@claudian-collab/protocol';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

import {
  ClaudianCollabService,
  CollabProjectSetupService,
  createCollabFeatureSubcomposition,
} from '@/app/collab';
import { SqlJsProjectDatabase } from '@/app/collab/authority/SqlJsProjectDatabase';
import {
  createAuthorityTransferRecord,
} from '@/app/collab/authority-transfer/AuthorityTransferRecord';

const PROJECT_ID = 'project-m2';
const MEMBER_ID = 'member-host';
const OPERATION_ID = 'create-project-m2';
const CREDENTIAL = 'M'.repeat(43);

jest.setTimeout(30_000);

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

describe('G3 local Project milestone gate', () => {
  let SQL: SqlJsStatic;
  let vaultRoot: string;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(async () => {
    vaultRoot = await mkdtemp(path.join(tmpdir(), 'claudian-m2-gate-'));
  });

  afterEach(async () => {
    if (vaultRoot) await rm(vaultRoot, { force: true, recursive: true });
  });

  function createFoundation(configuredGitPath = ''): ClaudianCollabService {
    return new ClaudianCollabService({
      createAuthorityDatabase: authorityDirectory => (
        new SqlJsProjectDatabase(authorityDirectory, { loadSqlJs: async () => SQL })
      ),
      getConfiguredGitPath: () => configuredGitPath,
      obsidianConfigDirectory: '.obsidian',
      vaultRoot,
    });
  }

  it('creates and reloads one independent empty Project', async () => {
    const foundation = createFoundation();
    const setup = new CollabProjectSetupService(foundation, {
      createCredential: () => CREDENTIAL,
      createId: kind => {
        if (kind === 'member') return MEMBER_ID;
        if (kind === 'operation') return OPERATION_ID;
        return PROJECT_ID;
      },
      now: () => new Date('2026-08-08T00:00:00.000Z'),
      vaultRoot,
    });
    const feature = createCollabFeatureSubcomposition({
      foundation,
      projectSetup: setup,
      vaultRoot,
    }).feature;

    await expect(feature.initialize()).resolves.toMatchObject({ status: 'success' });
    await expect(feature.createProject({
      memberDisplayName: 'Alice',
      name: 'M2 Notes',
    })).resolves.toEqual({
      status: 'success',
      value: expect.objectContaining({
        health: 'healthy',
        id: PROJECT_ID,
        workspacePath: 'workspace/m2-notes',
      }),
    });
    const runtime = await foundation.resolveGitRuntime();
    if (runtime.status !== 'available') throw new Error('Native Git unavailable in M2 gate');
    expect(git(path.join(vaultRoot, 'workspace', 'm2-notes'), [
      'ls-tree',
      '--name-only',
      'HEAD',
    ])).toBe('');
    expect(git(path.join(vaultRoot, 'workspace', 'm2-notes'), [
      'rev-list',
      '--count',
      'HEAD',
    ])).toBe('1');
    await feature.close();
    await foundation.close();

    git(vaultRoot, ['init', '--quiet', '--initial-branch=main']);
    expect(git(vaultRoot, [
      'check-ignore',
      'workspace/m2-notes/.git/config',
      '.claudian/collab/projects/project-m2/membership.json',
    ]).split('\n').sort()).toEqual([
      '.claudian/collab/projects/project-m2/membership.json',
      'workspace/m2-notes/.git/config',
    ]);

    const reopenedFoundation = createFoundation(runtime.runtime.executablePath);
    const reopenedSetup = new CollabProjectSetupService(reopenedFoundation, { vaultRoot });
    const reopenedFeature = createCollabFeatureSubcomposition({
      foundation: reopenedFoundation,
      projectSetup: reopenedSetup,
      vaultRoot,
    }).feature;
    await expect(reopenedFeature.initialize()).resolves.toMatchObject({
      status: 'success',
      value: {
        lifecycle: 'ready',
        projects: [expect.objectContaining({
          health: 'healthy',
          id: PROJECT_ID,
          role: 'manager',
        })],
        selectedProjectId: PROJECT_ID,
      },
    });
    const authority = await reopenedFoundation.openAuthority(PROJECT_ID);
    await expect(authority.database.read(connection => authority.projects.get(connection)))
      .resolves.toMatchObject({
        managerSetGeneration: 0,
        projectId: PROJECT_ID,
        snapshotGeneration: 2,
      });
    await reopenedFeature.close();
    await reopenedFoundation.close();
  });

  it('registers transfer recovery and fences ordinary LAN Host restart', async () => {
    const foundation = createFoundation();
    const transferStatus = (
      phase: 'collecting-readiness' | 'source-quiesced',
    ): CollabAuthorityTransferStatus => ({
      batchRevision: null,
      batchSha256: null,
      checkpointSha256: null,
      createdAt: '2026-08-26T00:00:00.000Z',
      direction: 'lan-to-cloud',
      expiresAt: '2026-09-26T00:00:00.000Z',
      phase,
      projectId: PROJECT_ID,
      relinquishmentProof: null,
      sourceAuthority: { generation: 1, kind: 'lan' },
      state: 'active',
      targetAuthority: { generation: 2, kind: 'cloud' },
      targetUrl: 'https://cloud.example.test/',
      transferId: 'transfer-l2',
      updatedAt: phase === 'collecting-readiness'
        ? '2026-08-26T00:00:00.000Z'
        : '2026-08-26T00:01:00.000Z',
    });
    const collecting = createAuthorityTransferRecord({
      lifecycleOwnership: 'owned',
      localRole: 'source',
      operationIntentId: 'intent-l2',
      stagingDirectoryName: '.claudian-authority-transfer-transfer-l2',
      status: transferStatus('collecting-readiness'),
    });
    await foundation.authorityTransfers.create(collecting);
    const feature = createCollabFeatureSubcomposition({
      foundation,
      projectSetup: new CollabProjectSetupService(foundation, { vaultRoot }),
      vaultRoot,
    }).feature;

    await expect(feature.restoreLifecycle()).rejects.toMatchObject({
      code: 'durable-progress-recovery-required',
      safeContext: { reason: 'authority-transfer-runtime-not-composed' },
    });
    await foundation.authorityTransfers.advance(createAuthorityTransferRecord({
      localRole: 'source',
      operationIntentId: 'intent-l2',
      stagingDirectoryName: '.claudian-authority-transfer-transfer-l2',
      status: transferStatus('source-quiesced'),
    }), 'collecting-readiness');
    await expect(foundation.lanHost.startProject(PROJECT_ID)).rejects.toMatchObject({
      code: 'durable-progress-recovery-required',
      safeContext: { reason: 'authority-transfer-authority-quiesced' },
    });

    await feature.close();
    await foundation.close();
  });
});
