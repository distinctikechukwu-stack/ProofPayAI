import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(repositoryRoot, 'supabase', 'migrations');
const migrationName = '202610310003_workflow_sql_corrections.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const normalized = migration.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function functionParts(functionName) {
  const lowerMigration = migration.toLowerCase();
  const start = lowerMigration.indexOf(`create or replace function public.${functionName.toLowerCase()}(`);
  assert.notEqual(start, -1, `Missing replacement function ${functionName}`);
  const bodyStart = lowerMigration.indexOf('as $$', start);
  assert.notEqual(bodyStart, -1, `Missing function body delimiter for ${functionName}`);
  const bodyEnd = lowerMigration.indexOf('$$;', bodyStart + 'as $$'.length);
  assert.notEqual(bodyEnd, -1, `Missing function body end delimiter for ${functionName}`);
  return {
    header: lowerMigration.slice(start, bodyStart),
    body: lowerMigration.slice(bodyStart + 'as $$'.length, bodyEnd).replace(/\s+/g, ' '),
  };
}

function functionBody(functionName) {
  return functionParts(functionName).body;
}

test('workflow correction is a new transactional migration after the nine applied migrations', () => {
  assert.match(migrationName, /^20261031\d{4}_/);
  assert.ok(migrationFiles.indexOf(migrationName) > migrationFiles.indexOf('202610310002_hourly_review_view_privilege.sql'));
  assert.match(normalized, /^begin;/);
  assert.match(normalized, /commit;$/);
  const outsideFunctionBodies = normalized.replace(/create or replace function public\.[\s\S]*?\bas \$\$[\s\S]*?\$\$;/gi, '<function>');
  assert.doesNotMatch(outsideFunctionBodies, /\b(create|alter|drop) table\b|\b(create|drop) policy\b|\b(grant|revoke)\b/);
});

test('freelancer portfolio order reads ordinality from its WITH ORDINALITY alias', () => {
  const body = functionBody('save_my_freelancer_profile');
  assert.match(body, /with ordinality as entries\(value, ordinality\)/);
  assert.match(body, /\(entries\.ordinality - 1\)::integer/);
  assert.doesNotMatch(body, /item\.ordinality/);
  assert.match(body, /auth\.uid\(\)/);
  assert.match(body, /role = 'freelancer'/);
});

test('message notification trigger uses a non-shadowing project target and qualified relations', () => {
  const body = functionBody('notify_project_message');
  assert.match(body, /target_project_id uuid/);
  assert.match(body, /conversation_row\.project_id into target_project_id/);
  assert.match(body, /where conversation_row\.id = new\.conversation_id/);
  assert.match(body, /member_row\.project_id = target_project_id/);
  assert.doesNotMatch(body, /\bproject_id\s*:=|\bproject_id\s+uuid/);
});

test('milestone dependency query separates the PL/pgSQL variable from the column name', () => {
  const body = functionBody('start_milestone');
  assert.match(body, /target_dependency_sequences integer\[\]/);
  assert.match(body, /dependency_row\.sequence = any\(target_dependency_sequences\)/);
  assert.match(body, /dependency_row\.project_id = target_project_id/);
  assert.doesNotMatch(body, /\bdependency_sequences\s+integer\[\]/);
  assert.doesNotMatch(body, /any\(dependency_sequences\)/);
  assert.match(body, /public\.has_project_role\(target_project_id, 'freelancer'\)/);
});

test('conversation and notification read functions qualify user notification fields', () => {
  const conversationBody = functionBody('mark_project_conversation_read');
  const singleNotificationBody = functionBody('mark_user_notification_read');
  const countBody = functionBody('count_user_unread_notifications');

  assert.match(conversationBody, /notification_row\.user_id = current_user_id/);
  assert.match(conversationBody, /notification_row\.conversation_id = p_conversation_id/);
  assert.match(singleNotificationBody, /target_notification\.user_id = current_user_id/);
  assert.match(singleNotificationBody, /target_notification\.id = p_notification_id/);
  assert.match(countBody, /notification_row\.user_id = current_user_id/);
  assert.match(countBody, /notification_row\.read_at is null/);
  for (const body of [conversationBody, singleNotificationBody, countBody]) {
    assert.match(body, /auth\.uid\(\)/);
    assert.doesNotMatch(body, /\bwhere user_id\s*=\s*actor_id\b/);
  }
});

test('agreement RPC retains authorization and two-party acceptance for fixed and hourly contracts', () => {
  const body = functionBody('accept_agreement_version');
  assert.match(body, /actor_id uuid := auth\.uid\(\)/);
  assert.match(body, /project_members as member_row/);
  assert.match(body, /actor_role not in \('client', 'freelancer'\)/);
  assert.match(body, /contract_row\.status = 'draft'/);
  assert.match(body, /contract_row\.freelancer_id/);
  assert.match(body, /contract_row\.client_id/);
  assert.match(body, /actor_role = 'freelancer' and actor_id = contract_freelancer_id/);
  assert.match(body, /actor_role = 'client' and actor_id = contract_client_id/);
  assert.match(body, /is distinct from rate_minor/);
  assert.match(body, /is distinct from 'hourly'/);
  assert.match(body, /milestone_count <> 0/);
  assert.match(body, /milestone_count not between 1 and 20/);
  assert.match(body, /milestone_total is distinct from agreement_total::numeric/);
  assert.match(body, /join public\.project_members as accepted_member/);
  assert.match(body, /accepted_member\.role = acceptance\.member_role/);
  assert.match(body, /get diagnostics acceptance_inserted_count = row_count/);
  assert.match(body, /set status = 'active'/);
  assert.match(body, /activated_contract_count <> 1/);
  assert.match(functionParts('accept_agreement_version').header, /security definer/);
  assert.match(functionParts('accept_agreement_version').header, /set search_path = pg_catalog, public, extensions/);
});

test('deferred invariant keeps fixed-price totals strict and validates accepted hourly contracts', () => {
  const body = functionBody('assert_accepted_agreement_total');
  assert.match(body, /version_state is distinct from 'accepted'/);
  assert.match(body, /accepted_role_count <> 2/);
  assert.match(body, /if contract_kind = 'fixed' then/);
  assert.match(body, /milestone_count not between 1 and 20/);
  assert.match(body, /actual_total is distinct from expected_total::numeric/);
  assert.match(body, /elsif contract_kind = 'hourly' then/);
  assert.match(body, /milestone_count <> 0/);
  assert.match(body, /contract_status is distinct from 'active'/);
  assert.match(body, /current_agreement_version_id is distinct from target_version_id/);
  assert.match(body, /contract_rate is distinct from expected_total/);
  assert.match(body, /project_total is distinct from expected_total/);
  assert.match(body, /agreement_terms->>'contracttype' is distinct from 'hourly'/);
  assert.match(body, /freelancer_member\.role = 'freelancer'/);
  assert.match(body, /client_member\.role = 'client'/);
  assert.match(body, /freelancer_acceptance\.user_id = contract_freelancer_id/);
  assert.match(body, /client_acceptance\.user_id = contract_client_id/);
});

test('correction replaces only the intended workflow functions and adds no access-control changes', () => {
  const replacedFunctions = [...migration.matchAll(/create or replace function public\.([a-z_]+)\s*\(/gi)]
    .map((match) => match[1].toLowerCase())
    .sort();
  assert.deepEqual(replacedFunctions, [
    'accept_agreement_version',
    'assert_accepted_agreement_total',
    'count_user_unread_notifications',
    'mark_project_conversation_read',
    'mark_user_notification_read',
    'notify_project_message',
    'save_my_freelancer_profile',
    'start_milestone',
  ]);
  assert.doesNotMatch(normalized, /\b(grant|revoke|create policy|alter table .*row level security)\b/);
});

test('replacement functions preserve their existing SECURITY DEFINER posture', () => {
  const expectedSecurityDefiner = {
    save_my_freelancer_profile: true,
    notify_project_message: true,
    start_milestone: true,
    mark_project_conversation_read: true,
    mark_user_notification_read: true,
    count_user_unread_notifications: true,
    accept_agreement_version: true,
    assert_accepted_agreement_total: false,
  };

  for (const [name, expected] of Object.entries(expectedSecurityDefiner)) {
    assert.equal(functionParts(name).header.includes('security definer'), expected, `${name} security posture changed`);
  }
});
