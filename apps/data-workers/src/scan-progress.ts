/** Live counts for one RunPod event scan. */
export interface ScanProgress {
  /** Events whose model call has started and not finished. */
  scanning: number;
  /** Model calls that returned a result and were saved. A save failure moves the event to failed. */
  done: number;
  /** Events the model or the save step could not finish. */
  failed: number;
}

export function createScanProgress(): ScanProgress {
  return { scanning: 0, done: 0, failed: 0 };
}

export function beginScanProgress(progress: ScanProgress): void {
  progress.scanning += 1;
}

/** Moves one in-flight event to done or failed. */
export function finishScanProgress(progress: ScanProgress, ok: boolean): void {
  progress.scanning -= 1;
  if (ok) progress.done += 1;
  else progress.failed += 1;
}

/**
 * The model call was counted as done, then saving the row failed.
 * The event moves from done to failed.
 */
export function failFinishedScan(progress: ScanProgress): void {
  if (progress.done > 0) progress.done -= 1;
  progress.failed += 1;
}

export const SCAN_PROGRESS_INTERVAL_MS = 1000;

export function formatScanProgress(progress: ScanProgress): string {
  return `scanning ${progress.scanning}, done ${progress.done}, failed ${progress.failed}`;
}

/** Prints the counts on a timer, then once more when the caller stops it. */
export function startScanProgressLog(
  progress: ScanProgress,
  log: (line: string) => void = console.log,
  intervalMs = SCAN_PROGRESS_INTERVAL_MS,
): () => void {
  const write = () => log(formatScanProgress(progress));
  const timer = setInterval(write, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    clearInterval(timer);
    write();
  };
}
