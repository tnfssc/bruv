import type { DownloadProgress } from "./update";

function bytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit ? value.toFixed(1) : Math.floor(value).toString()} ${units[unit]}`;
}
function duration(seconds: number): string {
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  if (rounded < 3600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
  return `${Math.floor(rounded / 3600)}h ${Math.floor((rounded % 3600) / 60)}m`;
}

export function formatDownloadProgress(progress: DownloadProgress, columns?: number): string {
  const { downloadedBytes, totalBytes, elapsedMs, status } = progress;
  const prefix = status === "complete" ? "Downloaded " : status === "failed" ? "Download failed: " : "Downloading ";
  let details = ` ${bytes(downloadedBytes)}`;
  if (totalBytes !== undefined && totalBytes > 0)
    details += ` / ${bytes(totalBytes)} (${Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))}%)`;
  const speed = elapsedMs > 0 ? downloadedBytes / (elapsedMs / 1000) : 0;
  if (speed > 0 && Number.isFinite(speed)) {
    details += ` · ${bytes(speed)}/s`;
    if (status === "downloading" && totalBytes !== undefined && totalBytes > downloadedBytes)
      details += ` · ETA ${duration((totalBytes - downloadedBytes) / speed)}`;
  }
  // Keep terminal updates on one physical line; shorten the asset before losing metrics.
  let asset = progress.asset;
  if (columns) {
    const available = Math.max(1, columns - 1 - prefix.length - details.length);
    if (asset.length > available) asset = `${asset.slice(0, available - 1)}…`;
  }
  const line = prefix + asset + details;
  return columns ? line.slice(0, Math.max(1, columns - 1)) : line;
}

type ProgressOutput = { isTTY?: boolean; columns?: number; write: (text: string) => unknown };

/** No timer: only received bytes advance the display. Plain logs get at most one line per 10s, plus boundaries. */
export function createDownloadProgressDisplay(output: ProgressOutput = process.stdout) {
  let asset: string | undefined;
  let lastElapsed = -Infinity;
  let lineOpen = false;
  const finish = () => {
    if (lineOpen) output.write("\n");
    lineOpen = false;
  };
  return {
    onProgress(progress: DownloadProgress) {
      const starting = asset !== progress.asset;
      if (starting) {
        finish();
        asset = progress.asset;
        lastElapsed = -Infinity;
      }
      const ending = progress.status !== "downloading";
      if (!starting && !ending && progress.elapsedMs - lastElapsed < (output.isTTY ? 100 : 10_000)) return;
      lastElapsed = progress.elapsedMs;
      const line = formatDownloadProgress(progress, output.isTTY ? output.columns : undefined);
      if (output.isTTY) {
        output.write(`\r\x1b[2K${line}`);
        lineOpen = true;
        if (ending) finish();
      } else output.write(`${line}\n`);
    },
    finish,
  };
}
