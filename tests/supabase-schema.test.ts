import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/0003_homework_closed_loop.sql", import.meta.url), "utf8");
const invitationMigration = readFileSync(new URL("../supabase/migrations/0004_parent_invitation_rpc.sql", import.meta.url), "utf8");
const identityMigration = readFileSync(new URL("../supabase/migrations/0001_identity_and_rls.sql", import.meta.url), "utf8");
const bootstrapMigration = readFileSync(new URL("../supabase/migrations/0017_single_family_bootstrap.sql", import.meta.url), "utf8");
const selfHostedMigration = readFileSync(new URL("../supabase/migrations/0018_self_hosted_crypto_and_verification_cleanup.sql", import.meta.url), "utf8");
const travelRecoveryMigration = readFileSync(new URL("../supabase/migrations/0020_travel_recovery_schedule.sql", import.meta.url), "utf8");
const syncScript = readFileSync(new URL("../scripts/sync-summer-plan.mjs", import.meta.url), "utf8");

describe("Supabase 作业闭环结构与分科权限", () => {
  it("把孩子活动、家教批改、计划变更和知识掌握分表保存", () => {
    for (const table of [
      "homework_tasks",
      "student_task_activity",
      "task_reviews",
      "task_plan_changes",
      "knowledge_mastery",
    ]) expect(migration).toContain(`public.${table}`);
  });

  it("任务读取按家长、本人或本科家教授权判断", () => {
    expect(migration).toMatch(/create or replace function public\.can_access_task[\s\S]*public\.is_family_parent\(family_id\)[\s\S]*public\.is_student_owner\(student_id\)[\s\S]*public\.is_subject_tutor\(student_id, subject_id\)/);
    expect(migration).toMatch(/homework_tasks_select_authorized[\s\S]*public\.can_access_task\(id\)/);
  });

  it("孩子不能写批改，家教不能直接伪造孩子完成", () => {
    expect(migration).toMatch(/task_activity_insert_student[\s\S]*public\.is_student_owner\(student_id\)/);
    expect(migration).toMatch(/task_reviews_insert_subject_tutor[\s\S]*public\.can_manage_task_subject\(task_id\)/);
    expect(migration).not.toMatch(/task_reviews_insert_student/);
  });

  it("计划移动只能走留痕函数", () => {
    expect(migration).toMatch(/create or replace function public\.move_homework_task/);
    expect(migration).toMatch(/insert into public\.task_plan_changes\(task_id, old_date, new_date, reason, changed_by\)/);
    expect(migration).not.toMatch(/task_plan_changes_insert/);
  });

  it("同步脚本覆盖六科并按当前计划复核远端模板", () => {
    for (const id of ["chinese", "math", "russian", "physics", "chemistry", "biology"]) expect(syncScript).toContain(`"${id}"`);
    expect(syncScript).toMatch(/rows\.length !== templates\.length/);
    expect(syncScript).toContain("homework_task_templates");
  });

  it("家长邀请由数据库生成一次性令牌且只保存哈希", () => {
    expect(invitationMigration).toMatch(/public\.is_family_parent\(target_family_id\)/);
    expect(invitationMigration).toMatch(/generated_token := encode\(gen_random_bytes\(32\), 'hex'\)/);
    expect(invitationMigration).toMatch(/encode\(digest\(generated_token, 'sha256'\), 'hex'\)/);
    expect(invitationMigration).toMatch(/target_role = 'tutor' and target_subject_id is null/);
  });

  it("认证账号获得必要RPC执行权，匿名用户仍无权调用", () => {
    for (const signature of [
      "create_family_space(text)",
      "accept_invitation(text)",
      "is_subject_tutor(uuid, text)",
    ]) {
      expect(identityMigration).toContain(`revoke all on function public.${signature} from public`);
      expect(identityMigration).toContain(`grant execute on function public.${signature} to authenticated`);
    }
  });

  it("私有部署只允许服务端配置的家长邮箱认领唯一家庭", () => {
    expect(bootstrapMigration).toContain("public.platform_bootstrap");
    expect(bootstrapMigration).toMatch(/revoke all on table public\.platform_bootstrap from anon, authenticated/);
    expect(bootstrapMigration).toMatch(/current_email <> bootstrap_row\.parent_email/);
    expect(bootstrapMigration).toMatch(/platform already initialized/);
    expect(bootstrapMigration).toMatch(/for update/);
  });

  it("自建数据库显式使用 extensions 加密函数且合成清理仅向服务角色开放", () => {
    expect(selfHostedMigration).toContain("extensions.gen_random_bytes(32)");
    expect(selfHostedMigration).toContain("extensions.digest(raw_token, 'sha256')");
    expect(selfHostedMigration).toContain("extensions.digest(generated_token, 'sha256')");
    expect(selfHostedMigration).toContain("extensions.digest(archive_payload::text, 'sha256')");
    expect(selfHostedMigration).toMatch(/target_name not like '权限验收-%'/);
    expect(selfHostedMigration).toMatch(/revoke all on function public\.purge_verification_family\(uuid\) from public, anon, authenticated/);
    expect(selfHostedMigration).toMatch(/grant execute on function public\.purge_verification_family\(uuid\) to service_role/);
  });

  it("旅行补位独立保存原日期、用途、剩余量和释放状态", () => {
    expect(travelRecoveryMigration).toContain("public.task_travel_recovery_schedules");
    expect(travelRecoveryMigration).toContain("original_planned_date");
    expect(travelRecoveryMigration).toContain("original_purpose");
    expect(travelRecoveryMigration).toContain("current_purpose");
    expect(travelRecoveryMigration).toMatch(/task_travel_recovery_status[\s\S]*completed_minutes[\s\S]*remaining_minutes[\s\S]*recovery_state/);
    expect(travelRecoveryMigration).toMatch(/student_activity_release_travel_recovery[\s\S]*release_travel_recovery_on_completion/);
  });

  it("补位调整幂等、留痕且只能由本科家教执行", () => {
    expect(travelRecoveryMigration).toMatch(/set_travel_recovery_schedule[\s\S]*idempotency_key[\s\S]*is_task_tutor/);
    expect(travelRecoveryMigration).toContain("public.task_travel_recovery_events");
    expect(travelRecoveryMigration).toMatch(/old_purpose[\s\S]*new_purpose[\s\S]*reason[\s\S]*actor_id[\s\S]*occurred_at/);
    expect(travelRecoveryMigration).toMatch(/unique\(actor_id, idempotency_key\)/);
    expect(travelRecoveryMigration).not.toMatch(/travel_recovery_schedule_(insert|update)_authorized/);
  });

  it("旅行补位读取遵守任务权限且学生不能直接写计划", () => {
    expect(travelRecoveryMigration).toMatch(/travel_recovery_schedule_select_authorized[\s\S]*public\.can_access_task\(task_id\)/);
    expect(travelRecoveryMigration).toMatch(/revoke all on table public\.task_travel_recovery_schedules from public, anon, authenticated/);
    expect(travelRecoveryMigration).toMatch(/grant select on table public\.task_travel_recovery_schedules to authenticated/);
    expect(travelRecoveryMigration).toMatch(/grant execute on function public\.set_travel_recovery_schedule[\s\S]*to authenticated/);
  });
});
