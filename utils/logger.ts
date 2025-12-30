import fs from "fs";
import path from "path";

type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: 99,
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

function normalizeLevel(v: unknown, fallback: LogLevel): LogLevel {
  const raw = String(v || "").toLowerCase().trim();
  if (raw === "silent" || raw === "error" || raw === "warn" || raw === "info" || raw === "debug") return raw;
  return fallback;
}

function ensureLogStream(filePath: string): fs.WriteStream | null {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    return fs.createWriteStream(filePath, { flags: "a" });
  } catch {
    return null;
  }
}

const CONSOLE_LEVEL: LogLevel = normalizeLevel(process.env.LOG_LEVEL, "info");
const LOG_TO_FILE = String(process.env.LOG_TO_FILE || "").toLowerCase() === "true";
const LOG_FILE_PATH = process.env.LOG_FILE || path.join(process.cwd(), "logs", "server.log");
const FILE_LEVEL: LogLevel = normalizeLevel(process.env.LOG_FILE_LEVEL, CONSOLE_LEVEL);

const fileStream = LOG_TO_FILE ? ensureLogStream(LOG_FILE_PATH) : null;

function shouldLog(level: LogLevel, minLevel: LogLevel) {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel];
}

function formatLine(level: LogLevel, message: string, meta?: unknown) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (meta === undefined) return base;
  try {
    return `${base} ${JSON.stringify(meta)}`;
  } catch {
    return `${base} [meta_unserializable]`;
  }
}

function write(level: LogLevel, message: string, meta?: unknown) {
  const line = formatLine(level, message, meta);

  // Consola (filtrada por LOG_LEVEL)
  if (CONSOLE_LEVEL !== "silent" && shouldLog(level, CONSOLE_LEVEL)) {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  // Archivo (filtrado por LOG_FILE_LEVEL)
  if (fileStream && shouldLog(level, FILE_LEVEL)) {
    fileStream.write(line + "\n");
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => write("debug", message, meta),
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta),
};


