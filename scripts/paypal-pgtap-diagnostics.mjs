const ALLOWED_TEST_FILES = Object.freeze(['project_completion_workflow.test.sql', 'paypal_provider_snapshot_ordering.test.sql']);
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

function canonicalTestFile(line) {
  const match = String(line).match(/(?:^|[^A-Za-z0-9_.-])(project_completion_workflow\.test\.sql|paypal_provider_snapshot_ordering\.test\.sql)(?=$|[^A-Za-z0-9_.-])/i);
  return match ? ALLOWED_TEST_FILES.find((name) => name.toLowerCase() === match[1].toLowerCase()) ?? null : null;
}

function normalizeLogLine(line) {
  return String(line).replace(ANSI_ESCAPE, '')
    .replace(/^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*/, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
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
    .replace(/\b(?:select|insert\s+into|update\s+[A-Za-z_][A-Za-z0-9_.]*\s+set|delete\s+from|alter\s+table|drop\s+table|create\s+table|grant|revoke)\b[\s\S]*$/i, '[SQL details withheld]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return description.replace(/[^A-Za-z0-9 _.,:;()/#-]/g, '').slice(0, 160).trim() || 'Assertion failed; description unavailable';
}

function extractSqlStateCodes(text) {
  const codes = new Set();
  const patterns = [
    /\b(?:ERROR|FATAL|PANIC)\s*:\s*(?:\[([0-9A-Z]{5})\]|([0-9A-Z]{5})\s*:)/gi,
    /\bSQLSTATE(?:\s*[:=]\s*|\s+)([0-9A-Z]{5})\b/gi,
  ];
  for (const pattern of patterns) for (const match of String(text).matchAll(pattern)) {
    const code = match[1] ?? match[2] ?? match[3];
    if (code && /^[0-9A-Z]{5}$/.test(code)) codes.add(code);
  }
  return [...codes].sort();
}

function extractStatementLocations(lines) {
  const locations = new Map();
  for (const line of lines) {
    const match = line.match(/(project_completion_workflow\.test\.sql|paypal_provider_snapshot_ordering\.test\.sql):(\d+):\s*(?:ERROR|FATAL|PANIC)\s*:/i);
    if (match) {
      const file = canonicalTestFile(match[1]);
      if (file) locations.set(file + ':' + Number(match[2]), { file, line: Number(match[2]) });
    }
  }
  return [...locations.values()];
}

export function parsePgTapDiagnostics({
  exitStatus = null, stdout = '', stderr = '', timedOut = false, outputTruncated = false,
  expectedTestFiles = [], testFile = null, tool = 'supabase', spawnErrorCode = null,
} = {}) {
  const text = String(stdout) + '\n' + String(stderr);
  const lines = text.split(/\r?\n/).map(normalizeLogLine);
  const expected = [...new Set(expectedTestFiles)].filter((name) => ALLOWED_TEST_FILES.includes(name));
  const isolatedTestFile = ALLOWED_TEST_FILES.includes(testFile) ? testFile : expected.length === 1 ? expected[0] : null;
  let activeFile = isolatedTestFile;
  let passingAssertions = 0;
  let reportedAssertionTotal = null;
  let pgProveFailedSubtests = null;
  let pgProveResult = null;
  const failedAssertions = [];
  const reportedTestFiles = new Set();
  const successfulTestFiles = new Set();

  for (const line of lines) {
    const file = canonicalTestFile(line);
    if (file) { activeFile = file; reportedTestFiles.add(file); }

    const failureAt = line.search(/\bnot\s+ok\s+\d+/i);
    if (failureAt >= 0) {
      const failure = line.slice(failureAt).match(/^not\s+ok\s+(\d+)(?:\s+-\s*(.*))?$/i);
      if (failure) {
        failedAssertions.push({ number: Number(failure[1]), file: activeFile, description: safeAssertionDescription(failure[2]) });
        continue;
      }
    }

    const proveFailure = line.match(/\bFailed\s+(\d+)\s*\/\s*(\d+)\s+subtests?\b/i);
    if (proveFailure) {
      pgProveFailedSubtests = Math.max(pgProveFailedSubtests ?? 0, Number(proveFailure[1]));
      reportedAssertionTotal = Math.max(reportedAssertionTotal ?? 0, Number(proveFailure[2]));
    }

    const failedTest = line.match(/(?:^|\s)#?\s*Failed test\s+(\d+)(?::\s*["']?(.*?)["']?)?\s*$/i);
    if (failedTest) {
      failedAssertions.push({ number: Number(failedTest[1]), file: activeFile, description: safeAssertionDescription(failedTest[2]) });
      continue;
    }

    const passingAt = line.search(/(?:^|\s)ok\s+\d+/i);
    if (passingAt >= 0 && !/\bnot\s+ok\s+\d+/i.test(line)) {
      const passing = line.slice(passingAt).match(/^ok\s+(\d+)(?:\s+-\s*(.*))?$/i);
      if (passing) passingAssertions += 1;
    }
    const plan = line.match(/^\s*1\.\.(\d+)\s*$/);
    if (plan) reportedAssertionTotal = Math.max(reportedAssertionTotal ?? 0, Number(plan[1]));
    const testSummary = line.match(/\bTests\s*=\s*(\d+)\b/i) ?? line.match(/^\s*#?\s*tests\s+(\d+)\s*$/i);
    if (testSummary) reportedAssertionTotal = Math.max(reportedAssertionTotal ?? 0, Number(testSummary[1]));
    const filePass = line.match(/(project_completion_workflow\.test\.sql|paypal_provider_snapshot_ordering\.test\.sql)\s+\.\.\s+ok\b/i);
    if (filePass) {
      const passedFile = canonicalTestFile(filePass[1]);
      if (passedFile) successfulTestFiles.add(passedFile);
    }
    const result = line.match(/\bResult\s*:\s*(PASS|FAIL)\b/i);
    if (result) pgProveResult = result[1].toUpperCase();
    if (/^\s*All tests successful\.?\s*$/i.test(line)) pgProveResult = 'PASS';
  }

  const sqlStateCodes = extractSqlStateCodes(text);
  const statementLocations = extractStatementLocations(lines);
  const missingFixture = /\b(?:no tests? files? found|missing fixture|fixture[^.\n]{0,80}\bmissing|cannot find[^.\n]{0,100}\.test\.sql|could not find[^.\n]{0,100}\.test\.sql)\b|(?:ENOENT|no such file or directory)[^\n]{0,160}\.test\.sql|\.test\.sql[^\n]{0,120}(?:ENOENT|not found|no such file)/i.test(text);
  const connectionError = /\b(?:connection refused|could not connect to server|no route to host|server closed the connection unexpectedly|connection to server at)\b/i.test(text);
  const postgresErrorLine = lines.some((line) => /(?:^|\s)(?:ERROR|FATAL|PANIC)\s*:/i.test(line));
  const cliError = Boolean(spawnErrorCode) || /\b(?:unknown|invalid|unrecognized)\s+(?:sub)?command\b|\b(?:unknown|invalid|unrecognized)\s+(?:flag|option|argument)\b|\bfailed to start\b|\bcannot start\b|\bunable to connect to docker\b|\bdocker[^.\n]{0,80}\bnot running\b|\bcould not find (?:a )?supabase project\b/i.test(text)
    || (["supabase", "pg_prove", "docker"].includes(tool) && postgresErrorLine && sqlStateCodes.length === 0 && statementLocations.length === 0);
  const hasSqlError = sqlStateCodes.length > 0 || statementLocations.length > 0 || (tool === 'psql' && postgresErrorLine && !connectionError);
  const hasAssertionFailure = failedAssertions.length > 0;
  const hasPgProveFailure = (pgProveFailedSubtests ?? 0) > 0 || pgProveResult === 'FAIL';
  const hasPassEvidence = passingAssertions > 0
    || (isolatedTestFile !== null && successfulTestFiles.has(isolatedTestFile))
    || pgProveResult === 'PASS';

  let kind = 'harness_error';
  if (connectionError) kind = 'database_connection_error';
  else if (hasSqlError && hasAssertionFailure) kind = 'mixed_sql_and_assertion_failure';
  else if (hasSqlError) kind = 'sql_execution_error';
  else if (hasAssertionFailure) kind = 'pgtap_assertion_failure';
  else if (missingFixture) kind = 'missing_fixture';
  else if (hasPgProveFailure) kind = 'pgprove_failure_summary';
  else if (cliError) kind = 'cli_error';
  else if (timedOut) kind = 'command_timeout';
  else if (exitStatus === 0 && !outputTruncated && hasPassEvidence) kind = 'passed';

  return {
    kind, tool: ['supabase', 'pg_prove', 'psql', 'docker'].includes(tool) ? tool : 'harness',
    testFile: isolatedTestFile, exitStatus: Number.isInteger(exitStatus) ? exitStatus : null,
    timedOut: Boolean(timedOut), outputTruncated: Boolean(outputTruncated), expectedTestFiles: expected,
    reportedTestFiles: [...reportedTestFiles], passingAssertions: kind === 'passed' && passingAssertions === 0 ? reportedAssertionTotal ?? 0 : passingAssertions,
    assertionCount: reportedAssertionTotal ?? passingAssertions + failedAssertions.length,
    failedAssertions: failedAssertions.length, pgProveFailedSubtests, failures: failedAssertions,
    statementLocations, sqlStateCodes,
  };
}
