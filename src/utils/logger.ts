type Level = "info" | "warn" | "error" | "debug";

function fmt(level: Level, msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const tag = `[${ts}] [${level.toUpperCase()}]`;
  if (meta && Object.keys(meta).length) {
    return `${tag} ${msg} ${JSON.stringify(meta)}`;
  }
  return `${tag} ${msg}`;
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(fmt("info", msg, meta)),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(fmt("warn", msg, meta)),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(fmt("error", msg, meta)),
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") console.log(fmt("debug", msg, meta));
  },
};
