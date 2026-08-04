import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `execFile` carries a `util.promisify.custom` implementation, which is why
 * `promisify(execFile)` resolves to `{ stdout, stderr }` rather than a bare
 * string. The mock has to provide the same, or BdService would see a string.
 */
type ExecResult = { stdout: string; stderr: string };
type ExecImpl = (
  file: string,
  args: string[],
  options: Record<string, unknown>,
) => Promise<ExecResult>;

let impl: ExecImpl;
const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];

vi.mock('node:child_process', () => {
  const execFile = (): never => {
    throw new Error('callback form is not used');
  };
  Object.defineProperty(execFile, promisify.custom, {
    value: (file: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options });
      return impl(file, args, options);
    },
  });
  return { execFile };
});

const { BdService, BdError } = await import('../extension/bd/BdService');

function ok(stdout: string): ExecImpl {
  return async () => ({ stdout, stderr: '' });
}

function fail(error: Partial<{ code: number | string; stdout: string; stderr: string }>): ExecImpl {
  return async () => {
    throw Object.assign(new Error('exec failed'), { stdout: '', stderr: '', ...error });
  };
}

function service(): InstanceType<typeof BdService> {
  return new BdService({ cwd: '/repo' });
}

describe('BdService', () => {
  beforeEach(() => {
    calls.length = 0;
    impl = ok('[]');
  });

  it('appends --json and returns a legacy bare array unchanged', async () => {
    impl = ok('[{"id":"bd-1","title":"one"}]');

    const result = await service().json<Array<{ id: string }>>(['list']);

    expect(calls[0].args).toEqual(['list', '--json']);
    expect(result).toEqual([{ id: 'bd-1', title: 'one' }]);
  });

  it('unwraps the schema_version envelope when bd emits one', async () => {
    impl = ok('{"schema_version":1,"data":[{"id":"bd-2"}]}');

    const result = await service().json<Array<{ id: string }>>(['list']);

    expect(result).toEqual([{ id: 'bd-2' }]);
  });

  it('leaves a keyed payload alone when it is not an envelope', async () => {
    impl = ok('{"schema_version":1,"built_in_statuses":[{"name":"open"}]}');

    const result = await service().json<{ built_in_statuses: unknown[] }>(['statuses']);

    expect(result.built_in_statuses).toHaveLength(1);
  });

  it('pins BD_JSON_ENVELOPE=0 so a user shell export cannot change the shape', async () => {
    await service().json(['list']);

    const env = calls[0].options.env as Record<string, string>;
    expect(env.BD_JSON_ENVELOPE).toBe('0');
  });

  it('maps a plain-text stderr failure onto a readable bd-error', async () => {
    impl = fail({ code: 1, stderr: 'Error: invalid issue type "epic,task"\nusage: ...' });

    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: {
        kind: 'bd-error',
        message: 'invalid issue type "epic,task"',
        exitCode: 1,
      },
    });
  });

  it('maps a JSON stderr failure onto the same shape, keeping bd’s code', async () => {
    impl = fail({ code: 2, stderr: '{"error":"no such issue: bd-99","code":"NOT_FOUND"}' });

    await expect(service().json(['show', 'bd-99'])).rejects.toMatchObject({
      rpcError: { kind: 'bd-error', message: 'no such issue: bd-99', code: 'NOT_FOUND' },
    });
  });

  it('classifies a missing database as no-workspace, not a generic failure', async () => {
    impl = fail({ code: 1, stderr: 'Error: no .beads directory found; run bd init' });

    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: { kind: 'no-workspace' },
    });
  });

  it('reports a missing executable as bd-not-found and names the setting', async () => {
    impl = fail({ code: 'ENOENT' });

    const error = await service()
      .json(['list'])
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(BdError);
    expect((error as InstanceType<typeof BdError>).rpcError.kind).toBe('bd-not-found');
    expect((error as InstanceType<typeof BdError>).rpcError.message).toContain('beadsDashboard.bdPath');
  });

  it('retries through the shell once, for the Windows .cmd shim', async () => {
    let attempt = 0;
    impl = async (_file, _args, options) => {
      attempt += 1;
      if (!options.shell) throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
      return { stdout: '[]', stderr: '' };
    };

    const bd = service();
    await bd.json(['list']);
    expect(attempt).toBe(2);

    // The shell answer is remembered, so the doomed attempt is not repeated.
    await bd.json(['list']);
    expect(attempt).toBe(3);
    expect(calls.at(-1)?.options.shell).toBe(true);
  });

  it('still reports bd-not-found when the shell retry says "not recognized"', async () => {
    // cmd.exe launches even for a missing command and exits 1, so the shell
    // fallback must not let a genuine ENOENT degrade into a generic bd-error.
    impl = async (_file, _args, options) => {
      if (!options.shell) throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
      throw Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: '',
        stderr: "'bd' is not recognized as an internal or external command,\r\n",
      });
    };

    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: { kind: 'bd-not-found' },
    });
  });

  it('surfaces a real bd failure from the shell retry unchanged', async () => {
    // The shim resolved; bd itself failed. That must stay a bd-error.
    impl = async (_file, _args, options) => {
      if (!options.shell) throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
      throw Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: '',
        stderr: 'Error: no such issue: bd-99',
      });
    };

    await expect(service().json(['show', 'bd-99'])).rejects.toMatchObject({
      rpcError: { kind: 'bd-error', message: 'no such issue: bd-99' },
    });
  });

  it('reports unparseable output as bad-output rather than crashing', async () => {
    impl = ok('not json at all');

    await expect(service().json(['list'])).rejects.toMatchObject({
      rpcError: { kind: 'bad-output' },
    });
  });

  it('treats empty stdout as null instead of throwing', async () => {
    impl = ok('   ');

    await expect(service().json(['list'])).resolves.toBeNull();
  });

  it('coalesces identical concurrent reads into one process', async () => {
    let spawned = 0;
    impl = async () => {
      spawned += 1;
      return { stdout: '[]', stderr: '' };
    };

    const bd = service();
    await Promise.all([bd.jsonShared(['ready']), bd.jsonShared(['ready']), bd.jsonShared(['ready'])]);

    expect(spawned).toBe(1);
  });

  it('does not append --json to a mutating command', async () => {
    impl = ok('updated bd-1');

    await service().exec(['update', 'bd-1', '--status', 'closed']);

    expect(calls[0].args).toEqual(['update', 'bd-1', '--status', 'closed']);
  });

  it('honours a custom bd path from settings', async () => {
    await new BdService({ cwd: '/repo', bdPath: 'C:\\tools\\bd.exe' }).json(['list']);

    expect(calls[0].file).toBe('C:\\tools\\bd.exe');
  });
});
