export interface RawUpdateProgress {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

export interface NormalizedUpdateProgress {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
  etaSeconds?: number;
}

function finitePositive(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function normalizeUpdateProgress(progress: RawUpdateProgress): NormalizedUpdateProgress {
  const bytesPerSecond = finitePositive(progress.bytesPerSecond);
  const transferred = finitePositive(progress.transferred);
  const total = finitePositive(progress.total);
  const reportedPercent = finitePositive(progress.percent);
  const calculatedPercent = total > 0 ? transferred / total * 100 : 0;
  const percent = Math.max(0, Math.min(100, reportedPercent || calculatedPercent));
  const etaSeconds = bytesPerSecond > 0 && total > transferred
    ? Math.ceil((total - transferred) / bytesPerSecond)
    : undefined;
  return { bytesPerSecond, percent, total, transferred, etaSeconds };
}

export function retryShouldDownload(lastAction: "check" | "download" | undefined, availableVersion?: string) {
  return lastAction === "download" && Boolean(availableVersion);
}
