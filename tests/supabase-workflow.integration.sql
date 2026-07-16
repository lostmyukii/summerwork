\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(condition, false) then raise exception 'ASSERTION FAILED: %', message; end if;
end;
$$;

create or replace function pg_temp.expect_error(statement text, expected_message text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected_message in sqlerrm) > 0 then return; end if;
    raise exception 'UNEXPECTED ERROR: %', sqlerrm;
  end;
  raise exception 'EXPECTED ERROR WAS NOT RAISED: %', expected_message;
end;
$$;

\set parent_id '11111111-1111-4111-8111-111111111111'
\set student_user_id '22222222-2222-4222-8222-222222222222'
\set math_tutor_id '33333333-3333-4333-8333-333333333333'
\set physics_tutor_id '44444444-4444-4444-8444-444444444444'
\set student_record_id '55555555-5555-4555-8555-555555555555'

insert into auth.users(id, email, raw_user_meta_data) values
  (:'parent_id', 'parent@example.test', '{"display_name":"家长"}'),
  (:'student_user_id', 'student@example.test', '{"display_name":"孩子"}'),
  (:'math_tutor_id', 'math@example.test', '{"display_name":"数学家教"}'),
  (:'physics_tutor_id', 'physics@example.test', '{"display_name":"物理家教"}');

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.create_family_space('暑期闭环测试家庭') as family_id \gset
reset role;

insert into public.students(id, family_id, user_id, display_name, grade, school_year, created_by)
values(:'student_record_id', :'family_id', :'student_user_id', '测试孩子', '高一升高二', '2026', :'parent_id');
insert into public.family_memberships(family_id, user_id, role) values
  (:'family_id', :'student_user_id', 'student'),
  (:'family_id', :'math_tutor_id', 'tutor'),
  (:'family_id', :'physics_tutor_id', 'tutor');
insert into public.tutor_assignments(family_id, student_id, subject_id, tutor_user_id, created_by) values
  (:'family_id', :'student_record_id', 'math', :'math_tutor_id', :'parent_id'),
  (:'family_id', :'student_record_id', 'physics', :'physics_tutor_id', :'parent_id');

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.create_manual_homework(
  :'student_record_id', 'math', '函数综合测试', '独立完成并订正',
  '2026-07-17', '2026-07-18', null, 'required',
  'locked_until_first_attempt', '家长保管答案至首做完成',
  '学校平台提交', array['函数单调性']
) as homework_id \gset
reset role;

select id as task_id from public.homework_tasks where homework_id = :'homework_id' \gset
select id as knowledge_node_id from public.knowledge_nodes where student_id = :'student_record_id' and knowledge_key = '函数单调性' \gset
select id as checkpoint_id from public.submission_checkpoints where homework_id = :'homework_id' \gset

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select public.record_student_task_event(:'task_id', 'started', array[]::text[], 1, 'aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.assert_true((select stage = 'in_progress' and version = 2 from public.task_workflow_current where task_id = :'task_id'), 'start should enter in_progress');
select public.record_student_task_event(:'task_id', 'paused', array['3','8','3'], 2, 'aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.assert_true((select stage = 'in_progress' and version = 3 from public.task_workflow_current where task_id = :'task_id'), 'pause should preserve in_progress workflow');
select public.record_student_task_event(:'task_id', 'started', array['3','8'], 3, 'aaaaaaaa-0000-4000-8000-000000000003');
select public.record_student_task_event(:'task_id', 'completed', array['3','8'], 4, 'aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.assert_true((select stage = 'awaiting_review' and version = 5 from public.task_workflow_current where task_id = :'task_id'), 'completion should await review');
select public.record_student_task_event(:'task_id', 'completed', array['3','8'], 4, 'aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.assert_true((select count(*) = 1 from public.study_session_events where idempotency_key = 'aaaaaaaa-0000-4000-8000-000000000004'), 'student completion must be idempotent');
reset role;

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select pg_temp.expect_error(
  format('select public.save_task_review(%L::uuid, ''70-89'', array[''3''], array[''概念''], true, true, '''', 5, ''bbbbbbbb-0000-4000-8000-000000000001''::uuid)', :'task_id'),
  'subject tutor access required'
);
reset role;

select set_config('request.jwt.claim.sub', :'physics_tutor_id', false);
set role authenticated;
select pg_temp.expect_error(
  format('select public.move_homework_blocks(%L::uuid, ''2026-07-18''::date, ''跨科尝试'', 1, false, ''cccccccc-0000-4000-8000-000000000001''::uuid)', :'task_id'),
  'subject tutor access required'
);
reset role;

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select public.save_task_review(
  :'task_id', '70-89', array['3','8'], array['概念','计算'], true, true,
  '先订正，再独立复做', 5, 'dddddddd-0000-4000-8000-000000000001'
) as review_id \gset
select pg_temp.assert_true((select stage = 'awaiting_correction' and version = 6 from public.task_workflow_current where task_id = :'task_id'), 'review with errors should await correction');
select public.record_correction_attempt(:'task_id', false, false, '第3题仍错', 6, 'dddddddd-0000-4000-8000-000000000002');
select pg_temp.assert_true((select stage = 'awaiting_correction' and version = 7 from public.task_workflow_current where task_id = :'task_id'), 'failed correction should remain pending');
select public.record_correction_attempt(:'task_id', true, false, '订正通过，待复做', 7, 'dddddddd-0000-4000-8000-000000000003');
select pg_temp.assert_true((select stage = 'awaiting_redo' and version = 8 from public.task_workflow_current where task_id = :'task_id'), 'passed correction should await required redo');
select public.record_correction_attempt(:'task_id', true, true, '独立复做通过', 8, 'dddddddd-0000-4000-8000-000000000004');
select pg_temp.assert_true((select stage = 'awaiting_acceptance' and version = 9 from public.task_workflow_current where task_id = :'task_id'), 'redo pass should await mastery');
select public.confirm_knowledge_mastery(
  :'task_id', :'knowledge_node_id', 'mastered', '', 9,
  'dddddddd-0000-4000-8000-000000000005'
) as evidence_id \gset
select pg_temp.assert_true((select stage = 'awaiting_acceptance' and version = 10 from public.task_workflow_current where task_id = :'task_id'), 'required submission must keep workflow open');
select pg_temp.assert_true((select current_level = 'mastered' from public.mastery_snapshots where knowledge_node_id = :'knowledge_node_id'), 'mastery evidence should light the knowledge node');
select public.confirm_submission_checkpoint(:'checkpoint_id', '', 1, 'dddddddd-0000-4000-8000-000000000006');
select pg_temp.assert_true((select stage = 'closed_loop' and version = 11 from public.task_workflow_current where task_id = :'task_id'), 'all gates should close the loop');
select public.confirm_submission_checkpoint(:'checkpoint_id', '', 1, 'dddddddd-0000-4000-8000-000000000006');
select pg_temp.assert_true((select count(*) = 1 from public.submission_confirmations where idempotency_key = 'dddddddd-0000-4000-8000-000000000006'), 'submission confirmation must be idempotent');
select public.revoke_submission_checkpoint(:'checkpoint_id', '误点提交', 2, 'dddddddd-0000-4000-8000-000000000007');
select pg_temp.assert_true((select stage = 'awaiting_acceptance' and version = 12 from public.task_workflow_current where task_id = :'task_id'), 'revoked submission must reopen only submission gate');
select pg_temp.assert_true((select current_level = 'mastered' from public.mastery_snapshots where knowledge_node_id = :'knowledge_node_id'), 'submission revoke must not change mastery');
select public.confirm_submission_checkpoint(:'checkpoint_id', '重新核对', 3, 'dddddddd-0000-4000-8000-000000000008');
select public.reopen_task_workflow(:'task_id', '发现新错误，需要重做', 13, 'dddddddd-0000-4000-8000-000000000009');
select pg_temp.assert_true((select stage = 'ready' and version = 14 from public.task_workflow_current where task_id = :'task_id'), 'reopen should create a fresh ready cycle');
select pg_temp.assert_true((select current_level = 'reinforce' and highest_level = 'basic' from public.mastery_snapshots where knowledge_node_id = :'knowledge_node_id'), 'reopen evidence should roll current mastery back while retaining valid history');
reset role;

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.create_manual_homework(
  :'student_record_id', 'math', '计划块操作测试', '用于移动拆分合并测试',
  '2026-07-17', null, null, 'required', 'locked_until_first_attempt', '', '', array['计划能力']
) as plan_homework_id \gset
reset role;
select id as plan_task_id from public.homework_tasks where homework_id = :'plan_homework_id' \gset

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select public.move_homework_blocks(:'plan_task_id', '2026-07-18', '与课程冲突', 1, false, 'eeeeeeee-0000-4000-8000-000000000001');
select public.split_homework_block(:'plan_task_id', 45, '2026-07-19', '拆成两次完成', 2, 'eeeeeeee-0000-4000-8000-000000000002') as second_task_id \gset
select pg_temp.assert_true((select block_minutes = 45 and version = 3 from public.homework_tasks where id = :'plan_task_id'), 'split should preserve first half');
select public.merge_homework_blocks(:'plan_task_id', :'second_task_id', 3, 1, '恢复为一个任务块', 'eeeeeeee-0000-4000-8000-000000000003');
select pg_temp.assert_true((select block_minutes = 90 and version = 4 from public.homework_tasks where id = :'plan_task_id'), 'merge should restore duration');
reset role;
select pg_temp.assert_true((select deleted_at is not null from public.homework_tasks where id = :'second_task_id'), 'merged-away block must be soft deleted');

select set_config('request.jwt.claim.sub', :'physics_tutor_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.homeworks), 'other-subject tutor must not see math homeworks');
reset role;

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 2 from public.homeworks), 'student should see own homeworks');
select pg_temp.expect_error('insert into public.task_review_records default values', 'permission denied');
reset role;

select pg_temp.assert_true((select count(*) >= 1 from public.notifications where recipient_id = :'parent_id'), 'plan and submission changes should notify parent inside the system');
select pg_temp.assert_true((select count(*) >= 1 from public.notifications where recipient_id = :'math_tutor_id'), 'student completion should notify the subject tutor');

select 'WORKFLOW_INTEGRATION_OK' as result;
