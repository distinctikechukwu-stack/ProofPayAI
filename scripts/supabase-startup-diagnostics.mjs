const KNOWN_SERVICES = new Set([
  'auth', 'db', 'edge-runtime', 'functions', 'imgproxy', 'inbucket', 'kong',
  'logflare', 'meta', 'pooler', 'realtime', 'rest', 'storage', 'studio', 'vector',
]);
const VALID_CONTAINER_STATES = new Set(['created', 'dead', 'exited', 'paused', 'restarting', 'removing', 'running']);
const VALID_HEALTH_STATES = new Set(['healthy', 'starting', 'unhealthy']);
const VALID_SIGNALS = new Set(['SIGABRT', 'SIGINT', 'SIGKILL', 'SIGSEGV', 'SIGTERM']);
const VALID_SPAWN_ERROR_CODES = new Set(['EACCES', 'EINVAL', 'ENOENT', 'ENOTDIR', 'ETIMEDOUT']);
const MAX_CONTAINERS = 40;
const RECOMMENDED_MINIMUM_DISK_KIB = 6 * 1024 * 1024;
const MAX_STARTUP_OUTPUT_BYTES = 2_000_000;

const STARTUP_STAGE_MARKERS = Object.freeze([
  { stage: 'configuration_load', pattern: /\b(?:reading|loading|validating)\b.{0,80}\b(?:config(?:uration)?|config\.toml)\b/i },
  { stage: 'registry_access', pattern: /\b(?:registry|manifest|oauth token)\b/i },
  { stage: 'image_pull', pattern: /\b(?:pulling|pulled|download(?:ing|ed)|error pulling)\b.{0,80}\b(?:image|layer|manifest)\b/i },
  { stage: 'container_creation', pattern: /\b(?:creating|created|failed to create)\b.{0,80}\b(?:container|endpoint|task)\b/i },
  { stage: 'container_start', pattern: /\b(?:starting|started|failed to start|error starting)\b.{0,80}\b(?:container|service|postgres|database)\b/i },
  { stage: 'database_initialization', pattern: /\b(?:initdb|database initialization|initializing database|database system is (?:starting up|ready))\b/i },
  { stage: 'health_check', pattern: /\bhealth.?check\b|\b(?:healthy|unhealthy)\b/i },
]);

const STARTUP_FAILURE_SIGNATURES = Object.freeze([
  { signal: 'registry_rate_limited', kind: 'image_registry_failure', phase: 'registry_access', pattern: /\b(?:toomanyrequests|too many requests|pull rate limit|rate limit exceeded)\b/i },
  { signal: 'image_registry_access_denied', kind: 'image_registry_failure', phase: 'registry_access', pattern: /\b(?:pull access denied|unauthorized(?:\s*:)?|authentication required|failed to authorize|failed to fetch oauth token)\b/i },
  { signal: 'registry_transport_failure', kind: 'image_registry_failure', phase: 'registry_access', pattern: /\b(?:failed to resolve reference|failed to do request:.*(?:dial tcp|lookup|timeout)|unexpected eof|tls handshake timeout)\b/i },
  { signal: 'image_manifest_unavailable', kind: 'image_pull_failure', phase: 'image_pull', pattern: /\b(?:manifest unknown|manifest (?:not found|does not exist)|repository does not exist)\b/i },
  { signal: 'image_layer_download_failure', kind: 'image_pull_failure', phase: 'image_pull', pattern: /\b(?:failed to pull (?:an? )?image|error pulling (?:an? )?image|error pulling fs layer|failed to copy:|failed to extract layer)\b/i },
  { signal: 'container_creation_failure', kind: 'container_creation_failure', phase: 'container_creation', pattern: /\b(?:failed to create (?:container|task|shim|endpoint)|error creating (?:container|task|endpoint)|port is already allocated|address already in use)\b/i },
  { signal: 'container_runtime_failure', kind: 'container_start_failure', phase: 'container_start', pattern: /\b(?:oci runtime create failed|failed to start (?:container|service)|error starting (?:container|service)|container process exited)\b/i },
  { signal: 'database_initialization_failure', kind: 'database_initialization_failure', phase: 'database_initialization', pattern: /\b(?:initdb:\s*(?:error|fatal)|database initialization failed|failed to initialize (?:the )?database|postgres(?:ql)?[^\r\n]{0,60}\b(?:panic|fatal)\b|fatal:.*database system)\b/i },
  { signal: 'docker_daemon_unavailable', kind: 'startup_network_failure', phase: 'docker_daemon', pattern: /\b(?:cannot connect to the docker daemon|error during connect|is the docker daemon running)\b/i },
]);

function exitStatus(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function asText(value) {
  return typeof value === 'string' ? value : '';
}

function boundedByteCount(value) {
  const count = Buffer.byteLength(asText(value), 'utf8');
  return Number.isSafeInteger(count) ? Math.min(count, MAX_STARTUP_OUTPUT_BYTES) : MAX_STARTUP_OUTPUT_BYTES;
}

function collectStartupOutputEvidence(stdout, stderr, processResult) {
  const safeStdout = asText(stdout);
  const safeStderr = asText(stderr);
  const combined = safeStdout + '\n' + safeStderr;
  const output = combined.slice(0, MAX_STARTUP_OUTPUT_BYTES);
  const failureSignals = STARTUP_FAILURE_SIGNATURES
    .filter(({ pattern }) => pattern.test(output))
    .map(({ signal }) => signal)
    .slice(0, 10);
  const observedStages = STARTUP_STAGE_MARKERS
    .filter(({ pattern }) => pattern.test(output))
    .map(({ stage }) => stage)
    .slice(0, 8);
  const truncated = Boolean(processResult?.outputTruncated)
    || Buffer.byteLength(combined, 'utf8') > MAX_STARTUP_OUTPUT_BYTES;
  const classificationBasis = truncated
    ? 'captured_output_truncated'
    : failureSignals.length > 0
      ? 'recognized_failure_signature'
      : output.trim().length > 0
        ? 'no_recognized_failure_signature'
        : 'no_cli_output';

  return {
    capturedBytes: {
      stdout: boundedByteCount(safeStdout),
      stderr: boundedByteCount(safeStderr),
      total: boundedByteCount(combined),
    },
    truncated,
    classificationBasis,
    observedStages,
    recognizedFailureSignals: failureSignals,
  };
}

export function buildSupabaseStartArgs(excludedServices, diagnosticsMode = 'standard') {
  if (typeof excludedServices !== 'string' || !/^[a-z][a-z0-9-]*(?:,[a-z][a-z0-9-]*)*$/i.test(excludedServices)) {
    throw new TypeError('Invalid Supabase service exclusion list');
  }
  if (diagnosticsMode !== 'standard' && diagnosticsMode !== 'debug') {
    throw new TypeError('Invalid Supabase startup diagnostics mode');
  }
  return [
    ...(diagnosticsMode === 'debug' ? ['--debug'] : []),
    'start', '--exclude', excludedServices,
  ];
}

function safeToolResult(result) {
  return {
    exitStatus: exitStatus(result?.code),
    spawnErrorCode: VALID_SPAWN_ERROR_CODES.has(result?.spawnErrorCode) ? result.spawnErrorCode : null,
    timedOut: Boolean(result?.timedOut),
    outputTruncated: Boolean(result?.outputTruncated),
  };
}

function validProjectId(projectId) {
  return typeof projectId === 'string' && /^[a-z0-9]{3,32}$/i.test(projectId);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseSupabaseProjectContainerNames(output, projectId) {
  if (!validProjectId(projectId)) return [];
  const suffix = escapeRegExp(projectId);
  const pattern = new RegExp(`^/?supabase_([a-z][a-z0-9_-]*)_${suffix}$`, 'i');
  const names = new Set();
  for (const line of asText(output).split(/\r?\n/)) {
    const name = line.trim();
    const match = pattern.exec(name);
    if (!match || !KNOWN_SERVICES.has(match[1].toLowerCase().replaceAll('_', '-'))) continue;
    names.add(name.replace(/^\//, ''));
    if (names.size >= MAX_CONTAINERS) break;
  }
  return [...names];
}

export function parseSupabaseContainerState(output, expectedName, projectId) {
  if (!validProjectId(projectId)) return null;
  const [rawName, rawState, rawExit, rawHealth, rawOom] = asText(output).trim().split('|');
  const names = parseSupabaseProjectContainerNames(rawName, projectId);
  if (names.length !== 1 || names[0] !== String(expectedName).replace(/^\//, '')) return null;
  const service = names[0].slice('supabase_'.length, -(projectId.length + 1)).replaceAll('_', '-');
  const state = VALID_CONTAINER_STATES.has(rawState) ? rawState : 'unknown';
  const exitCode = /^\d{1,3}$/.test(rawExit || '') ? Number(rawExit) : null;
  const health = VALID_HEALTH_STATES.has(rawHealth) ? rawHealth : null;
  const oomKilled = rawOom === 'true' ? true : rawOom === 'false' ? false : null;
  return {
    name: names[0],
    service,
    state,
    exitCode: exitCode !== null && exitCode <= 255 ? exitCode : null,
    health,
    oomKilled,
  };
}

export function parseSupabaseResourceSnapshot(dockerInfoOutput, diskOutput) {
  const [memoryBytesRaw, cpuCountRaw] = asText(dockerInfoOutput).trim().split('|');
  const memoryBytes = /^\d{1,16}$/.test(memoryBytesRaw || '') ? Number(memoryBytesRaw) : null;
  const cpuCount = /^\d{1,4}$/.test(cpuCountRaw || '') ? Number(cpuCountRaw) : null;
  const diskRows = asText(diskOutput).split(/\r?\n/).map((line) => line.trim().split(/\s+/));
  const availableDiskValues = diskRows
    .filter((parts) => parts.length >= 5 && /^\d+$/.test(parts[3] || '') && /^\d+%$/.test(parts[4] || ''))
    .map((parts) => Number(parts[3]))
    .filter(Number.isSafeInteger);
  const availableDiskKiB = availableDiskValues.length > 0 ? Math.min(...availableDiskValues) : null;
  return {
    memoryBytes: Number.isSafeInteger(memoryBytes) ? memoryBytes : null,
    cpuCount: Number.isInteger(cpuCount) && cpuCount > 0 ? cpuCount : null,
    availableDiskKiB: Number.isSafeInteger(availableDiskKiB) ? availableDiskKiB : null,
    filesystemsChecked: availableDiskValues.length,
    belowRecommendedDiskMinimum: Number.isSafeInteger(availableDiskKiB)
      ? availableDiskKiB < RECOMMENDED_MINIMUM_DISK_KIB
      : null,
  };
}

function extractServices(text, projectId, containers) {
  const services = new Set(containers
    .filter((container) => container.state === 'exited' || container.state === 'dead' || container.health === 'unhealthy')
    .map((container) => container.service));
  if (validProjectId(projectId)) {
    const pattern = new RegExp(`\\bsupabase_([a-z][a-z0-9_-]*)_${escapeRegExp(projectId)}\\b`, 'ig');
    for (const match of text.matchAll(pattern)) {
      const name = match[1].toLowerCase().replaceAll('_', '-');
      if (KNOWN_SERVICES.has(name)) services.add(name);
    }
  }
  const servicePattern = /\b(?:service|container)\s+["']?([a-z][a-z0-9_-]*)["']?/ig;
  for (const match of text.matchAll(servicePattern)) {
    const name = match[1].toLowerCase().replaceAll('_', '-');
    if (KNOWN_SERVICES.has(name)) services.add(name);
  }
  return [...services].sort().slice(0, 12);
}

function classifyFailure(text, processResult, containers, resources, startupOutputEvidence) {
  const lower = text.toLowerCase();
  const signals = resources?.belowRecommendedDiskMinimum === true
    ? ['disk_headroom_below_recommended_minimum']
    : [];
  const hasDiskError = /no space left on device|disk quota exceeded|insufficient disk|not enough disk space/.test(lower);
  const hasMemoryError = /out of memory|cannot allocate memory|oomkilled|memory limit exceeded/.test(lower)
    || containers.some((container) => container.oomKilled === true);
  const hasNetworkError = /temporary failure in name resolution|could not resolve|no route to host|network is unreachable|failed to create (?:the )?network|network .*?(?:failed|error|unavailable)|connection refused|connection reset|dial tcp|i\/o timeout/.test(lower);
  const hasPullError = /pull access denied|manifest unknown|failed to pull (?:an? )?image|failed to pull image|error pulling image|error pulling fs layer|image .*?(?:not found|pull failed)/.test(lower);
  const hasHealthError = /health.?check|unhealthy|failed to become healthy|failed health|service .*?not healthy/.test(lower)
    || containers.some((container) => container.health === 'unhealthy');
  const hasConfigError = /failed to parse config|invalid supabase\/config\.toml|unknown flag|invalid configuration|could not find config file/.test(lower);

  if (hasDiskError) {
    signals.push('disk_write_failure');
    return { kind: 'resource_failure', phase: 'resource_allocation', resource: 'disk', signals };
  }
  if (hasMemoryError) {
    signals.push('memory_exhaustion');
    return { kind: 'resource_failure', phase: 'resource_allocation', resource: 'memory', signals };
  }
  if (hasHealthError) {
    signals.push('service_health_check_failure');
    return { kind: 'service_health_check_failure', phase: 'service_health_check', resource: null, signals };
  }
  if (hasConfigError) {
    signals.push('supabase_cli_configuration_failure');
    return { kind: 'supabase_cli_configuration_failure', phase: 'cli_configuration', resource: null, signals };
  }
  const recognizedSignature = STARTUP_FAILURE_SIGNATURES.find(({ signal }) =>
    startupOutputEvidence.recognizedFailureSignals.includes(signal));
  if (recognizedSignature) {
    return {
      kind: recognizedSignature.kind,
      phase: recognizedSignature.phase,
      resource: null,
      signals: [recognizedSignature.signal],
    };
  }
  if (hasNetworkError) {
    signals.push(/temporary failure in name resolution|could not resolve/.test(lower) ? 'dns_resolution_failure' : 'network_connectivity_failure');
    return { kind: 'startup_network_failure', phase: 'network_setup', resource: null, signals };
  }
  if (hasPullError) {
    signals.push(/pull access denied/.test(lower) ? 'image_registry_access_denied' : /manifest unknown|not found/.test(lower) ? 'image_manifest_unavailable' : 'image_pull_failure');
    return { kind: 'image_pull_failure', phase: 'image_pull', resource: null, signals };
  }
  if (processResult?.timedOut) {
    signals.push('startup_command_timed_out');
    return { kind: 'startup_timeout', phase: 'startup_wait', resource: null, signals };
  }
  const exited = containers.filter((container) => container.state === 'exited' || container.state === 'dead');
  if (exited.length > 0) {
    signals.push('service_container_exited');
    return { kind: 'service_start_failure', phase: 'container_start', resource: null, signals };
  }
  return { kind: 'unknown_startup_failure', phase: 'unclassified', resource: null, signals };
}

export function parseSupabaseStartupDiagnostics({
  processResult = {},
  projectId,
  containerListResult = null,
  containerNames = [],
  containers = [],
  dockerInfoResult = null,
  diskResult = null,
} = {}) {
  const output = [asText(processResult.stdout), asText(processResult.stderr)].join('\n').slice(0, 2_000_000);
  const startupOutputEvidence = collectStartupOutputEvidence(
    processResult.stdout, processResult.stderr, processResult,
  );
  const discoveredNames = [...new Set(containerNames
    .filter((name) => typeof name === 'string')
    .flatMap((name) => parseSupabaseProjectContainerNames(name, projectId)))].slice(0, MAX_CONTAINERS);
  const stateRecords = containers.filter((container) => container && discoveredNames.includes(container.name))
    .map((container) => {
      const service = typeof container.service === 'string' ? container.service.toLowerCase() : '';
      if (!KNOWN_SERVICES.has(service)) return null;
      return {
        name: container.name,
        service,
        state: VALID_CONTAINER_STATES.has(container.state) ? container.state : 'unknown',
        exitCode: Number.isInteger(container.exitCode) && container.exitCode >= 0 && container.exitCode <= 255 ? container.exitCode : null,
        health: VALID_HEALTH_STATES.has(container.health) ? container.health : null,
        oomKilled: typeof container.oomKilled === 'boolean' ? container.oomKilled : null,
      };
    }).filter(Boolean).slice(0, MAX_CONTAINERS);
  const resources = parseSupabaseResourceSnapshot(dockerInfoResult?.stdout, diskResult?.stdout);
  const classification = classifyFailure(output, processResult, stateRecords, resources, startupOutputEvidence);
  const discoveryAvailable = containerListResult
    ? containerListResult.code === 0 && !containerListResult.timedOut && !containerListResult.outputTruncated
    : null;
  const diagnosticTools = {
    containerList: containerListResult ? safeToolResult(containerListResult) : null,
    dockerInfo: dockerInfoResult ? safeToolResult(dockerInfoResult) : null,
    disk: diskResult ? safeToolResult(diskResult) : null,
  };
  return {
    kind: classification.kind,
    phase: classification.phase,
    resource: classification.resource,
    signals: classification.signals,
    failedServices: extractServices(output, projectId, stateRecords),
    process: {
      exitStatus: exitStatus(processResult.code),
      signal: VALID_SIGNALS.has(processResult.signal) ? processResult.signal : null,
      spawnErrorCode: VALID_SPAWN_ERROR_CODES.has(processResult.spawnErrorCode) ? processResult.spawnErrorCode : null,
      timedOut: Boolean(processResult.timedOut),
      outputTruncated: Boolean(processResult.outputTruncated),
    },
    containers: {
      discoveryAvailable,
      created: discoveryAvailable === true ? discoveredNames.length > 0 : null,
      count: discoveryAvailable === true ? discoveredNames.length : null,
      names: discoveredNames,
      states: stateRecords.map(({ name, service, state, exitCode, health, oomKilled }) => ({
        name, service, state, exitCode, health, oomKilled,
      })),
      inspectionFailures: discoveryAvailable === true
        ? Math.max(0, discoveredNames.length - stateRecords.length)
        : null,
      outputTruncated: Boolean(containerListResult?.outputTruncated),
    },
    resources,
    startupOutputEvidence,
    diagnosticOutputTruncated: Boolean(
      processResult.outputTruncated || containerListResult?.outputTruncated
      || dockerInfoResult?.outputTruncated || diskResult?.outputTruncated,
    ),
    diagnosticTools,
  };
}

export async function runSupabaseStartWithDiagnostics({ start, diagnose, cleanup }) {
  try {
    return await start();
  } catch (error) {
    let diagnostic;
    try {
      diagnostic = await diagnose(error);
    } catch {
      diagnostic = {
        kind: 'startup_diagnostics_unavailable',
        phase: 'diagnostic_collection',
        failedServices: [],
        process: {
          exitStatus: exitStatus(error?.processResult?.code),
          signal: VALID_SIGNALS.has(error?.processResult?.signal) ? error.processResult.signal : null,
          timedOut: Boolean(error?.processResult?.timedOut),
          outputTruncated: Boolean(error?.processResult?.outputTruncated),
        },
      };
    }
    try {
      const cleanupResult = await cleanup();
      diagnostic.partialStartupCleanup = cleanupResult;
    } catch {
      diagnostic.partialStartupCleanup = { kind: 'failed' };
    }
    if (error && typeof error === 'object') error.safeDiagnostic = diagnostic;
    throw error;
  }
}
