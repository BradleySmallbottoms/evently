import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createScanProgress,
  startScanProgressLog,
} from '../../../apps/data-workers/src/scan-progress';

afterEach(() => {
  vi.useRealTimers();
});

describe('startScanProgressLog', () => {
  it('prints the counts every second and once when the scan stops', () => {
    vi.useFakeTimers();
    const progress = createScanProgress();
    const lines: string[] = [];
    const stop = startScanProgressLog(progress, (line) => lines.push(line));
    progress.scanning = 2;
    vi.advanceTimersByTime(1000);
    progress.scanning = 1;
    progress.done = 1;
    vi.advanceTimersByTime(1000);
    progress.scanning = 0;
    progress.failed = 1;
    stop();
    expect(lines).toEqual([
      'scanning 2, done 0, failed 0',
      'scanning 1, done 1, failed 0',
      'scanning 0, done 1, failed 1',
    ]);
  });
});
