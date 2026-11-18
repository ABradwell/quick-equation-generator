import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** True if `cmd` can be executed (e.g. toolAvailable('go', ['version'])). */
export function toolAvailable(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0;
}

/** Run a command, throwing with stderr on failure. Returns stdout. */
export function run(cmd, args, { cwd, timeout = 120_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 1 << 24 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${r.stderr}\n${r.stdout}`);
  }
  return r.stdout;
}

/** A fresh scratch directory under test/.tmp/<name>. */
export function scratchDir(name) {
  const dir = join(ROOT, 'test', '.tmp', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
