import {
  YclientsControlledApprovalFileGate,
  YclientsControlledBindingArtifactFileSink,
  isSameYclientsControlledInode,
  isYclientsControlledOwnedArtifact,
  YclientsControlledRootOnlyFileStore,
} from './yclients-controlled-artifacts';

const DIGEST = 'a'.repeat(64);

class MemoryExclusiveStore implements YclientsControlledRootOnlyFileStore {
  readonly files = new Map<string, string>();

  async read(path: string, maximumBytes: number): Promise<string | undefined> {
    const value = this.files.get(path);
    if (value !== undefined && Buffer.byteLength(value, 'utf8') > maximumBytes) {
      throw new TypeError('too large');
    }
    return value;
  }

  async claim(path: string, contents: string): Promise<'claimed' | 'exists'> {
    if (this.files.has(path)) return 'exists';
    this.files.set(path, contents);
    return 'claimed';
  }
}

describe('controlled root-only artifacts', () => {
  it('rejects wrong ownership/mode and detects an inode replacement', () => {
    const trusted = { uid: 1_001, mode: 0o100600, dev: 7, ino: 11 };

    expect(isYclientsControlledOwnedArtifact(trusted, 1_001)).toBe(true);
    expect(
      isYclientsControlledOwnedArtifact({ ...trusted, uid: 1_002 }, 1_001),
    ).toBe(false);
    expect(
      isYclientsControlledOwnedArtifact({ ...trusted, mode: 0o100640 }, 1_001),
    ).toBe(false);
    expect(isSameYclientsControlledInode(trusted, { ...trusted })).toBe(true);
    expect(
      isSameYclientsControlledInode(trusted, { ...trusted, ino: 12 }),
    ).toBe(false);
    expect(
      isSameYclientsControlledInode(trusted, { ...trusted, dev: 8 }),
    ).toBe(false);
  });

  it('atomically consumes one approval across separate gate instances', async () => {
    const store = new MemoryExclusiveStore();
    store.files.set('/approval', `${DIGEST}\n`);
    const first = new YclientsControlledApprovalFileGate({
      approvalPath: '/approval',
      consumedPath: '/approval.consumed',
      store,
    });
    const second = new YclientsControlledApprovalFileGate({
      approvalPath: '/approval',
      consumedPath: '/approval.consumed',
      store,
    });

    await expect(Promise.all([first.consume(DIGEST), second.consume(DIGEST)]))
      .resolves.toEqual(expect.arrayContaining(['approved', 'consumed']));
    expect(
      (await Promise.all([first.consume(DIGEST), second.consume(DIGEST)])).every(
        (outcome) => outcome === 'consumed',
      ),
    ).toBe(true);
    expect(store.files.get('/approval.consumed')).toBe(`${DIGEST}\n`);
  });

  it('does not consume a missing, malformed, or mismatched approval', async () => {
    const store = new MemoryExclusiveStore();
    const gate = new YclientsControlledApprovalFileGate({
      approvalPath: '/approval',
      consumedPath: '/approval.consumed',
      store,
    });

    await expect(gate.consume(DIGEST)).resolves.toBe('missing');
    store.files.set('/approval', ` ${DIGEST}`);
    await expect(gate.consume(DIGEST)).resolves.toBe('mismatch');
    store.files.set('/approval', `${'b'.repeat(64)}\n`);
    await expect(gate.consume(DIGEST)).resolves.toBe('mismatch');
    expect(store.files.has('/approval.consumed')).toBe(false);
  });

  it('consumes only the configured identity-bound approval digest', async () => {
    const store = new MemoryExclusiveStore();
    const boundDigest = 'b'.repeat(64);
    let expected: string | undefined;
    const gate = new YclientsControlledApprovalFileGate({
      approvalPath: '/approval',
      consumedPath: '/approval.consumed',
      store,
      expectedApprovalDigest: () => expected,
    });
    store.files.set('/approval', `${DIGEST}\n`);

    await expect(gate.consume(DIGEST)).resolves.toBe('mismatch');
    expected = boundDigest;
    await expect(gate.consume(DIGEST)).resolves.toBe('mismatch');
    store.files.set('/approval', `${boundDigest}\n`);
    await expect(gate.consume(DIGEST)).resolves.toBe('approved');
    expect(store.files.get('/approval.consumed')).toBe(`${boundDigest}\n`);
  });

  it('writes one exclusive allowlisted provider binding without PII or record hash', async () => {
    const store = new MemoryExclusiveStore();
    const sink = new YclientsControlledBindingArtifactFileSink({
      bindingPath: '/binding.json',
      store,
    });

    await expect(
      sink.record({ slot: 'A', appointmentId: 17, recordId: 29 }),
    ).resolves.toBeUndefined();
    const artifact = store.files.get('/binding.json');
    expect(JSON.parse(artifact ?? '')).toEqual({
      version: 1,
      slot: 'A',
      appointmentId: 17,
      recordId: 29,
    });
    expect(artifact).not.toContain('phone');
    expect(artifact).not.toContain('email');
    expect(artifact).not.toContain('hash');
    await expect(
      sink.record({ slot: 'A', appointmentId: 18, recordId: 30 }),
    ).rejects.toThrow('already exists');
  });
});
