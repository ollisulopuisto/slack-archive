/**
 * Where the time went.
 *
 * A nightly render takes about twenty minutes on the NAS and nothing says
 * which part of it does - so any argument about making it faster is an
 * argument about a guess. This prints the split at the end of every run, which
 * also means a run that suddenly takes twice as long says where.
 */
const phases: Array<{ name: string; ms: number }> = [];

export async function timed<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now();

  try {
    return await work();
  } finally {
    phases.push({ name, ms: Date.now() - started });
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);

  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`
    : `${seconds}s`;
}

export function reportTimings(label: string): string {
  const total = phases.reduce((sum, phase) => sum + phase.ms, 0);
  const parts = phases
    .filter((phase) => phase.ms >= 500)
    .map((phase) => `${phase.name} ${formatDuration(phase.ms)}`);

  return `${label} in ${formatDuration(total)}: ${parts.join(", ")}`;
}

export function clearTimings() {
  phases.length = 0;
}
