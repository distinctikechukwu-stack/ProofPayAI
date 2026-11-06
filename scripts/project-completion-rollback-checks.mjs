const migrationOnlyFunctions = [
  'public.lock_project_completion_workflow(uuid)',
  'public.try_complete_fixed_price_project(uuid,text)',
  'public.prevent_completed_project_reopen()',
  'public.review_milestone_unlocked(uuid,text,text,uuid)',
  'public.accept_agreement_version_unlocked(uuid)',
  'public.add_project_client_unlocked(uuid,uuid)',
  'public.start_milestone_unlocked(uuid)',
  'public.submit_milestone_deliverable_unlocked(uuid,text,text,text,uuid)',
  'public.request_scope_change_unlocked(uuid,text,uuid)',
  'public.create_change_order_draft_unlocked(uuid,uuid,uuid,jsonb)',
  'public.decide_change_order_unlocked(uuid,text)',
  'public.recheck_project_completion(uuid)',
];

const originalFunctions = [
  'public.review_milestone(uuid,text,text,uuid)',
  'public.accept_agreement_version(uuid)',
  'public.add_project_client(uuid,uuid)',
  'public.start_milestone(uuid)',
  'public.submit_milestone_deliverable(uuid,text,text,text,uuid)',
  'public.request_scope_change(uuid,text,uuid)',
  'public.create_change_order_draft(uuid,uuid,uuid,jsonb)',
  'public.decide_change_order(uuid,text)',
];

const signatureSql = (values) => values.map((value) => `'${value}'`).join(',\n    ');

export const rollbackStateSql = `
with migration_only_functions(signature) as (
  select unnest(array[
    ${signatureSql(migrationOnlyFunctions)}
  ]::text[])
), original_functions(signature) as (
  select unnest(array[
    ${signatureSql(originalFunctions)}
  ]::text[])
)
select jsonb_build_object(
  'migrationHistoryCount', (select count(*)::integer from supabase_migrations.schema_migrations),
  'migrationHistoryLatestVersion', (select max(version) from supabase_migrations.schema_migrations),
  'fixtureProjectRowCount', (select count(*)::integer from public.projects where id = '00000000-0000-4000-8000-000000000100'),
  'projectStatus', (select status from public.projects where id = '00000000-0000-4000-8000-000000000100'),
  'migrationOnlyFunctionsRemaining', coalesce((
    select jsonb_agg(signature order by signature)
    from migration_only_functions
    where to_regprocedure(signature) is not null
  ), '[]'::jsonb),
  'originalFunctionsMissing', coalesce((
    select jsonb_agg(signature order by signature)
    from original_functions
    where to_regprocedure(signature) is null
  ), '[]'::jsonb),
  'completionTriggerPresent', exists (
    select 1 from pg_trigger
    where tgrelid = 'public.projects'::regclass
      and tgname = 'projects_prevent_completed_reopen'
      and not tgisinternal
  )
)::text;
`;

const knownFunctions = new Set([...migrationOnlyFunctions, ...originalFunctions]);

function normalizeFunctionList(value) {
  if (!Array.isArray(value)) return null;
  if (value.some((name) => typeof name !== 'string' || !knownFunctions.has(name))) return null;
  return [...value].sort();
}

export function evaluateInjectedSqlFailure({ prepared, processStarted = true, exitStatus, signal, timedOut, databaseCondition }) {
  const observed = {
    prepared: prepared === true,
    processStarted: processStarted === true,
    exitStatus: Number.isInteger(exitStatus) ? exitStatus : null,
    signal: typeof signal === 'string' && /^SIG[A-Z0-9]+$/.test(signal) ? signal : null,
    timedOut: timedOut === true,
    databaseCondition: ['division_by_zero', 'sqlstate_22012'].includes(databaseCondition)
      ? databaseCondition
      : 'unclassified_database_error',
  };

  if (!observed.prepared) {
    return { passed: false, check: 'failure_injection_prepared', expected: { prepared: true }, observed };
  }
  if (!observed.processStarted) {
    return { passed: false, check: 'injected_sql_process_started', expected: { processStarted: true }, observed };
  }
  if (observed.timedOut) {
    return { passed: false, check: 'injected_sql_completed', expected: { timedOut: false, exitStatus: 'non-zero' }, observed };
  }
  if (observed.exitStatus === null) {
    return { passed: false, check: 'injected_sql_exit_status', expected: { exitStatus: 'non-zero integer' }, observed };
  }
  if (observed.exitStatus === 0) {
    return { passed: false, check: 'injected_sql_exit_status', expected: { exitStatus: 'non-zero' }, observed };
  }
  if (!['division_by_zero', 'sqlstate_22012'].includes(observed.databaseCondition)) {
    return {
      passed: false,
      check: 'injected_sql_failure_condition',
      expected: { databaseCondition: 'division_by_zero or sqlstate_22012' },
      observed,
    };
  }
  return {
    passed: true,
    check: 'injected_sql_exit_status',
    expected: { exitStatus: 'non-zero', timedOut: false, databaseCondition: 'division_by_zero or sqlstate_22012' },
    observed,
  };
}

export function parseRollbackState(stdout) {
  const text = String(stdout ?? '').trim();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, observed: { stateQueryOutputParsed: false, outputLength: text.length } };
  }

  const migrationOnlyFunctionsRemaining = normalizeFunctionList(value?.migrationOnlyFunctionsRemaining);
  const originalFunctionsMissing = normalizeFunctionList(value?.originalFunctionsMissing);
  const valid = Number.isInteger(value?.migrationHistoryCount)
    && (value.migrationHistoryLatestVersion === null || (typeof value.migrationHistoryLatestVersion === 'string' && /^\d{12}$/.test(value.migrationHistoryLatestVersion)))
    && Number.isInteger(value?.fixtureProjectRowCount)
    && (value.projectStatus === null || /^[a-z_]{1,32}$/.test(value.projectStatus))
    && migrationOnlyFunctionsRemaining !== null
    && originalFunctionsMissing !== null
    && typeof value?.completionTriggerPresent === 'boolean';

  if (!valid) {
    return { ok: false, observed: { stateQueryOutputParsed: true, stateValuesValid: false } };
  }

  return {
    ok: true,
    observed: {
      migrationHistoryCount: value.migrationHistoryCount,
      migrationHistoryLatestVersion: value.migrationHistoryLatestVersion,
      fixtureProjectRowCount: value.fixtureProjectRowCount,
      projectStatus: value.projectStatus,
      migrationOnlyFunctionsRemaining,
      originalFunctionsMissing,
      completionTriggerPresent: value.completionTriggerPresent,
    },
  };
}

export function evaluateRollbackState(observed) {
  const expected = {
    migrationHistoryCount: 18,
    migrationHistoryLatestVersion: '202611020004',
    fixtureProjectRowCount: 1,
    projectStatus: 'in_progress',
    migrationOnlyFunctionsRemaining: [],
    originalFunctionsMissing: [],
    completionTriggerPresent: false,
  };
  const failedChecks = Object.keys(expected).filter((key) => {
    const left = Array.isArray(expected[key]) ? JSON.stringify(expected[key]) : expected[key];
    const right = Array.isArray(observed?.[key]) ? JSON.stringify(observed[key]) : observed?.[key];
    return left !== right;
  });
  return { passed: failedChecks.length === 0, check: 'post_rollback_database_state', expected, observed, failedChecks };
}

export function classifyDatabaseFailure(stderr) {
  const text = String(stderr ?? '');
  if (/division by zero/i.test(text)) return 'division_by_zero';
  const sqlState = text.match(/\bSQLSTATE\s*[:=]?\s*([0-9A-Z]{5})\b/i)?.[1];
  if (sqlState) return `sqlstate_${sqlState.toUpperCase()}`;
  return 'unclassified_database_error';
}

export function safeProcessFailure(processResult) {
  return {
    failureType: 'subprocess_failure',
    exitStatus: Number.isInteger(processResult?.code) ? processResult.code : null,
    signal: typeof processResult?.signal === 'string' && /^SIG[A-Z0-9]+$/.test(processResult.signal) ? processResult.signal : null,
    timedOut: processResult?.timedOut === true,
    databaseCondition: classifyDatabaseFailure(processResult?.stderr),
  };
}
