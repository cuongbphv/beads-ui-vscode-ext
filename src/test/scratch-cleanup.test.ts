/**
 * Focused unit test for `removeScratchDirBestEffort` (see
 * `src/test/support/scratch-cleanup.ts`) — the retry-then-swallow cleanup
 * helper `bd-live.test.ts`'s "dependency edges" `afterAll` hook delegates
 * to. Written for beads-ui-vscode-ext-iy3: this suite does not spawn a real
 * `bd`, so it can inject a `rm` that fails on every single call to prove
 * the "genuinely unrecoverable" path is caught and warned about rather
 * than propagated, without needing a real (and hard to force on demand)
 * Windows file lock.
 */
import { describe, expect, it, vi } from 'vitest';

import { removeScratchDirBestEffort } from './support/scratch-cleanup';

describe('removeScratchDirBestEffort', () => {
  it('resolves normally when the underlying rm succeeds', async () => {
    const rmFn = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();

    await expect(
      removeScratchDirBestEffort('/some/scratch/dir', { rmFn, warn }),
    ).resolves.toBeUndefined();

    expect(rmFn).toHaveBeenCalledTimes(1);
    expect(rmFn).toHaveBeenCalledWith(
      '/some/scratch/dir',
      expect.objectContaining({ recursive: true, force: true }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('passes maxRetries/retryDelay straight through to rm', async () => {
    const rmFn = vi.fn().mockResolvedValue(undefined);

    await removeScratchDirBestEffort('/some/scratch/dir', {
      rmFn,
      maxRetries: 15,
      retryDelay: 400,
    });

    expect(rmFn).toHaveBeenCalledWith(
      '/some/scratch/dir',
      expect.objectContaining({ maxRetries: 15, retryDelay: 400 }),
    );
  });

  it('never throws when rm still fails after exhausting every retry — warns instead', async () => {
    // Simulates the "genuinely unrecoverable" case this bead exists to fix:
    // a lock that never clears, so the underlying `rm` rejects on the one
    // call this helper makes to it (fs.rm's own retries are internal to
    // that single call/rejection, not separate calls this wrapper repeats).
    const stubborn = Object.assign(new Error('EBUSY: resource busy or locked, rmdir'), {
      code: 'EBUSY',
    });
    const rmFn = vi.fn().mockRejectedValue(stubborn);
    const warn = vi.fn();

    await expect(
      removeScratchDirBestEffort('/some/scratch/dir', { rmFn, warn }),
    ).resolves.toBeUndefined();

    expect(rmFn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, loggedError] = warn.mock.calls[0];
    expect(message).toContain('/some/scratch/dir');
    expect(message).toContain('scratch-cleanup');
    expect(loggedError).toBe(stubborn);
  });

  it('defaults to console.warn when no warn override is given', async () => {
    const stubborn = Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    const rmFn = vi.fn().mockRejectedValue(stubborn);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(removeScratchDirBestEffort('/some/scratch/dir', { rmFn })).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
