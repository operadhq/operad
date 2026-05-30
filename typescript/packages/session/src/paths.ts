/**
 * paths.ts — Single source of truth for ~/.operad/ directory and file paths.
 *
 * Convention-based: no config file, no init command. The directory and its
 * contents are created lazily on first access. Override with env vars.
 */
import { resolve, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'

/** Root directory: ~/.operad (or OPERAD_HOME override) */
export const OPERAD_HOME = resolve(
  process.env['OPERAD_HOME'] ?? join(homedir(), '.operad')
)

/** SQLite database path (or OPERAD_DB_PATH override) */
export const DB_PATH = resolve(
  process.env['OPERAD_DB_PATH'] ?? join(OPERAD_HOME, 'session.db')
)

/** Logs directory for watch command output */
export const LOGS_DIR = join(OPERAD_HOME, 'logs')

/**
 * Ensure ~/.operad/ exists. Idempotent — safe to call on every entry point.
 * Returns the home path for chaining.
 */
export function ensureHome(): string {
  mkdirSync(OPERAD_HOME, { recursive: true })
  return OPERAD_HOME
}
