// One screenshot run at a time on this machine. Each run is a Node process
// plus a headless Chrome, a gigabyte or two together; several at once (from
// several tabs or worktrees) have run the machine out of memory. A run takes
// the turn by creating a file only one process can create; the others wait
// for it, saying so, and go when it's free. A run that was killed outright
// leaves its file behind: the next one sees its process is gone and takes over.

import { openSync, readFileSync, unlinkSync, writeSync, closeSync } from 'node:fs';

export interface Holder { pid: number; started: string | null; cwd: string; args: string; since: number }

// When the process started, from the kernel (Linux): a pid can be reused by a
// new process after the old one is gone, but not with the same start time.
function startTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}

function running(h: Holder): boolean {
  try {
    process.kill(h.pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  return h.started === null || startTime(h.pid) === null || startTime(h.pid) === h.started;
}

function read(file: string): Holder | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // gone, or being written this moment
  }
}

// Waits for the turn, then holds it until release() or this process ends.
export async function takeTurn(file: string, onWait: (h: Holder) => void, pollMs = 1000): Promise<() => void> {
  const me: Holder = { pid: process.pid, started: startTime(process.pid), cwd: process.cwd(), args: process.argv.slice(2).join(' '), since: Date.now() };
  let told = false;
  let unreadable = 0;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify(me));
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const h = read(file);
    // A file nobody can read for a few seconds was left half-written by a run killed as it took the turn.
    if (h ? !running(h) : ++unreadable > 5) {
      // Only the file just judged: another waiter may have cleared it and taken the turn since.
      const again = read(file);
      if (again?.pid === h?.pid && again?.since === h?.since) {
        try {
          unlinkSync(file);
        } catch {}
      }
      unreadable = 0;
      continue;
    }
    if (h && !told) {
      onWait(h);
      told = true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const release = () => {
    if (read(file)?.pid === me.pid) {
      try {
        unlinkSync(file);
      } catch {}
    }
    process.off('exit', release);
  };
  process.on('exit', release);
  return release;
}
