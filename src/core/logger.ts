/**
 * Minimal diagnostics logger.
 *
 * Privacy contract (see AGENTS.md): log only invariant/diagnostic metadata.
 * Never pass conversation text, titles, URLs or IDs, tokens or cookies. To make that
 * hard to get wrong, metadata values are restricted to numbers, booleans and null by
 * type, and caught errors are reduced to their constructor name with `errorName`
 * (an Error message can embed request URLs or response bodies).
 *
 * Levels: `debug` is silent in production builds (and can be toggled with
 * `setDebugLogging`); `info`, `warn` and `error` always reach the console because
 * they describe failed invariants the user or a bug report may need.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogMeta = Record<string, number | boolean | null | undefined>

export interface Logger {
  debug(message: string, meta?: LogMeta): void
  info(message: string, meta?: LogMeta): void
  warn(message: string, meta?: LogMeta): void
  error(message: string, meta?: LogMeta): void
}

// Module-scoped declaration: src/ is compiled without Node typings, but bundlers inline NODE_ENV.
declare const process: { env: { NODE_ENV?: string } }

function isProductionBuild(): boolean {
  try {
    // Bundlers inline `process.env.NODE_ENV`; if `process` is absent, assume production.
    return process.env.NODE_ENV === 'production'
  } catch {
    return true
  }
}

let debugEnabled = !isProductionBuild()

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled
}

export function isDebugLogging(): boolean {
  return debugEnabled
}

/** Reduce an unknown thrown value to a non-sensitive label (its class name). */
export function errorName(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error'
  if (error === null) return 'null'
  return typeof error
}

function emit(level: LogLevel, scope: string, message: string, meta?: LogMeta): void {
  if (level === 'debug' && !debugEnabled) return
  const line = `[${scope}] ${message}`
  /* eslint-disable no-console -- the logger is the single sanctioned console sink in src/ */
  const sink =
    level === 'debug'
      ? console.debug
      : level === 'info'
        ? console.info
        : level === 'warn'
          ? console.warn
          : console.error
  /* eslint-enable no-console */
  if (meta && Object.keys(meta).length > 0) sink(line, meta)
  else sink(line)
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => emit('debug', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    error: (message, meta) => emit('error', scope, message, meta)
  }
}
