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
\set import_student_id '66666666-6666-4666-8666-666666666666'
\set outsider_id '77777777-7777-4777-8777-777777777777'

insert into auth.users(id, email, raw_user_meta_data) values
  (:'parent_id', 'parent@example.test', '{"display_name":"家长"}'),
  (:'student_user_id', 'student@example.test', '{"display_name":"孩子"}'),
  (:'math_tutor_id', 'math@example.test', '{"display_name":"数学家教"}'),
  (:'physics_tutor_id', 'physics@example.test', '{"display_name":"物理家教"}'),
  (:'outsider_id', 'outsider@example.test', '{"display_name":"未受邀账号"}');

insert into public.platform_bootstrap(parent_email)
values('parent@example.test');

select set_config('request.jwt.claim.sub', :'outsider_id', false);
set role authenticated;
select pg_temp.expect_error(
  'select public.create_family_space(''越权家庭'')',
  'parent email not authorized'
);
select pg_temp.expect_error(
  'insert into public.platform_bootstrap(parent_email) values (''attacker@example.test'')',
  'permission denied'
);
reset role;

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.create_family_space('暑期闭环测试家庭') as family_id \gset
select pg_temp.assert_true(public.create_family_space('重复请求不得新建') = :'family_id', 'the authorized parent should safely receive the existing family on retry');
reset role;
select pg_temp.assert_true((select claimed_by = :'parent_id' and claimed_at is not null from public.platform_bootstrap where singleton), 'first family creation must atomically claim the configured bootstrap');

select set_config('request.jwt.claim.sub', :'outsider_id', false);
set role authenticated;
select pg_temp.expect_error(
  'select public.create_family_space(''第二家庭'')',
  'platform already initialized'
);
reset role;

insert into public.students(id, family_id, user_id, display_name, grade, school_year, created_by)
values(:'student_record_id', :'family_id', :'student_user_id', '测试孩子', '高一升高二', '2026', :'parent_id');
insert into public.students(id, family_id, display_name, grade, school_year, created_by)
values(:'import_student_id', :'family_id', '导入测试孩子', '高一升高二', '2026', :'parent_id');

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select raw_token as math_invite_token from public.create_account_invitation('math@example.test', 'tutor', :'student_record_id', 'math', 168) \gset
select raw_token as physics_invite_token from public.create_account_invitation('physics@example.test', 'tutor', :'student_record_id', 'physics', 168) \gset
select raw_token as student_invite_token from public.create_account_invitation('student@example.test', 'student', :'student_record_id', null, 168) \gset
reset role;

select set_config('request.jwt.claim.sub', :'physics_tutor_id', false);
set role authenticated;
select pg_temp.expect_error(format('select public.accept_invitation(%L)', :'math_invite_token'), 'invitation email mismatch');
select public.accept_invitation(:'physics_invite_token');
reset role;

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select public.accept_invitation(:'math_invite_token');
select pg_temp.expect_error(format('select public.accept_invitation(%L)', :'math_invite_token'), 'invitation invalid or expired');
reset role;

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select public.accept_invitation(:'student_invite_token');
reset role;

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
update public.family_spaces set daily_block_capacity = 3 where id = :'family_id';
reset role;
select pg_temp.assert_true((select daily_block_capacity = 3 from public.family_spaces where id = :'family_id'), 'parent should adjust the family independent-work capacity');
select set_config('request.jwt.claim.sub', :'physics_tutor_id', false);
set role authenticated;
update public.family_spaces set daily_block_capacity = 4 where id = :'family_id';
reset role;
select pg_temp.assert_true((select daily_block_capacity = 3 from public.family_spaces where id = :'family_id'), 'tutor must not change the family capacity');

insert into public.plan_catalogs(id, title, version, starts_on, ends_on)
values('integration-catalog', '作业与任务块分离测试', 1, '2026-07-16', '2026-08-29');
insert into public.homework_task_templates(
  id, catalog_id, homework_key, subject_id, planned_date, slot_type, source_slot_type,
  title, knowledge, knowledge_tags, answer_basis, submission_requirement, task_kind,
  requires_submission, answer_policy, requirement_level, source_reference
) values
  ('integration-block-1', 'integration-catalog', 'shared-homework', 'math', '2026-07-20', '自学', '自学', '同一作业上半', '函数', array['函数'], '首做后批改', '学校平台提交', 'practice', true, 'locked_until_first_attempt', 'required', 'fixture#1'),
  ('integration-block-2', 'integration-catalog', 'shared-homework', 'math', '2026-07-21', '自学', '自学', '同一作业下半', '向量', array['向量'], '首做后批改', '学校平台提交', 'practice', true, 'locked_until_first_attempt', 'required', 'fixture#2'),
  ('integration-block-3', 'integration-catalog', 'other-homework', 'math', '2026-07-22', '自学', '自学', '另一项作业', '概率', array['概率'], '首做后批改', '', 'practice', false, 'locked_until_first_attempt', 'required', 'fixture#3');

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select pg_temp.assert_true(public.create_student_plan(:'import_student_id', 'integration-catalog') = 3, 'three templates should create three plan blocks');
select pg_temp.assert_true((select count(*) = 2 from public.homeworks where student_id = :'import_student_id'), 'two templates with one homework key must count as one homework');
select pg_temp.assert_true((select bool_and(catalog_version = 1) from public.homeworks where student_id = :'import_student_id'), 'plan instances must retain the catalog version applied at creation');
reset role;
update public.plan_catalogs set version = 2, source_digest = 'integration-v2' where id = 'integration-catalog';
set role authenticated;
select pg_temp.assert_true((select update_available and applied_version = 1 and available_version = 2 from public.student_plan_version_status where student_id = :'import_student_id'), 'catalog updates must be visible without silently mutating existing family instances');
select pg_temp.assert_true((select count(distinct homework_id) = 1 and max(sequence_number) = 2 from public.homework_tasks where student_id = :'import_student_id' and template_id in ('integration-block-1', 'integration-block-2')), 'one homework should own multiple ordered blocks');
select pg_temp.assert_true((select count(*) = 1 from public.task_knowledge_links link join public.homework_tasks task on task.id = link.task_id where task.template_id = 'integration-block-1'), 'first block should only link its own knowledge scope');
select pg_temp.assert_true((select node.display_name = '向量' from public.task_knowledge_links link join public.homework_tasks task on task.id = link.task_id join public.knowledge_nodes node on node.id = link.knowledge_node_id where task.template_id = 'integration-block-2'), 'second block should keep a distinct knowledge scope');
select public.create_manual_homework(
  :'student_record_id', 'math', '函数综合测试', '独立完成并订正',
  '2026-07-17', '2026-07-18', null, 'required',
  'locked_until_first_attempt', '家长保管答案至首做完成',
  '学校平台提交', array['函数单调性']
) as homework_id \gset
select public.add_submission_checkpoint(
  :'homework_id', 'correction_return', '订正后回传', true,
  '2026-07-19', null, '99999999-0000-4000-8000-000000000001'
) as checkpoint_2_id \gset
select public.revise_homework(
  :'homework_id', 1, '函数综合测试（新版）', '独立完成、批改、订正并复做',
  '2026-07-18', null, '补充完整本体字段', 'required',
  'locked_until_first_attempt', '首做完成后由家教核对', '学校平台提交',
  array['函数单调性']
) as revised_version_id \gset
select pg_temp.assert_true((select version = 2 and current_version_id = :'revised_version_id' from public.homeworks where id = :'homework_id'), 'homework revision should create an authoritative second version');
select pg_temp.assert_true((select count(*) = 2 from public.homework_versions where homework_id = :'homework_id'), 'homework revision must retain the old immutable version');
select pg_temp.assert_true((select title = '函数综合测试（新版）' and homework_version_id = :'revised_version_id' from public.homework_tasks where homework_id = :'homework_id'), 'unstarted task should move to the new homework version');
select pg_temp.assert_true((select cardinality(evidence_required) = 5 from public.homework_tasks where homework_id = :'homework_id'), 'manual homework should receive the complete evidence requirement list');
select public.set_submission_checkpoint_archived(:'checkpoint_2_id', true, true, '暂时取消回传', 1, '99999999-0000-4000-8000-000000000002');
select pg_temp.assert_true((select archived_at is not null and not required from public.submission_checkpoints where id = :'checkpoint_2_id'), 'archived checkpoint must stop blocking the workflow');
select public.set_submission_checkpoint_archived(:'checkpoint_2_id', false, true, '学校恢复要求', 2, '99999999-0000-4000-8000-000000000003');
select pg_temp.assert_true((select archived_at is null and required and version = 3 from public.submission_checkpoints where id = :'checkpoint_2_id'), 'restored checkpoint must rejoin the required submission gate');
reset role;

select id as task_id from public.homework_tasks where homework_id = :'homework_id' \gset
select id as knowledge_node_id from public.knowledge_nodes where student_id = :'student_record_id' and knowledge_key = '函数单调性' \gset
select id as checkpoint_id from public.submission_checkpoints where homework_id = :'homework_id' and checkpoint_type = 'initial' \gset

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select pg_temp.assert_true(public.set_travel_recovery_schedule(
  :'task_id', '2026-07-30', '2026-08-13', 90,
  '旅行自主作业→返程补位', '建立旅行软任务', 0,
  '12121212-0000-4000-8000-000000000001'
) = 1, 'subject tutor should configure the initial travel recovery schedule');
select pg_temp.assert_true(public.set_travel_recovery_schedule(
  :'task_id', '2026-07-30', '2026-08-13', 90,
  '旅行自主作业→返程补位', '建立旅行软任务', 0,
  '12121212-0000-4000-8000-000000000001'
) = 1, 'travel recovery configuration must be idempotent');
select pg_temp.assert_true((select count(*) = 1 from public.task_travel_recovery_events where task_id = :'task_id'), 'idempotent retry must not duplicate recovery history');
select pg_temp.assert_true(public.set_travel_recovery_schedule(
  :'task_id', '2026-07-30', '2026-08-14', 90,
  '旅行自主作业→返程补位', '返程课程容量调整', 1,
  '12121212-0000-4000-8000-000000000002'
) = 2, 'subject tutor should reassign the fallback with optimistic locking');
select pg_temp.assert_true((select schedule.original_purpose = task.slot_type and schedule.fallback_date = '2026-08-14' and schedule.version = 2 from public.task_travel_recovery_schedules schedule join public.homework_tasks task on task.id = schedule.task_id where schedule.task_id = :'task_id'), 'reassignment must retain original purpose and advance the version');
reset role;

select set_config('request.jwt.claim.sub', :'physics_tutor_id', false);
set role authenticated;
select pg_temp.expect_error(
  format('select public.set_travel_recovery_schedule(%L::uuid, ''2026-07-30''::date, ''2026-08-15''::date, 90, ''跨科改动'', ''越权'', 2, ''12121212-0000-4000-8000-000000000003''::uuid)', :'task_id'),
  'subject tutor access required'
);
reset role;

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select pg_temp.expect_error(
  format('update public.task_travel_recovery_schedules set fallback_date = ''2026-08-20'' where task_id = %L::uuid', :'task_id'),
  'permission denied'
);
select public.record_student_task_event(:'task_id', 'started', array[]::text[], 1, 'aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.assert_true((select stage = 'in_progress' and version = 2 from public.task_workflow_current where task_id = :'task_id'), 'start should enter in_progress');
select public.record_student_task_event(:'task_id', 'paused', array['3','8','3'], 2, 'aaaaaaaa-0000-4000-8000-000000000002');
select pg_temp.assert_true((select stage = 'in_progress' and version = 3 from public.task_workflow_current where task_id = :'task_id'), 'pause should preserve in_progress workflow');
select public.record_student_task_event(:'task_id', 'started', array['3','8'], 3, 'aaaaaaaa-0000-4000-8000-000000000003');
select public.record_student_task_event(:'task_id', 'completed', array['3','8'], 4, 'aaaaaaaa-0000-4000-8000-000000000004');
select pg_temp.assert_true((select stage = 'awaiting_review' and version = 5 from public.task_workflow_current where task_id = :'task_id'), 'completion should await review');
select pg_temp.assert_true((select recovery_state = 'released' and remaining_minutes = 0 and released_at is not null from public.task_travel_recovery_status where task_id = :'task_id'), 'student completion should release the reserved fallback without duplicating the task');
select pg_temp.assert_true((select count(*) = 3 from public.task_travel_recovery_events where task_id = :'task_id'), 'configuration, reassignment and release must all remain auditable');
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
select public.confirm_submission_checkpoint(:'checkpoint_id', '', 2, 'dddddddd-0000-4000-8000-000000000006');
select pg_temp.assert_true((select stage = 'awaiting_acceptance' and version = 11 from public.task_workflow_current where task_id = :'task_id'), 'one of two required checkpoints must not close the loop');
select public.confirm_submission_checkpoint(:'checkpoint_2_id', '', 3, 'dddddddd-0000-4000-8000-000000000010');
select pg_temp.assert_true((select stage = 'closed_loop' and version = 12 from public.task_workflow_current where task_id = :'task_id'), 'all required checkpoints should close the loop');
select public.confirm_submission_checkpoint(:'checkpoint_id', '', 2, 'dddddddd-0000-4000-8000-000000000006');
select pg_temp.assert_true((select count(*) = 1 from public.submission_confirmations where idempotency_key = 'dddddddd-0000-4000-8000-000000000006'), 'submission confirmation must be idempotent');
select public.revoke_submission_checkpoint(:'checkpoint_id', '误点提交', 3, 'dddddddd-0000-4000-8000-000000000007');
select pg_temp.assert_true((select stage = 'awaiting_acceptance' and version = 13 from public.task_workflow_current where task_id = :'task_id'), 'revoked submission must reopen only submission gate');
select pg_temp.assert_true((select current_level = 'mastered' from public.mastery_snapshots where knowledge_node_id = :'knowledge_node_id'), 'submission revoke must not change mastery');
select public.confirm_submission_checkpoint(:'checkpoint_id', '重新核对', 4, 'dddddddd-0000-4000-8000-000000000008');
select public.reopen_task_workflow(:'task_id', '发现新错误，需要重做', 14, 'dddddddd-0000-4000-8000-000000000009');
select pg_temp.assert_true((select stage = 'ready' and version = 15 from public.task_workflow_current where task_id = :'task_id'), 'reopen should create a fresh ready cycle');
select pg_temp.assert_true((select current_level = 'reinforce' and highest_level = 'mastered' from public.mastery_snapshots where knowledge_node_id = :'knowledge_node_id'), 'reopen evidence should roll current mastery back while retaining the historical mastered level');
select pg_temp.assert_true((select preserve_for_highest from public.mastery_evidence_revocations where evidence_id = :'evidence_id'), 'workflow reopen should invalidate current evidence without erasing the legitimate high-water mark');
reset role;

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select public.record_student_task_event(:'task_id', 'unknown_updated', array['5','5','12(2)'], 15, 'aaaaaaaa-0000-4000-8000-000000000005');
select pg_temp.assert_true((select stage = 'ready' and version = 16 from public.task_workflow_current where task_id = :'task_id'), 'recording unknown numbers must preserve the ready workflow while advancing optimistic version');
select pg_temp.assert_true((select unknown_numbers = array['5','12(2)'] from public.student_task_activity where task_id = :'task_id'), 'unknown-number update must persist and deduplicate independently of start or completion');
reset role;

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.revise_homework(
  :'homework_id', 2, '函数综合测试（第三版）', '学校补充要求，但不得污染旧学习证据',
  '2026-07-20', null, '孩子开始后再次调整', 'required',
  'after_school_submission', '提交后开放新答案', '学校平台提交',
  array['函数单调性']
) as third_version_id \gset
select pg_temp.assert_true((select version = 3 and current_version_id = :'third_version_id' from public.homeworks where id = :'homework_id'), 'a later parent revision should become the current homework version');
select pg_temp.assert_true((select homework_version_id = :'revised_version_id' from public.homework_tasks where id = :'task_id'), 'a task with study history must remain linked to the version actually attempted');
select pg_temp.assert_true((select count(*) = 3 from public.homework_versions where homework_id = :'homework_id'), 'all immutable homework versions must remain available for evidence tracing');
reset role;

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.create_manual_homework(
  :'student_record_id', 'math', '计划块操作测试', '用于移动拆分合并测试',
  '2026-07-17', null, null, 'required', 'locked_until_first_attempt', '', '', array['计划能力']
) as plan_homework_id \gset
select id as plan_task_id from public.homework_tasks where homework_id = :'plan_homework_id' \gset
select public.set_homework_archived(:'plan_homework_id', true, '暂时取消计划', 1, '99999999-1000-4000-8000-000000000001');
reset role;
select pg_temp.assert_true((select deleted_at is not null from public.homework_tasks where id = :'plan_task_id'), 'archiving a homework should soft-delete its plan block');
select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.set_homework_archived(:'plan_homework_id', false, '恢复计划', 2, '99999999-1000-4000-8000-000000000002');
reset role;
select pg_temp.assert_true((select deleted_at is null and version = 3 from public.homework_tasks where id = :'plan_task_id'), 'restoring a homework should recover its plan block without losing history');

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select public.move_homework_blocks(:'plan_task_id', '2026-07-18', '与课程冲突', 3, false, 'eeeeeeee-0000-4000-8000-000000000001');
select public.split_homework_block(:'plan_task_id', 45, '2026-07-19', '拆成两次完成', 4, 'eeeeeeee-0000-4000-8000-000000000002') as second_task_id \gset
select pg_temp.assert_true((select block_minutes = 45 and version = 5 from public.homework_tasks where id = :'plan_task_id'), 'split should preserve first half');
select public.merge_homework_blocks(:'plan_task_id', :'second_task_id', 5, 1, '恢复为一个任务块', 'eeeeeeee-0000-4000-8000-000000000003');
select pg_temp.assert_true((select block_minutes = 90 and version = 6 from public.homework_tasks where id = :'plan_task_id'), 'merge should restore duration');
reset role;
select pg_temp.assert_true((select deleted_at is not null from public.homework_tasks where id = :'second_task_id'), 'merged-away block must be soft deleted');

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 1 from public.homework_tasks where id = :'second_task_id' and deleted_at is not null), 'assigned subject tutor should be able to discover a recoverable archived block');
reset role;

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.homework_tasks where id = :'second_task_id' and deleted_at is not null), 'student must not discover archived plan blocks');
reset role;

select set_config('request.jwt.claim.sub', :'physics_tutor_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.homework_tasks where id = :'second_task_id' and deleted_at is not null), 'other-subject tutor must not discover archived math blocks');
reset role;

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select public.restore_plan_block(:'second_task_id', '恢复误合并任务块', 2, 'eeeeeeee-0000-4000-8000-000000000004');
select pg_temp.assert_true((select deleted_at is null and version = 3 from public.homework_tasks where id = :'second_task_id'), 'tutor should restore a soft-deleted subject block');
reset role;

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select public.generate_weekly_report(:'student_record_id', '2026-07-13') as report_id \gset
select pg_temp.assert_true((select (metrics ->> 'planned_blocks')::integer >= 2 from public.weekly_reports where id = :'report_id'), 'weekly report should aggregate the real plan');
select pg_temp.assert_true((public.export_student_archive(:'student_record_id') ->> 'schema_version')::integer = 1, 'parent export should return a versioned archive');
select public.create_backup_snapshot(:'student_record_id', '集成测试备份') as backup_id \gset
select pg_temp.assert_true((select length(checksum) = 64 from public.backup_snapshots where id = :'backup_id'), 'backup should include a SHA-256 checksum');
reset role;

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

select count(*) as homework_count_before_prestudy from public.homework_tasks \gset
insert into public.prestudy_course_slots(
  family_id, student_id, subject_id, course_date, tutor_lane, source_reference
) values
  (:'family_id', :'student_record_id', 'math', '2026-07-19', '本科', 'integration'),
  (:'family_id', :'student_record_id', 'math', '2026-07-23', '本科', 'integration'),
  (:'family_id', :'student_record_id', 'math', '2026-08-12', '本科', 'integration'),
  (:'family_id', :'student_record_id', 'physics', '2026-07-21', '本科', 'integration');

insert into public.prestudy_lessons(
  id, source_key, source_digest, family_id, student_id, subject_id,
  assigned_tutor_user_id, original_date, planned_date, tutor_lane,
  module_code, lesson_code, title, input_0_25, analysis_25_55,
  practice_55_80, output_80_90, acceptance_criteria, created_by
) values
  ('14141414-0000-4000-8000-000000000001', 'integration-prestudy-math', 'digest-math',
   :'family_id', :'student_record_id', 'math', :'math_tutor_id', '2026-07-19', '2026-07-19', '本科',
   'M-LC', 'M01', '直线预习', '教材输入', '例题拆解', '最小自测', '输出卡', '能够说明斜率', :'parent_id'),
  ('14141414-0000-4000-8000-000000000002', 'integration-prestudy-physics', 'digest-physics',
   :'family_id', :'student_record_id', 'physics', :'physics_tutor_id', '2026-07-21', '2026-07-21', '本科',
   'P-CIRADV', 'P01', '电路预习', '教材输入', '例题拆解', '最小自测', '输出卡', '能够区分电压', :'parent_id');

insert into public.prestudy_knowledge_items(id, lesson_id, label, sort_order) values
  ('15151515-0000-4000-8000-000000000001', '14141414-0000-4000-8000-000000000001', '直线斜率', 0),
  ('15151515-0000-4000-8000-000000000002', '14141414-0000-4000-8000-000000000001', '直线方程', 1),
  ('15151515-0000-4000-8000-000000000003', '14141414-0000-4000-8000-000000000002', '闭合电路', 0);

select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 2 from public.prestudy_lessons), 'parent should read all student prestudy lessons');
select pg_temp.expect_error(
  'select public.mark_prestudy_led(''14141414-0000-4000-8000-000000000001''::uuid, 0, ''16161616-0000-4000-8000-000000000001''::uuid)',
  'subject tutor access required'
);
reset role;

select set_config('request.jwt.claim.sub', :'student_user_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 2 from public.prestudy_lessons), 'student should read all own prestudy lessons');
select pg_temp.expect_error(
  'update public.prestudy_lessons set title = ''伪造修改'' where id = ''14141414-0000-4000-8000-000000000001''::uuid',
  'permission denied'
);
select pg_temp.expect_error(
  'select public.mark_prestudy_led(''14141414-0000-4000-8000-000000000001''::uuid, 0, ''16161616-0000-4000-8000-000000000002''::uuid)',
  'subject tutor access required'
);
reset role;

select set_config('request.jwt.claim.sub', :'physics_tutor_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 1 from public.prestudy_lessons where subject_id = 'physics'), 'physics tutor should only read physics prestudy');
select pg_temp.expect_error(
  'select public.mark_prestudy_led(''14141414-0000-4000-8000-000000000001''::uuid, 0, ''16161616-0000-4000-8000-000000000003''::uuid)',
  'subject tutor access required'
);
select pg_temp.expect_error(
  'select public.validate_prestudy_lesson(''14141414-0000-4000-8000-000000000002''::uuid, 2, ''{}''::uuid[], ''{}''::text[], 1, ''16161616-0000-4000-8000-000000000004''::uuid)',
  'prestudy lesson must be led before validation'
);
reset role;

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 1 from public.prestudy_lessons where subject_id = 'math'), 'math tutor should only read math prestudy');
select pg_temp.assert_true(public.mark_prestudy_led(
  '14141414-0000-4000-8000-000000000001', 0,
  '16161616-0000-4000-8000-000000000005'
) = 1, 'math tutor should mark the lesson led');
select pg_temp.assert_true(public.mark_prestudy_led(
  '14141414-0000-4000-8000-000000000001', 0,
  '16161616-0000-4000-8000-000000000005'
) = 1, 'marking led should be idempotent');
select pg_temp.expect_error(
  'select public.validate_prestudy_lesson(''14141414-0000-4000-8000-000000000001''::uuid, -1, ''{}''::uuid[], ''{}''::text[], 1, ''16161616-0000-4000-8000-000000000006''::uuid)',
  'actual question count must be a non-negative integer'
);
select pg_temp.assert_true(public.validate_prestudy_lesson(
  '14141414-0000-4000-8000-000000000001', 4,
  array['15151515-0000-4000-8000-000000000001'::uuid], array['斜率不存在情形'],
  1, '16161616-0000-4000-8000-000000000007'
) = 2, 'validation should save actual question count and unmastered knowledge');
select pg_temp.assert_true((
  select prestudy_state = 'validated' and actual_question_count = 4 and execution_version = 2
  from public.prestudy_lesson_overview
  where id = '14141414-0000-4000-8000-000000000001'
), 'validated overview should keep execution facts separate from mastery');
select pg_temp.assert_true((
  select count(*) = 2 from public.prestudy_unmastered_items
  where lesson_id = '14141414-0000-4000-8000-000000000001'
), 'preset and custom unmastered knowledge should both be stored');
select pg_temp.expect_error(
  'select public.move_prestudy_lesson(''14141414-0000-4000-8000-000000000001''::uuid, ''2026-08-12''::date, ''错误移动'', 1, ''16161616-0000-4000-8000-000000000008''::uuid)',
  '2026-08-12 is a travel day without tutor lessons'
);
select pg_temp.assert_true(public.move_prestudy_lesson(
  '14141414-0000-4000-8000-000000000001', '2026-07-23', '调到下一次数学家教课', 1,
  '16161616-0000-4000-8000-000000000009'
) = 2, 'lesson movement should require a matching tutor course slot');
select pg_temp.expect_error(
  'select public.revoke_prestudy_state(''14141414-0000-4000-8000-000000000001''::uuid, ''validated'', '''', 2, ''16161616-0000-4000-8000-000000000010''::uuid)',
  'reason required'
);
select pg_temp.assert_true(public.revoke_prestudy_state(
  '14141414-0000-4000-8000-000000000001', 'validated', '复核后发现误点', 2,
  '16161616-0000-4000-8000-000000000011'
) = 3, 'validation revoke should reopen only the prestudy validation state');
reset role;

select pg_temp.assert_true((select count(*) = :'homework_count_before_prestudy'::integer from public.homework_tasks), 'prestudy commands must not change homework task count');
select pg_temp.assert_true((select count(*) >= 1 from public.notifications where recipient_id = :'parent_id' and entity_type = 'prestudy_lesson'), 'prestudy changes should notify parent only inside the system');
select pg_temp.assert_true((select count(*) = 4 from public.change_events where entity_id = '14141414-0000-4000-8000-000000000001'), 'led, validated, moved and revoked prestudy events should remain auditable');

select id as math_assignment_id from public.tutor_assignments
where student_id = :'student_record_id' and subject_id = 'math' and ends_at is null \gset
select set_config('request.jwt.claim.sub', :'parent_id', false);
set role authenticated;
select pg_temp.expect_error(
  format('update public.tutor_assignments set ends_at = now() where id = %L::uuid', :'math_assignment_id'),
  'permission denied'
);
select public.revoke_tutor_access(:'math_assignment_id', '家教安排变化', 'ffffffff-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*) = 1 from public.change_events where entity_id = :'math_assignment_id' and event_type = 'tutor_access_revoked' and reason = '家教安排变化'), 'permission revocation must be audited with its reason');
reset role;

select set_config('request.jwt.claim.sub', :'math_tutor_id', false);
set role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.homeworks), 'revoked tutor session must immediately lose homework access');
select pg_temp.assert_true(not public.is_subject_tutor(:'student_record_id', 'math'), 'revoked tutor must immediately lose subject authorization');
reset role;

set role service_role;
select pg_temp.expect_error(
  format('select public.purge_verification_family(%L::uuid)', :'family_id'),
  'only synthetic verification families can be purged'
);
reset role;
update public.family_spaces set name = '权限验收-本地集成' where id = :'family_id';
set role service_role;
select public.purge_verification_family(:'family_id');
reset role;
select pg_temp.assert_true((select count(*) = 0 from public.family_spaces where id = :'family_id'), 'synthetic verification family cleanup must remove the family');
select pg_temp.assert_true((select count(*) = 0 from public.homeworks), 'synthetic verification cleanup must remove homework bodies');
select pg_temp.assert_true((select count(*) = 0 from public.knowledge_nodes), 'synthetic verification cleanup must remove linked knowledge nodes');

select 'WORKFLOW_INTEGRATION_OK' as result;
