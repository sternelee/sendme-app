const LOG_STORAGE_KEY = "sendme_debug_log";
const MAX_LINES = 800;

function getLines(): string[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function appendLine(line: string) {
  try {
    const lines = getLines();
    lines.push(line);
    if (lines.length > MAX_LINES) {
      lines.splice(0, lines.length - MAX_LINES);
    }
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // ignore storage failures
  }
}

function formatMeta(meta: unknown): string {
  if (meta === undefined) return "";
  if (meta instanceof Error) {
    return `${meta.name}: ${meta.message}${meta.stack ? "\n" + meta.stack : ""}`.trim();
  }
  if (typeof meta === "string") return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

function logLine(
  level: "INFO" | "WARN" | "ERROR",
  scope: string,
  message: string,
  meta?: unknown,
) {
  const timestamp = new Date().toISOString();
  const metaText = meta !== undefined ? ` | ${formatMeta(meta)}` : "";
  const line = `${timestamp} ${level} [${scope}] ${message}${metaText}`;
  appendLine(line);
}

function logToConsole(
  level: "log" | "warn" | "error",
  scope: string,
  message: string,
  meta?: unknown,
) {
  const prefix = `[${scope}] ${message}`;
  if (meta !== undefined) {
    console[level](prefix, meta);
  } else {
    console[level](prefix);
  }
  logLine(
    level === "log" ? "INFO" : level === "warn" ? "WARN" : "ERROR",
    scope,
    message,
    meta,
  );
}

export function debugInfo(scope: string, message: string, meta?: unknown) {
  logToConsole("log", scope, message, meta);
}

export function debugWarn(scope: string, message: string, meta?: unknown) {
  logToConsole("warn", scope, message, meta);
}

export function debugError(scope: string, message: string, meta?: unknown) {
  logToConsole("error", scope, message, meta);
}

/** 返回日志全文字符串，可贴给开发者 */
export function exportDebugLog(): string {
  return getLines().join("\n");
}

/** 清空日志缓冲 */
export function clearDebugLog() {
  try {
    localStorage.removeItem(LOG_STORAGE_KEY);
  } catch {
    // ignore
  }
}
