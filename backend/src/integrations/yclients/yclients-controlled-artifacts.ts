import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { dirname, parse, relative, resolve, sep } from 'node:path';
import type {
  YclientsControlledProviderBinding,
  YclientsControlledRootOnlyBindingSink,
} from './yclients-controlled-lifecycle';
import type {
  YclientsControlledApprovalOutcome,
  YclientsControlledPersistentApprovalGate,
} from './yclients-controlled-runner';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const DIGEST_FILE_PATTERN = /^[a-f0-9]{64}\n?$/u;
const MAX_DIGEST_FILE_BYTES = 65;

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

type ControlledArtifactStat = Readonly<{
  uid: number;
  mode: number;
  dev: number;
  ino: number;
}>;

export function isYclientsControlledOwnedArtifact(
  stat: ControlledArtifactStat,
  expectedUid: number,
): boolean {
  return stat.uid === expectedUid && (stat.mode & 0o077) === 0;
}

export function isSameYclientsControlledInode(
  left: ControlledArtifactStat,
  right: ControlledArtifactStat,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function effectiveUid(): number {
  const value =
    typeof process.geteuid === 'function' ? process.geteuid() : undefined;
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new TypeError('Controlled artifacts require a POSIX effective UID');
  }
  return value as number;
}

export interface YclientsControlledRootOnlyFileStore {
  read(path: string, maximumBytes: number): Promise<string | undefined>;
  claim(path: string, contents: string): Promise<'claimed' | 'exists'>;
}

/** Linux/Selectel implementation; callers must provide a root-only directory. */
export class YclientsControlledNodeRootOnlyFileStore
  implements YclientsControlledRootOnlyFileStore
{
  constructor(private readonly expectedUid = effectiveUid()) {
    if (!Number.isSafeInteger(expectedUid) || expectedUid < 0) {
      throw new TypeError('Invalid controlled artifact owner');
    }
  }

  private async verifyAncestors(path: string): Promise<void> {
    const parent = dirname(resolve(path));
    const root = parse(parent).root;
    const components = relative(root, parent)
      .split(sep)
      .filter((component) => component.length > 0);
    let current = root;
    for (const component of components) {
      current = resolve(current, component);
      const stat = await lstat(current);
      const isParent = current === parent;
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        (stat.uid !== 0 && stat.uid !== this.expectedUid) ||
        (stat.mode & 0o022) !== 0 ||
        (isParent && !isYclientsControlledOwnedArtifact(stat, this.expectedUid))
      ) {
        throw new TypeError('Invalid root-only controlled artifact directory');
      }
    }
  }

  private async verifyParent(
    path: string,
    synchronize = false,
  ): Promise<ControlledArtifactStat> {
    if (path !== resolve(path)) {
      throw new TypeError('Controlled artifact path must be absolute');
    }
    await this.verifyAncestors(path);
    const directory = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await directory.stat();
      if (
        !stat.isDirectory() ||
        !isYclientsControlledOwnedArtifact(stat, this.expectedUid)
      ) {
        throw new TypeError('Invalid root-only controlled artifact directory');
      }
      if (synchronize) await directory.sync();
      return Object.freeze({
        uid: stat.uid,
        mode: stat.mode,
        dev: stat.dev,
        ino: stat.ino,
      });
    } finally {
      await directory.close();
    }
  }

  async read(path: string, maximumBytes: number): Promise<string | undefined> {
    const parent = await this.verifyParent(path);
    let handle;
    try {
      handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        !isYclientsControlledOwnedArtifact(stat, this.expectedUid) ||
        stat.size < 0 ||
        stat.size > maximumBytes
      ) {
        throw new TypeError('Invalid root-only controlled artifact');
      }
      const contents = await handle.readFile({ encoding: 'utf8' });
      if (
        !isSameYclientsControlledInode(
          parent,
          await this.verifyParent(path),
        )
      ) {
        throw new TypeError('Controlled artifact directory changed');
      }
      return contents;
    } finally {
      await handle.close();
    }
  }

  async claim(path: string, contents: string): Promise<'claimed' | 'exists'> {
    const parent = await this.verifyParent(path);
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    handle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(contents, { encoding: 'utf8' });
      await handle.sync();
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        !isYclientsControlledOwnedArtifact(stat, this.expectedUid)
      ) {
        throw new TypeError('Invalid root-only temporary artifact');
      }
    } finally {
      await handle.close();
    }
    try {
      if (
        !isSameYclientsControlledInode(
          parent,
          await this.verifyParent(path),
        )
      ) {
        throw new TypeError('Controlled artifact directory changed');
      }
      try {
        await link(temporaryPath, path);
      } catch (error) {
        if (errorCode(error) === 'EEXIST') return 'exists';
        throw error;
      }
      const temporary = await lstat(temporaryPath);
      const claimed = await lstat(path);
      const currentParent = await this.verifyParent(path, true);
      if (
        !temporary.isFile() ||
        !claimed.isFile() ||
        !isSameYclientsControlledInode(temporary, claimed) ||
        !isYclientsControlledOwnedArtifact(claimed, this.expectedUid) ||
        !isSameYclientsControlledInode(parent, currentParent)
      ) {
        throw new TypeError('Controlled artifact claim changed');
      }
      return 'claimed';
    } finally {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
  }
}

export class YclientsControlledApprovalFileGate
  implements YclientsControlledPersistentApprovalGate
{
  readonly persistence = 'cross_process' as const;

  constructor(
    private readonly configuration: Readonly<{
      approvalPath: string;
      consumedPath: string;
      store: YclientsControlledRootOnlyFileStore;
      expectedApprovalDigest?: string | (() => string | undefined);
    }>,
  ) {}

  async consume(planDigest: string): Promise<YclientsControlledApprovalOutcome> {
    if (!DIGEST_PATTERN.test(planDigest)) return 'mismatch';
    const configuredApprovalDigest =
      typeof this.configuration.expectedApprovalDigest === 'function'
        ? this.configuration.expectedApprovalDigest()
        : this.configuration.expectedApprovalDigest;
    const expectedApprovalDigest =
      this.configuration.expectedApprovalDigest === undefined
        ? planDigest
        : configuredApprovalDigest;
    if (
      typeof expectedApprovalDigest !== 'string' ||
      !DIGEST_PATTERN.test(expectedApprovalDigest)
    ) {
      return 'mismatch';
    }
    try {
      const consumed = await this.configuration.store.read(
        this.configuration.consumedPath,
        MAX_DIGEST_FILE_BYTES,
      );
      if (consumed !== undefined) return 'consumed';
      const approved = await this.configuration.store.read(
        this.configuration.approvalPath,
        MAX_DIGEST_FILE_BYTES,
      );
      if (approved === undefined) return 'missing';
      if (!DIGEST_FILE_PATTERN.test(approved)) return 'mismatch';
      if (approved.replace(/\n$/u, '') !== expectedApprovalDigest) {
        return 'mismatch';
      }
      return (await this.configuration.store.claim(
        this.configuration.consumedPath,
        `${expectedApprovalDigest}\n`,
      )) === 'claimed'
        ? 'approved'
        : 'consumed';
    } catch {
      return 'consumed';
    }
  }
}

export class YclientsControlledBindingArtifactFileSink
  implements YclientsControlledRootOnlyBindingSink
{
  readonly persistence = 'root_only_exclusive' as const;

  constructor(
    private readonly configuration: Readonly<{
      bindingPath: string;
      store: YclientsControlledRootOnlyFileStore;
    }>,
  ) {}

  async record(binding: YclientsControlledProviderBinding): Promise<void> {
    if (
      binding?.slot !== 'A' ||
      !Number.isSafeInteger(binding.appointmentId) ||
      binding.appointmentId <= 0 ||
      !Number.isSafeInteger(binding.recordId) ||
      binding.recordId <= 0
    ) {
      throw new TypeError('Invalid controlled provider binding');
    }
    const artifact = `${JSON.stringify({
      version: 1,
      slot: binding.slot,
      appointmentId: binding.appointmentId,
      recordId: binding.recordId,
    })}\n`;
    if (
      (await this.configuration.store.claim(
        this.configuration.bindingPath,
        artifact,
      )) !== 'claimed'
    ) {
      throw new TypeError('Controlled provider binding already exists');
    }
  }
}
