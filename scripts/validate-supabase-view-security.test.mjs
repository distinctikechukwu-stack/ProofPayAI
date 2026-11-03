import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(repositoryRoot, 'supabase', 'migrations');
const correctionName = '202610310001_view_access_hardening.sql';
const correction = readFileSync(join(migrationsDirectory, correctionName), 'utf8').toLowerCase();
const hourlyReviewPrivilegeName = '202610310002_hourly_review_view_privilege.sql';
const hourlyReviewPrivilege = readFileSync(join(migrationsDirectory, hourlyReviewPrivilegeName), 'utf8').toLowerCase();
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const allMigrations = migrationFiles
  .map((name) => readFileSync(join(migrationsDirectory, name), 'utf8').toLowerCase())
  .join('\n');
const normalizedCorrection = normalizeSql(correction);
const normalizedAll = normalizeSql(allMigrations);

const privateViews = [
  'marketplace_jobs_for_user',
  'marketplace_proposals_for_user',
  'marketplace_offers_for_user',
  'service_hiring_requests_for_user',
  'project_conversations_for_user',
  'project_messages_for_user',
  'user_notifications_for_user',
  'hourly_contracts_for_user',
  'hourly_time_entries_for_user',
  'hourly_timer_sessions_for_user',
  'hourly_invoice_candidates_for_user',
];

const publicViews = ['public_freelancer_profiles', 'public_freelancer_services'];

function normalizeSql(source) {
  return source
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function viewDefinition(viewName) {
  const escapedName = viewName.replaceAll('_', '_');
  const startPattern = new RegExp(`create(?: or replace)? view public\\.${escapedName}\\b`, 'g');
  let start = -1;
  for (const match of normalizedAll.matchAll(startPattern)) start = match.index;
  assert.notEqual(start, -1, `No CREATE VIEW definition found for ${viewName}`);
  const end = normalizedAll.indexOf(';', start);
  assert.notEqual(end, -1, `CREATE VIEW statement for ${viewName} is not terminated`);
  return normalizedAll.slice(start, end + 1);
}

function statementWithPrefix(source, prefix) {
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `Missing SQL statement beginning with: ${prefix}`);
  const end = source.indexOf(';', start);
  assert.notEqual(end, -1, `Unterminated SQL statement beginning with: ${prefix}`);
  return source.slice(start, end + 1);
}

function functionBody(source, functionName) {
  const escapedName = functionName.replaceAll('_', '_');
  const expression = new RegExp(
    `create or replace function public\\.${escapedName}\\([\\s\\S]*?as \\\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  );
  const match = source.match(expression);
  assert.ok(match, `Missing function body for ${functionName}`);
  return normalizeSql(match[1]);
}

function columnGrantFor(tableName) {
  const expression = new RegExp(
    `grant select \\(([^;]*?)\\)\\s*on public\\.${tableName} to authenticated;`,
    'i',
  );
  const match = correction.match(expression);
  assert.ok(match, `Missing column-limited authenticated grant for ${tableName}`);
  return match[1].split(',').map((column) => column.trim());
}

test('corrective migration is new, ordered after the original seven, and transactional', () => {
  assert.match(correctionName, /^20261031\d{4}_/);
  assert.ok(migrationFiles.indexOf(correctionName) > migrationFiles.indexOf('202610300005_commercial_hardening.sql'));
  assert.match(normalizedCorrection, /^begin;/);
  assert.match(normalizedCorrection, /commit;$/);
  assert.doesNotMatch(normalizedCorrection, /\b(drop|truncate|insert into|update public\.|delete from)\b/);
  assert.match(normalizedCorrection, /server_version_num/);
  assert.match(normalizedCorrection, /< 150000/);
});

test('anonymous access is revoked from every user-scoped view while authenticated access remains', () => {
  const revokeStatement = statementWithPrefix(normalizedCorrection, 'revoke all on public.marketplace_jobs_for_user');
  const grantStatement = statementWithPrefix(normalizedCorrection, 'grant select on public.marketplace_jobs_for_user');

  for (const viewName of privateViews) {
    assert.ok(revokeStatement.includes(`public.${viewName}`), `${viewName} is not revoked from PUBLIC/anon`);
    assert.ok(grantStatement.includes(`public.${viewName}`), `${viewName} is not retained for authenticated users`);
  }
  assert.match(revokeStatement, /from public,anon,authenticated;/);
  assert.match(grantStatement, /to authenticated;/);
});

test('the two deliberate public marketplace projections remain available to anon and authenticated', () => {
  const revokeStatement = statementWithPrefix(normalizedCorrection, 'revoke all on public.public_freelancer_profiles');
  const grantStatement = statementWithPrefix(normalizedCorrection, 'grant select on public.public_freelancer_profiles');

  for (const viewName of publicViews) {
    assert.ok(revokeStatement.includes(`public.${viewName}`));
    assert.ok(grantStatement.includes(`public.${viewName}`));
    const definition = viewDefinition(viewName);
    assert.match(definition, /security_barrier\s*=\s*true/);
    assert.match(normalizedCorrection, new RegExp(`alter view public\\.${viewName} set \\(security_invoker=false\\);`));
  }
  assert.match(grantStatement, /to anon,authenticated;/);
});

test('all authenticated-only views use invoker rights so underlying RLS applies', () => {
  for (const viewName of privateViews) {
    assert.match(
      normalizedCorrection,
      new RegExp(`alter view public\\.${viewName} set \\(security_invoker=true\\);`),
      `${viewName} must execute with caller privileges`,
    );
    assert.match(viewDefinition(viewName), /security_barrier\s*=\s*true/);
  }

  const policyPairs = [
    ['marketplace_jobs', 'marketplace_jobs_read_visible'],
    ['marketplace_proposals', 'marketplace_proposals_read_participant'],
    ['marketplace_offers', 'marketplace_offers_read_participant'],
    ['service_hiring_requests', 'service_requests_read_participant'],
    ['hourly_contracts', 'hourly_contracts_read_member'],
    ['hourly_time_entries', 'hourly_entries_read_member'],
    ['hourly_timer_sessions', 'hourly_timer_sessions_read_owner'],
    ['project_conversations', 'project_conversations_read_member'],
    ['project_messages', 'project_messages_read_member'],
    ['user_notifications', 'user_notifications_read_self'],
  ];
  for (const [tableName, policyName] of policyPairs) {
    assert.match(normalizedAll, new RegExp(`alter table public\\.${tableName} enable row level security;`));
    assert.ok(normalizedAll.includes(`create policy ${policyName} on public.${tableName}`), `${tableName} policy missing`);
  }
});

test('caller-filtered marketplace and messaging views retain cross-account predicates', () => {
  const jobView = viewDefinition('marketplace_jobs_for_user');
  const proposalView = viewDefinition('marketplace_proposals_for_user');
  const offerView = viewDefinition('marketplace_offers_for_user');
  const requestView = viewDefinition('service_hiring_requests_for_user');
  const conversationView = viewDefinition('project_conversations_for_user');
  const messageView = viewDefinition('project_messages_for_user');
  const notificationView = viewDefinition('user_notifications_for_user');

  assert.match(jobView, /job\.status='published' or job\.created_by=auth\.uid\(\)/);
  assert.match(proposalView, /proposal\.freelancer_id=auth\.uid\(\).*is_marketplace_job_owner\(proposal\.job_id\)/);
  assert.match(offerView, /offer\.client_id=auth\.uid\(\) or offer\.freelancer_id=auth\.uid\(\)/);
  assert.match(requestView, /request\.client_id=auth\.uid\(\) or request\.freelancer_id=auth\.uid\(\)/);
  assert.match(conversationView, /where public\.is_project_member\(c\.project_id\)/);
  assert.match(messageView, /where public\.is_project_member\(c\.project_id\)/);
  assert.match(notificationView, /notification\.user_id=auth\.uid\(\).*public\.is_project_member\(c\.project_id\)/);
});

test('project participant name helper exposes only a same-project display name to authenticated callers', () => {
  const body = functionBody(correction, 'project_participant_display_name');
  assert.match(body, /auth\.uid\(\) is not null/);
  assert.match(body, /public\.is_project_member\(p_project_id\)/);
  assert.match(body, /target_member\.project_id=p_project_id/);
  assert.match(body, /target_member\.user_id=p_user_id/);
  assert.match(body, /select profile\.display_name/);
  assert.doesNotMatch(body, /email|billing_email|avatar_url|profile\.\*/);
  assert.match(normalizedCorrection, /revoke all on function public\.project_participant_display_name\(uuid,uuid\) from public,anon,authenticated;/);
  assert.match(normalizedCorrection, /grant execute on function public\.project_participant_display_name\(uuid,uuid\) to authenticated;/);
});

test('authenticated view grants are column-limited on underlying private tables', () => {
  const expectedColumns = {
    marketplace_jobs: ['id', 'created_by', 'title', 'summary', 'description', 'requirements', 'skills', 'category', 'experience_level', 'project_type', 'fixed_budget_minor', 'hourly_rate_min_minor', 'hourly_rate_max_minor', 'currency', 'estimated_days', 'status', 'published_at', 'created_at', 'updated_at'],
    marketplace_proposals: ['id', 'job_id', 'freelancer_id', 'cover_letter', 'quote_minor', 'currency', 'timeline_days', 'portfolio_item_ids', 'status', 'created_at', 'updated_at'],
    marketplace_offers: ['id', 'proposal_id', 'job_id', 'freelancer_id', 'client_id', 'terms', 'amount_minor', 'currency', 'timeline_days', 'status', 'project_id', 'created_at', 'responded_at'],
    service_hiring_requests: ['id', 'service_id', 'client_id', 'freelancer_id', 'request_text', 'budget_minor', 'currency', 'status', 'created_at', 'responded_at'],
    hourly_contracts: ['project_id', 'freelancer_id', 'hourly_rate_minor', 'currency', 'status', 'agreement_version_id'],
    hourly_time_entries: ['id', 'project_id', 'agreement_version_id', 'freelancer_id', 'work_date', 'duration_seconds', 'description', 'source', 'status', 'created_at', 'submitted_at'],
    hourly_time_entry_reviews: ['entry_id', 'decision', 'details', 'created_at'],
    hourly_timer_sessions: ['id', 'project_id', 'freelancer_id', 'description', 'state', 'started_at', 'running_since', 'accumulated_seconds', 'stopped_at'],
    hourly_invoice_batches: ['id', 'project_id', 'released_at'],
    hourly_invoice_batch_entries: ['batch_id', 'entry_id'],
    project_conversations: ['id', 'project_id', 'created_at', 'last_message_at'],
    project_message_receipts: ['message_id', 'user_id'],
    user_notifications: ['id', 'conversation_id', 'message_id', 'user_id', 'actor_id', 'created_at', 'read_at'],
    user_blocks: ['blocker_id', 'blocked_id'],
  };

  for (const [tableName, expected] of Object.entries(expectedColumns)) {
    const granted = columnGrantFor(tableName).sort();
    assert.deepEqual(granted, [...expected].sort(), `${tableName} grant must match the exact view-required columns`);
    assert.ok(granted.length < 24, `${tableName} grant is unexpectedly broad`);
  }
});

test('hourly review history exposes only its view-ordering id under existing RLS', () => {
  const normalizedFollowup = normalizeSql(hourlyReviewPrivilege);
  const view = viewDefinition('hourly_time_entries_for_user');

  assert.match(normalizedFollowup, /^begin;/);
  assert.match(normalizedFollowup, /grant select \(id\) on public\.hourly_time_entry_reviews to authenticated;/);
  assert.match(normalizedFollowup, /commit;$/);
  assert.doesNotMatch(normalizedFollowup, /grant select on public\.hourly_time_entry_reviews/);
  assert.match(view, /order by history\.created_at desc,history\.id desc/);
  assert.ok(normalizedAll.includes('create policy hourly_entry_reviews_read_member on public.hourly_time_entry_reviews'));
});

test('hourly invoice candidates require the caller’s own active, accepted contract and approved time', () => {
  const view = viewDefinition('hourly_invoice_candidates_for_user');
  assert.match(view, /contract_row\.freelancer_id=auth\.uid\(\)/);
  assert.match(view, /contract_row\.status='active'/);
  assert.match(view, /project_row\.contract_type='hourly'/);
  assert.match(view, /project_row\.current_agreement_version_id=contract_row\.agreement_version_id/);
  assert.match(view, /public\.is_project_member\(project_row\.id\)/);
  assert.match(view, /entry\.status='approved'/);
  assert.match(view, /agreement_row\.state='accepted'/);
  assert.match(view, /count\(distinct accepted\.member_role\)\s*from public\.agreement_acceptances accepted\s*where accepted\.agreement_version_id=agreement_row\.id\)\s*=\s*2/);
  assert.match(view, /round\(contract_row\.hourly_rate_minor::numeric\*sum\(entry\.duration_seconds\)::numeric\/3600\)::bigint as amount_minor/);
  assert.match(view, /not exists \( select 1 from public\.hourly_invoice_batch_entries/);
  assert.doesNotMatch(view, /is_active_hourly_project/);
  assert.match(normalizedAll, /revoke all on function public\.is_active_hourly_project\(uuid\) from public,anon,authenticated;/);
  assert.doesNotMatch(normalizedCorrection, /grant execute on function public\.is_active_hourly_project\(uuid\)/);
});

test('hourly source tables retain member and owner RLS policies for cross-account isolation', () => {
  const requiredPolicies = [
    'hourly_contracts_read_member',
    'hourly_entries_read_member',
    'hourly_entry_reviews_read_member',
    'hourly_timer_sessions_read_owner',
    'hourly_invoice_batches_read_member',
    'hourly_invoice_batch_entries_read_member',
  ];
  for (const policyName of requiredPolicies) assert.ok(normalizedAll.includes(`create policy ${policyName}`), `${policyName} missing`);
  assert.match(normalizedAll, /using\(freelancer_id=auth\.uid\(\)\)/);
  assert.match(normalizedAll, /using\(public\.is_project_member\(project_id\)\)/);
  assert.match(normalizedCorrection, /create policy user_blocks_read_involved on public\.user_blocks for select to authenticated using \(blocker_id=auth\.uid\(\) or blocked_id=auth\.uid\(\)\)/);
});
