export const PAYPAL_CONCURRENCY_DIAGNOSTIC_PREFIX = 'PROOFPAY_CONCURRENCY_DIAGNOSTIC:';

const CATEGORIES = new Set([
  'assertion_failure',
  'completed',
  'environment_failure',
  'harness_failure',
  'postgres_error',
  'postgres_timeout',
]);
const PHASES = new Set([
  'complete',
  'database_setup',
  'environment',
  'final_integrity',
  'newer_session_start',
  'older_session_start',
  'state_order_assertions',
]);
const ASSERTION_IDS = new Set([
  'disposable_project_id_required',
  'existing_records_baseline_preserved',
  'github_actions_marker_required',
  'linux_runner_required',
  'newer_refund_applied',
  'newer_refunded_session_observed',
  'older_paid_rejected_as_stale',
  'older_paid_session_observed',
  'older_rpc_observed_refund',
  'race_fixture_created',
  'race_invoice_and_events_final_state',
]);
const PROCESS_SIGNALS = new Set(['SIGABRT', 'SIGINT', 'SIGKILL', 'SIGSEGV', 'SIGTERM']);
const SPAWN_ERROR_CODES = new Set(['EACCES', 'EINVAL', 'ENOENT', 'ENOTDIR', 'ETIMEDOUT']);
const PAYLOAD_KEYS = new Set([
  'version', 'result', 'category', 'phase', 'assertionId', 'sqlState',
  'databaseSetupStarted', 'sessionsStarted', 'finalIntegrityReached', 'databaseCommand',
]);
const SESSION_KEYS = new Set(['older', 'newer']);
const COMMAND_KEYS = new Set(['exitStatus', 'timedOut', 'signal', 'spawnErrorCode', 'outputTruncated']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSqlState(value) {
  return value === null || (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value));
}

function isOptionalBoolean(value) {
  return value === null || typeof value === 'boolean';
}

function validDatabaseCommand(value) {
  if (value === null) return true;
  return isRecord(value)
    && Object.keys(value).every((key) => COMMAND_KEYS.has(key))
    && Object.keys(value).length === COMMAND_KEYS.size
    && (value.exitStatus === null || (Number.isInteger(value.exitStatus) && value.exitStatus >= 0 && value.exitStatus <= 255))
    && typeof value.timedOut === 'boolean'
    && (value.signal === null || PROCESS_SIGNALS.has(value.signal))
    && (value.spawnErrorCode === null || SPAWN_ERROR_CODES.has(value.spawnErrorCode))
    && typeof value.outputTruncated === 'boolean';
}

function validPayload(value) {
  return isRecord(value)
    && Object.keys(value).every((key) => PAYLOAD_KEYS.has(key))
    && Object.keys(value).length === PAYLOAD_KEYS.size
    && value.version === 1
    && (value.result === 'passed' || value.result === 'failed')
    && CATEGORIES.has(value.category)
    && ((value.result === 'passed' && value.category === 'completed')
      || (value.result === 'failed' && value.category !== 'completed'))
    && PHASES.has(value.phase)
    && (value.assertionId === null || ASSERTION_IDS.has(value.assertionId))
    && isSqlState(value.sqlState)
    && typeof value.databaseSetupStarted === 'boolean'
    && isRecord(value.sessionsStarted)
    && Object.keys(value.sessionsStarted).every((key) => SESSION_KEYS.has(key))
    && Object.keys(value.sessionsStarted).length === SESSION_KEYS.size
    && isOptionalBoolean(value.sessionsStarted.older)
    && isOptionalBoolean(value.sessionsStarted.newer)
    && typeof value.finalIntegrityReached === 'boolean'
    && validDatabaseCommand(value.databaseCommand);
}

export function formatPaypalConcurrencyDiagnostic(payload) {
  if (!validPayload(payload)) throw new TypeError('Invalid concurrency diagnostic envelope');
  return PAYPAL_CONCURRENCY_DIAGNOSTIC_PREFIX + JSON.stringify(payload);
}

function processDetails(result) {
  return {
    exitStatus: Number.isInteger(result?.code) && result.code >= 0 && result.code <= 255 ? result.code : null,
    timedOut: Boolean(result?.timedOut),
    signal: PROCESS_SIGNALS.has(result?.signal) ? result.signal : null,
    outputTruncated: Boolean(result?.outputTruncated),
    spawnErrorCode: SPAWN_ERROR_CODES.has(result?.spawnErrorCode) ? result.spawnErrorCode : null,
  };
}

function unavailableDiagnostic(kind, process) {
  return {
    kind,
    failureCategory: kind,
    phase: null,
    failedAssertionId: null,
    sqlState: null,
    databaseSetupStarted: null,
    sessionsStarted: { older: null, newer: null },
    finalIntegrityReached: null,
    databaseCommand: null,
    process,
  };
}

export function parsePaypalConcurrencyDiagnostic(processResult = {}) {
  const process = processDetails(processResult);
  if (process.outputTruncated) return unavailableDiagnostic('child_diagnostic_truncated', process);

  const output = [processResult.stdout, processResult.stderr]
    .filter((value) => typeof value === 'string')
    .join('\n');
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith(PAYPAL_CONCURRENCY_DIAGNOSTIC_PREFIX));
  if (lines.length === 0) return unavailableDiagnostic('child_diagnostic_missing', process);
  if (lines.length !== 1) return unavailableDiagnostic('child_diagnostic_malformed', process);

  let payload;
  try {
    payload = JSON.parse(lines[0].slice(PAYPAL_CONCURRENCY_DIAGNOSTIC_PREFIX.length));
  } catch {
    return unavailableDiagnostic('child_diagnostic_malformed', process);
  }
  if (!validPayload(payload)) return unavailableDiagnostic('child_diagnostic_malformed', process);

  return {
    kind: payload.result === 'passed' ? 'passed' : payload.category,
    failureCategory: payload.result === 'failed' ? payload.category : null,
    phase: payload.phase,
    failedAssertionId: payload.assertionId,
    sqlState: payload.sqlState,
    databaseSetupStarted: payload.databaseSetupStarted,
    sessionsStarted: { older: payload.sessionsStarted.older, newer: payload.sessionsStarted.newer },
    finalIntegrityReached: payload.finalIntegrityReached,
    databaseCommand: payload.databaseCommand
      ? {
        exitStatus: payload.databaseCommand.exitStatus,
        timedOut: payload.databaseCommand.timedOut,
        signal: payload.databaseCommand.signal,
        spawnErrorCode: payload.databaseCommand.spawnErrorCode,
        outputTruncated: payload.databaseCommand.outputTruncated,
      }
      : null,
    process,
  };
}

export function extractPostgresSqlState(stderr) {
  if (typeof stderr !== 'string') return null;
  const match = stderr.match(/(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5}):/);
  return match?.[1] ?? null;
}
