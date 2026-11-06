import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(repositoryRoot, 'supabase', 'migrations');
const migrationName = '202611050001_project_completion_workflow.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const coreMigration = readFileSync(join(migrationsDirectory, '202610290001_core_project_security.sql'), 'utf8');
const normalized = migration.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function functionPartsFrom(source, functionName, declaration = 'create or replace function') {
  const lower = source.toLowerCase();
  const start = lower.indexOf(`${declaration} public.${functionName.toLowerCase()}(`);
  assert.notEqual(start, -1, `Missing function ${functionName}`);
  const bodyStart = lower.indexOf('as $$', start);
  assert.notEqual(bodyStart, -1, `Missing body for ${functionName}`);
  const bodyEnd = lower.indexOf('$$;', bodyStart + 'as $$'.length);
  assert.notEqual(bodyEnd, -1, `Missing end for ${functionName}`);
  return {
    header: lower.slice(start, bodyStart),
    body: lower.slice(bodyStart + 'as $$'.length, bodyEnd).replace(/\s+/g, ' '),
  };
}

function functionParts(functionName) { return functionPartsFrom(migration, functionName); }
function body(name) { return functionParts(name).body; }

test('completion is a new transactional migration after the 18-migration staging baseline', () => {
  assert.match(migrationName, /^20261105\d{4}_/);
  assert.ok(migrationFiles.indexOf(migrationName) > migrationFiles.indexOf('202611020004_paypal_webhook_durable_processing.sql'));
  assert.match(normalized, /^begin;/);
  assert.match(normalized, /commit;$/);
  const outsideBodies = normalized.replace(/create or replace function public\.[\s\S]*?\bas \$\$[\s\S]*?\$\$;/gi, '<function>');
  assert.doesNotMatch(outsideBodies, /\b(insert|update|delete)\s+into?\s+public\.projects\b/);
  assert.doesNotMatch(outsideBodies, /\b(grant|revoke)\s+[^;]*\b(update|insert|delete)\b[^;]*public\.projects/);
});

test('only a newly approved milestone review triggers completion evaluation', () => {
  const review = body('review_milestone');
  assert.match(review, /perform public\.lock_project_completion_workflow\(target_project_id\)/);
  assert.match(review, /review_result := public\.review_milestone_unlocked\(/);
  assert.match(review, /if p_decision = 'approved' and review_result ->> 'status' = 'approved' then/);
  assert.match(review, /public\.try_complete_fixed_price_project\(target_project_id, 'milestone_review'\)/);
  assert.match(normalized, /alter function public\.review_milestone\(uuid, text, text, uuid\) rename to review_milestone_unlocked/);
  const originalReview = functionPartsFrom(coreMigration, 'review_milestone').body;
  assert.match(originalReview, /r\.idempotency_key = p_idempotency_key/);
  assert.match(originalReview, /r\.reviewed_by = actor_id/);
  assert.match(originalReview, /r\.decision = p_decision and r\.note = coalesce\(p_note, ''\)/);
});

test('completion requires an accepted current fixed agreement and both actual participant acceptances', () => {
  const completion = body('try_complete_fixed_price_project');
  assert.match(completion, /project_row\.contract_type is distinct from 'fixed'/);
  assert.match(completion, /agreement_record\.id = project_row\.current_agreement_version_id/);
  assert.match(completion, /agreement_row\.state is distinct from 'accepted'/);
  assert.match(completion, /newer_agreement\.version_number > agreement_row\.version_number/);
  assert.match(completion, /acceptance\.member_role = 'client'/);
  assert.match(completion, /acceptance\.member_role = 'freelancer'/);
  assert.match(completion, /member_row\.user_id = acceptance\.user_id/);
  assert.match(completion, /member_row\.role = acceptance\.member_role/);
});

test('completion requires a non-empty current milestone set with every milestone approved and exact totals', () => {
  const completion = body('try_complete_fixed_price_project');
  assert.match(completion, /where milestone_row\.project_id = p_project_id and milestone_row\.agreement_version_id = agreement_row\.id/);
  assert.match(completion, /count\(\*\) filter \(where milestone_row\.workflow_status <> 'approved'\)/);
  assert.match(completion, /milestone_count = 0/);
  assert.match(completion, /milestone_total is distinct from agreement_row\.total_minor::numeric/);
  assert.match(completion, /agreement_row\.total_minor is distinct from project_row\.budget_minor/);
  assert.match(completion, /currency_mismatch_count > 0/);
});

test('open scope work and every accepted-but-unrepresented amendment block completion; rejected changes do not', () => {
  const completion = body('try_complete_fixed_price_project');
  assert.match(completion, /request_row\.status in \('pending_analysis', 'proposal_ready'\)/);
  assert.match(completion, /request_row\.status = 'analyzed' and not exists/);
  assert.match(completion, /rejected_change\.state = 'rejected'/);
  assert.match(completion, /change_order\.state in \('draft', 'awaiting_approval', 'accepted'\)/);
  assert.doesNotMatch(completion, /change_order\.state in \([^)]*'rejected'/);
  assert.match(completion, /amendment_unresolved_or_unrepresented/);
});

test('project completion is serialized before child-row locks and creates one event only on status transition', () => {
  const lock = body('lock_project_completion_workflow');
  const completion = body('try_complete_fixed_price_project');
  assert.match(lock, /pg_advisory_xact_lock\(hashtextextended\('project-workflow:' \|\| p_project_id::text, 0\)\)/);
  assert.match(lock, /where project_row\.id = p_project_id for update/);
  assert.match(completion, /update public\.projects as project_record set status = 'completed'/);
  assert.match(completion, /project_record\.status in \('agreed', 'in_progress'\)/);
  assert.ok(completion.indexOf("set status = 'completed'") < completion.indexOf("'project.completed'"));
  assert.equal((completion.match(/'project\.completed'/g) ?? []).length, 1);
  assert.match(completion, /if project_row\.status = 'completed' then[\s\S]*?'already_completed'/);
  for (const name of [
    'review_milestone', 'accept_agreement_version', 'add_project_client', 'start_milestone', 'submit_milestone_deliverable',
    'request_scope_change', 'create_change_order_draft', 'decide_change_order', 'recheck_project_completion',
  ]) {
    assert.match(body(name), /public\.lock_project_completion_workflow\(/, `${name} must acquire the workflow lock first`);
  }
});

test('historical recheck is authenticated, participant-only, fixed-price guarded, and does not backfill', () => {
  const recheck = body('recheck_project_completion');
  const completion = body('try_complete_fixed_price_project');
  assert.match(recheck, /actor_id uuid := auth\.uid\(\)/);
  assert.match(recheck, /if actor_id is null then/);
  assert.match(recheck, /public\.is_project_member\(p_project_id\)/);
  assert.match(recheck, /public\.try_complete_fixed_price_project\(p_project_id, 'participant_recheck'\)/);
  assert.match(completion, /project_row\.contract_type is distinct from 'fixed'/);
  assert.match(normalized, /revoke all on function public\.recheck_project_completion\(uuid\) from public, anon, service_role/);
  assert.match(normalized, /grant execute on function public\.recheck_project_completion\(uuid\) to authenticated/);
  const outsideBodies = normalized.replace(/create or replace function public\.[\s\S]*?\bas \$\$[\s\S]*?\$\$;/gi, '<function>');
  assert.doesNotMatch(outsideBodies, /update public\.projects/);
});

test('completion is separate from PayPal/payment state and completed projects cannot be reopened implicitly', () => {
  assert.doesNotMatch(normalized, /public\.invoices|paypal|paid_at|provider_status/);
  const guard = body('prevent_completed_project_reopen');
  assert.match(guard, /old\.status = 'completed'/);
  assert.match(guard, /new\.status is distinct from 'completed'/);
  assert.match(guard, /new\.current_agreement_version_id is distinct from old\.current_agreement_version_id/);
  assert.match(normalized, /create trigger projects_prevent_completed_reopen/);
});

test('wrapped originals remain inaccessible directly and authenticated wrappers retain their narrow grants', () => {
  const names = [
    ['review_milestone', 'uuid, text, text, uuid'],
    ['accept_agreement_version', 'uuid'],
    ['add_project_client', 'uuid, uuid'],
    ['start_milestone', 'uuid'],
    ['submit_milestone_deliverable', 'uuid, text, text, text, uuid'],
    ['request_scope_change', 'uuid, text, uuid'],
    ['create_change_order_draft', 'uuid, uuid, uuid, jsonb'],
    ['decide_change_order', 'uuid, text'],
  ];
  for (const [name, args] of names) {
    assert.match(normalized, new RegExp(`revoke all on function public\\.${name}_unlocked\\(${args.replaceAll(', ', ',\\s*')}\\) from public, anon, authenticated, service_role`));
    assert.match(normalized, new RegExp(`revoke all on function public\\.${name}\\(${args.replaceAll(', ', ',\\s*')}\\) from public, anon, service_role`));
    assert.match(normalized, new RegExp(`grant execute on function public\\.${name}\\(${args.replaceAll(', ', ',\\s*')}\\) to authenticated`));
  }
});
