import {
  createCollabProjectLifecycleDurableOwners,
} from '@/app/collab/lifecycle/CollabProjectLifecycleOwners';

function stores() {
  return {
    cloudBootstrapTransitions: { inspectLifecycleOwner: jest.fn().mockResolvedValue('absent') },
    hostTransferRecovery: { load: jest.fn().mockResolvedValue(null) },
    localCleanup: { load: jest.fn().mockResolvedValue(null) },
    managerReceipts: { load: jest.fn().mockResolvedValue(null) },
    pendingLeaves: { load: jest.fn().mockResolvedValue(null) },
    retiredCleanups: { load: jest.fn().mockResolvedValue(null) },
    retirements: { loadRetirementRecord: jest.fn().mockResolvedValue(null) },
    retirementTombstones: { loadRetirementTombstone: jest.fn().mockResolvedValue(null) },
  };
}

describe('CollabProjectLifecycleOwners', () => {
  it('projects real durable lifecycle records into the shared arbiter', async () => {
    const backing = stores();
    backing.hostTransferRecovery.load.mockImplementation(async (_projectId, direction) => (
      direction === 'incoming' ? { direction: 'incoming' } : null
    ));
    backing.pendingLeaves.load.mockResolvedValue({ phase: 'queued' });
    backing.managerReceipts.load.mockResolvedValue({ status: 'acknowledged' });
    backing.retirements.loadRetirementRecord.mockResolvedValue({ cleanupStatus: 'complete' });
    backing.cloudBootstrapTransitions.inspectLifecycleOwner.mockResolvedValue('nonterminal');
    const owners = createCollabProjectLifecycleDurableOwners(backing);

    await expect(Promise.all(owners.map(async owner => ({
      name: owner.name,
      state: await owner.inspect('project-alpha'),
    })))).resolves.toEqual([
      { name: 'cloud-bootstrap', state: 'nonterminal' },
      { name: 'host-transfer', state: 'nonterminal' },
      { name: 'manager-responsibility', state: 'terminal' },
      { name: 'local-exit', state: 'terminal' },
      { name: 'retirement', state: 'nonterminal' },
    ]);
  });

  it('treats completed bootstrap cleanup as terminal and absent stores as absent', async () => {
    const backing = stores();
    backing.cloudBootstrapTransitions.inspectLifecycleOwner.mockResolvedValue('terminal');
    const owners = createCollabProjectLifecycleDurableOwners(backing);

    await expect(Promise.all(owners.map(async owner => ({
      name: owner.name,
      state: await owner.inspect('project-alpha'),
    })))).resolves.toEqual([
      { name: 'cloud-bootstrap', state: 'terminal' },
      { name: 'host-transfer', state: 'absent' },
      { name: 'manager-responsibility', state: 'absent' },
      { name: 'local-exit', state: 'absent' },
      { name: 'retirement', state: 'absent' },
    ]);
  });

  it('classifies a reversible Manager offer as a proposal until the target acknowledges it', async () => {
    const backing = stores();
    backing.managerReceipts.load.mockResolvedValue({ status: 'offered' });
    const owner = createCollabProjectLifecycleDurableOwners(backing)
      .find(candidate => candidate.name === 'manager-responsibility')!;

    await expect(owner.inspect('project-alpha')).resolves.toBe('proposal');

    backing.managerReceipts.load.mockResolvedValue({ status: 'acknowledged' });
    await expect(owner.inspect('project-alpha')).resolves.toBe('nonterminal');
  });

  it('lets a pending Leave durably subsume an acknowledged Manager receipt', async () => {
    const backing = stores();
    backing.managerReceipts.load.mockResolvedValue({ status: 'acknowledged' });
    backing.pendingLeaves.load.mockResolvedValue({ phase: 'queued' });
    const owners = createCollabProjectLifecycleDurableOwners(backing);
    const managerResponsibility = owners.find(owner => owner.name === 'manager-responsibility')!;
    const localExit = owners.find(owner => owner.name === 'local-exit')!;

    await expect(managerResponsibility.inspect('project-alpha')).resolves.toBe('terminal');
    await expect(localExit.inspect('project-alpha')).resolves.toBe('nonterminal');
  });

  it('fails closed when both Host-transfer directions exist', async () => {
    const backing = stores();
    backing.hostTransferRecovery.load.mockResolvedValue({ phase: 'accepted' });
    const hostTransfer = createCollabProjectLifecycleDurableOwners(backing)
      .find(owner => owner.name === 'host-transfer')!;

    await expect(hostTransfer.inspect('project-alpha'))
      .rejects.toThrow('Conflicting Host transfer recovery records');
  });

  it('lets a durable retirement absorb an overlapping pending Leave', async () => {
    const backing = stores();
    backing.pendingLeaves.load.mockResolvedValue({ phase: 'recovery-required' });
    backing.retirements.loadRetirementRecord.mockResolvedValue({ cleanupStatus: 'pending' });
    const owners = createCollabProjectLifecycleDurableOwners(backing);
    const localExit = owners.find(owner => owner.name === 'local-exit')!;
    const retirement = owners.find(owner => owner.name === 'retirement')!;

    await expect(localExit.inspect('project-alpha')).resolves.toBe('terminal');
    await expect(retirement.inspect('project-alpha')).resolves.toBe('nonterminal');
  });

  it('keeps retirement ownership after the authority tombstone commits before local delivery', async () => {
    const backing = stores();
    backing.retirementTombstones.loadRetirementTombstone.mockResolvedValue({
      kind: 'retirement-tombstone',
    });
    const retirement = createCollabProjectLifecycleDurableOwners(backing)
      .find(owner => owner.name === 'retirement')!;

    await expect(retirement.inspect('project-alpha')).resolves.toBe('nonterminal');
  });
});
