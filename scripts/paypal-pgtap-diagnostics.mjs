const ALLOWED_TEST_FILES = Object.freeze([
  'project_completion_workflow.test.sql',
  'paypal_provider_snapshot_ordering.test.sql',
]);
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

function canonicalTestFile(line) {
  const match = line.match(/(?:^|[^A-Za-z0-9_.-])(project_completion_workflow\.test\.sql|paypal_provider_snapshot_ordering\.test\.sql)(?=$|[^A-Za-z0-9_.-])/i);
  if (!match) return null;
  return ALLOWED_TEST_FILES.find((name) => name.toLowerCase() === match[1].toLowerCase()) ?? null;
}

function safeAssertionDescription(value) {
  let description = String(value ?? '')
    .replace(ANSI_ESCAPE, '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted connection]')
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/\b(?:password|secret|token|api[_-]?key|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, '[redacted credential]')
    .replace(/\beyJ[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]+){1,2}\b/g, '[redacted token]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted id]')
    .replace(/\b(?:select|insert|update|delete|alter|drop|create|grant|revoke)\b/i, '[details withheld]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  description = description.replace(/[^A-Za-z0-9 _.,:;()/#-]/g, '').slice(0, 160).trim();
  return description || 'Assertion failed; description unavailable';
}

function extractSqlStateCodes(text) {
  const codes = new Set();
  const patterns = [
    /\b(?:ERROR|FATAL|PANIC)\s*:\s*(?:\[([0-9A-Z]{5})\]|([0-9A-Z]{5})\s*:)/gi,
    /\bSQLSTATE\s*[=:]\s*([0-9A-Z]{5})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const code = match[1] ?? match[2] ?? match[3];
      if (code && /^[0-9A-Z]{5}$/.test(code)) codes.add(code);
    }
  }
  return [...codes].sort();
}

export function parsePgTapDiagnostics({
  exitStatus = null,
  stdout = '',
  stderr = '',
  timedOut = false,
  outputTruncated = false,
  expectedTestFiles = [],
  spawnErrorCode = null,
} = {}) {
  const text = String(stdout) + '\n' + String(stderr);
  let activeFile = null;
  let passingAssertions = 0;
  const failedAssertions = [];
  const reportedTestFiles = new Set();

  for (const line of text.replace(ANSI_ESCAPE, '').split(/\r?\n/)) {
    const file = canonicalTestFile(line);
    if (file) {
      activeFile = file;
      reportedTestFiles.add(file);
    }
    if (/^\s*ok\s+\d+(?:\s|$)/i.test(line)) passingAssertions += 1;
    const failure = line.match(/^\s*not ok\s+(\d+)(?:\s+-\s*(.*))?$/i)
      ?? line.match(/^\s*#\s*Failed test\s+(\d+)(?::\s*["']?(.*?)["']?)?\s*$/i);
    if (failure) {
      failedAssertions.push({
        number: Number(failure[1]),
        file: activeFile,
        description: safeAssertionDescription(failure[2]),
      });
    }
  }

  const sqlStateCodes = extractSqlStateCodes(text);
  const missingFixture = /\b(?:no tests? files? found|missing fixture|fixture[^.\n]{0,80}\bmissing|cannot find[^.\n]{0,100}\.test\.sql|could not find[^.\n]{0,100}\.test\.sql|does not exist[^.\n]{0,100}\.test\.sql)\b|(?:ENOENT|no such file or directory)[^\n]{0,160}\.test\.sql|\.test\.sql[^\n]{0,120}(?:ENOENT|not found|no such file)/i.test(text);
  const sqlExecutionError = /\b(?:ERROR|FATAL|PANIC)\s*:/i.test(text);
  const cliError = spawnErrorCode === 'ENOENT' || /\b(?:unknown|invalid|unrecognized)\s+(?:sub)?command\b|\b(?:unknown|invalid|unrecognized)\s+(?:flag|option|argument)\b|\bfailed to start\b|\bcannot start\b|\bunable to connect to docker\b|\bdocker[^.\n]{0,80}\bnot running\b|\bcould not connect to server\b/i.test(text);

  let kind = 'harness_error';
  if (failedAssertions.length > 0) kind = 'pgtap_assertion_failure';
  else if (sqlStateCodes.length > 0 || sqlExecutionError) kind = 'sql_execution_error';
  else if (missingFixture) kind = 'missing_fixture';
  else if (cliError) kind = 'cli_error';
  else if (timedOut) kind = 'command_timeout';
  else if (exitStatus === 0 && passingAssertions > 0) kind = 'passed';

  const expected = [...new Set(expectedTestFiles)]
    .filter((name) => ALLOWED_TEST_FILES.includes(name));

  return {
    kind,
    exitStatus: Number.isInteger(exitStatus) ? exitStatus : null,
    timedOut: Boolean(timedOut),
    outputTruncated: Boolean(outputTruncated),
    expectedTestFiles: expected,
    reportedTestFiles: [...reportedTestFiles],
    passingAssertions,
    assertionCount: passingAssertions + failedAssertions.length,
    failedAssertions: failedAssertions.length,
    failures: failedAssertions,
    sqlStateCodes,
  };
}
