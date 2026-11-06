create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

select extensions.ok(
  has_function_privilege('authenticated', 'public.review_milestone(uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated participants can call the existing milestone review RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.recheck_project_completion(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.recheck_project_completion(uuid)', 'EXECUTE'),
  'completion recheck is not granted to anonymous or service-role callers'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.review_milestone_unlocked(uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated callers cannot bypass the completion-aware review wrapper'
);
select extensions.ok(
  (select procedure.prosecdef
   from pg_proc as procedure
   where procedure.oid = 'public.recheck_project_completion(uuid)'::regprocedure),
  'completion recheck runs with its reviewed security-definer boundary'
);
select extensions.ok(
  exists (
    select 1 from pg_proc as procedure
    where procedure.oid = 'public.recheck_project_completion(uuid)'::regprocedure
      and 'search_path=pg_catalog, public, auth, extensions' = any(procedure.proconfig)
  ),
  'completion recheck uses a fixed safe search path'
);

select extensions.is(
  (select status from public.projects where id = '00000000-0000-4000-8000-000000000100'),
  'in_progress'::text,
  'migration 19 leaves the pre-existing all-approved project unchanged'
);
select extensions.is(
  (select count(*) from public.milestones where project_id = '00000000-0000-4000-8000-000000000100' and workflow_status = 'approved'),
  2::bigint,
  'the historical fixture remains fully approved before an explicit recheck'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.review_milestone(
    (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000200' and sequence = 1),
    'approved', '', '00000000-0000-4000-8000-000000002001'
  )->'projectCompletion'->>'reason'),
  'milestones_not_all_approved'::text,
  'approving an earlier milestone does not complete a project with another unapproved milestone'
);
reset role;

select extensions.is(
  (select status from public.projects where id = '00000000-0000-4000-8000-000000000200'),
  'in_progress'::text,
  'the project remains in progress after an earlier milestone approval'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.review_milestone(
    (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000200' and sequence = 2),
    'approved', '', '00000000-0000-4000-8000-000000002002'
  )->'projectCompletion'->>'changed'),
  'true'::text,
  'the final approved milestone completes an eligible fixed-price project'
);
reset role;

select extensions.is(
  (select status from public.projects where id = '00000000-0000-4000-8000-000000000200'),
  'completed'::text,
  'the completed project status is persisted'
);
select extensions.is(
  (select count(*) from public.activity_logs where project_id = '00000000-0000-4000-8000-000000000200' and event_type = 'project.completed'),
  1::bigint,
  'one completion transition creates exactly one completion event'
);
select extensions.is(
  (select status from public.invoices where id = '00000000-0000-4000-8000-000000000220'),
  'paid'::text,
  'completion does not change the synthetic invoice payment status'
);
select extensions.ok(
  (select paid_at is not null and provider_status = 'PAID'
   from public.invoices where id = '00000000-0000-4000-8000-000000000220'),
  'completion leaves the verified payment timestamp and provider status intact'
);
select extensions.is(
  (select count(*) from public.milestone_reviews where project_id = '00000000-0000-4000-8000-000000000200'),
  2::bigint,
  'the client approval history contains one review per approved milestone'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.review_milestone(
    (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000200' and sequence = 2),
    'approved', '', '00000000-0000-4000-8000-000000002002'
  )->'projectCompletion'->>'reason'),
  'already_completed'::text,
  'replaying an identical final review is idempotent after completion'
);
select extensions.throws_ok(
  $$select public.review_milestone(
      (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000200' and sequence = 2),
      'approved', 'different synthetic details', '00000000-0000-4000-8000-000000002002'
    )$$,
  '23505',
  'Idempotency key was already used for a different review.',
  'reusing a review idempotency key with different data is rejected'
);
reset role;

select extensions.is(
  (select count(*) from public.milestone_reviews where project_id = '00000000-0000-4000-8000-000000000200'),
  2::bigint,
  'duplicate review attempts do not create another review record'
);
select extensions.is(
  (select count(*) from public.activity_logs where project_id = '00000000-0000-4000-8000-000000000200' and event_type = 'project.completed'),
  1::bigint,
  'duplicate review and completion attempts do not create another completion event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select public.review_milestone(
      (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000300' and sequence = 1),
      'approved', '', '00000000-0000-4000-8000-000000003001'
    )$$,
  '42501',
  'Only a project client may review a deliverable.',
  'a freelancer cannot approve a client-side milestone review'
);
select extensions.is(
  (public.recheck_project_completion('00000000-0000-4000-8000-000000000100')->>'changed'),
  'true'::text,
  'an authorized freelancer can explicitly recheck an existing eligible project'
);
reset role;

select extensions.is(
  (select status from public.projects where id = '00000000-0000-4000-8000-000000000100'),
  'completed'::text,
  'an explicit participant recheck completes a historical all-approved project'
);
select extensions.is(
  (select count(*) from public.activity_logs where project_id = '00000000-0000-4000-8000-000000000100' and event_type = 'project.completed'),
  1::bigint,
  'historical recheck records one completion event only when explicitly requested'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (public.recheck_project_completion('00000000-0000-4000-8000-000000000300')->>'reason'),
  'milestones_not_all_approved'::text,
  'a revision-requested milestone blocks completion'
);
select extensions.is(
  (public.recheck_project_completion('00000000-0000-4000-8000-000000000400')->>'reason'),
  'scope_workflow_unresolved'::text,
  'a pending scope-change request blocks completion'
);
select extensions.is(
  (public.recheck_project_completion('00000000-0000-4000-8000-000000000500')->>'reason'),
  'scope_workflow_unresolved'::text,
  'an analyzed scope request without a rejected outcome blocks completion'
);
select extensions.is(
  (public.recheck_project_completion('00000000-0000-4000-8000-000000000600')->>'reason'),
  'amendment_unresolved_or_unrepresented'::text,
  'an accepted amendment without represented milestones blocks completion'
);
select extensions.is(
  (public.recheck_project_completion('00000000-0000-4000-8000-000000000700')->>'reason'),
  'not_fixed_price'::text,
  'hourly projects are excluded from fixed-price milestone completion'
);
select extensions.is(
  (public.recheck_project_completion('00000000-0000-4000-8000-000000000900')->>'changed'),
  'true'::text,
  'a rejected scope change does not block completion of the original accepted scope'
);
reset role;

select extensions.is(
  (select status from public.projects where id = '00000000-0000-4000-8000-000000000300'),
  'in_progress'::text,
  'blocked projects remain in progress'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select extensions.ok(
  not exists (select 1 from public.projects where id = '00000000-0000-4000-8000-000000000200')
  and not exists (select 1 from public.change_requests where project_id = '00000000-0000-4000-8000-000000000400'),
  'RLS hides project and scope data from an unrelated authenticated user'
);
select extensions.throws_ok(
  $$select public.recheck_project_completion('00000000-0000-4000-8000-000000000200')$$,
  '42501',
  'Only a project participant may recheck project completion.',
  'an unrelated authenticated user cannot complete another project'
);
reset role;

select * from extensions.finish();
rollback;
