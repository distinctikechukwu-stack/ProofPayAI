import { join } from 'node:path';

const INHERITED_SAFE_KEYS = Object.freeze(['PATH', 'LANG', 'LC_ALL']);

export function createDisposablePostgresEnvironment(parentEnv, home, temp) {
  const env = Object.fromEntries(INHERITED_SAFE_KEYS
    .filter((key) => typeof parentEnv?.[key] === 'string')
    .map((key) => [key, parentEnv[key]]));

  Object.assign(env, {
    HOME: home,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    DOCKER_CONFIG: join(home, '.docker'),
    CI: 'true',
    SUPABASE_TELEMETRY_DISABLED: 'true',
  });

  // The caller validates the workflow branch and this marker before building the child environment.
  // Pass only the normalized marker required by the concurrency subprocess, never the parent env wholesale.
  if (parentEnv?.GITHUB_ACTIONS === 'true') env.GITHUB_ACTIONS = 'true';

  return env;
}
