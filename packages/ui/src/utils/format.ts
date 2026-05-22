/**
 * Format bytes to human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format timestamp to readable date string
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Get display name from file path
 */
export function getDisplayName(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Get file icon component name based on file extension
 */
export function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext)) {
    return "FileImage";
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return "FileArchive";
  }
  if (
    ["ts", "js", "py", "rs", "go", "html", "css", "vue", "tsx", "jsx"].includes(
      ext,
    )
  ) {
    return "FileCode";
  }
  return "FileText";
}

/**
 * Get transfer status info (label, color, icon, pulse)
 */
export function getTransferStatus(status: string): {
  label: string;
  color: string;
  icon: string;
  pulse: boolean;
} {
  const s = status.toLowerCase();
  if (s.includes("error"))
    return { label: "Error", color: "text-red-500", icon: "X", pulse: false };
  if (s.includes("cancel"))
    return {
      label: "Cancelled",
      color: "text-yellow-500",
      icon: "X",
      pulse: false,
    };
  if (s.includes("complete"))
    return {
      label: "Completed",
      color: "text-green-500",
      icon: "Check",
      pulse: false,
    };
  if (s.includes("serving"))
    return {
      label: "Serving",
      color: "text-blue-500",
      icon: "Share2",
      pulse: true,
    };
  if (s.includes("downloading"))
    return {
      label: "Downloading",
      color: "text-blue-500",
      icon: "Download",
      pulse: true,
    };
  return {
    label: status,
    color: "text-gray-500",
    icon: "RefreshCw",
    pulse: true,
  };
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * e.g. 1500 → "1.5s", 65000 → "1m 5s", 3700000 → "1h 1m"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function getProgressValue(data: any): number {
  if (data?.progress?.type === "downloading") {
    return (data.progress.offset / data.progress.total) * 100;
  }
  return 0;
}
