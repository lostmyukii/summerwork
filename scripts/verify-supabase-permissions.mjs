import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key] || /your-|example|placeholder|填写/i.test(process.env[key]));

if (missingEnvironment.length > 0) {
  console.error(`缺少环境变量：${missingEnvironment.join("、")}。请先填写 .env.local。`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const createdUserIds = [];
const checks = [];
let familyId = null;
const catalogId = "summer-2026-family-tutoring";

function pass(label) {
  checks.push(label);
  console.log(`✓ ${label}`);
}

function assert(condition, label, details = "") {
  if (!condition) throw new Error(`${label}${details ? `：${details}` : ""}`);
  pass(label);
}

function requireData(result, label) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

function makeUserClient() {
  return createClient(url, anonKey, clientOptions);
}

async function createTestAccount(role, runId) {
  const email = `summerwork-${runId}-${role}@example.com`;
  const password = `Sw!${randomBytes(18).toString("base64url")}`;
  const result = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `权限验收-${role}` },
  });
  const user = requireData(result, `创建${role}测试账号`).user;
  createdUserIds.push(user.id);

  const client = makeUserClient();
  const signedIn = requireData(
    await client.auth.signInWithPassword({ email, password }),
    `${role}真实密码登录`,
  );
  assert(signedIn.user?.id === user.id, `${role}真实密码登录`);
  return { client, email, id: user.id };
}

async function createInvitation(parent, studentId, account, role, subjectId = null) {
  const rows = requireData(
    await parent.client.rpc("create_account_invitation", {
      target_email: account.email,
      target_role: role,
      target_student_id: studentId,
      target_subject_id: subjectId,
      valid_hours: 1,
    }),
    `创建${role === "student" ? "孩子" : subjectId}邀请`,
  );
  const token = rows?.[0]?.raw_token;
  if (typeof token !== "string" || token.length < 32) throw new Error(`创建${role}邀请：数据库未返回有效的一次性令牌`);
  return token;
}

async function acceptInvitation(account, token, label) {
  const acceptedFamilyId = requireData(
    await account.client.rpc("accept_invitation", { raw_token: token }),
    label,
  );
  assert(acceptedFamilyId === familyId, label);
}

async function queryAssignmentSubjects(account, studentId) {
  const rows = requireData(
    await account.client
      .from("tutor_assignments")
      .select("subject_id")
      .eq("student_id", studentId)
      .order("subject_id"),
    "读取家教授权范围",
  );
  return rows.map((row) => row.subject_id);
}

async function isSubjectTutor(account, studentId, subjectId) {
  return requireData(
    await account.client.rpc("is_subject_tutor", {
      target_student_id: studentId,
      target_subject_id: subjectId,
    }),
    "读取分科权限",
  );
}

async function cleanup() {
  if (familyId) {
    const { error } = await admin.rpc("purge_verification_family", { target_family_id: familyId });
    if (error) console.error(`清理测试家庭失败：${error.message}`);
    else familyId = null;
  }

  const bootstrapCleanup = await admin.from("platform_bootstrap").delete().eq("singleton", true);
  if (bootstrapCleanup.error) console.error(`清理测试启动配置失败：${bootstrapCleanup.error.message}`);

  for (const userId of [...createdUserIds].reverse()) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`清理测试账号失败：${error.message}`);
  }
}

async function purgeSyntheticResidue() {
  const families = requireData(
    await admin.from("family_spaces").select("id,name").like("name", "权限验收-%"),
    "扫描历史合成家庭",
  );
  for (const family of families) {
    requireData(
      await admin.rpc("purge_verification_family", { target_family_id: family.id }),
      "清理历史合成家庭",
    );
  }

  requireData(
    await admin.from("platform_bootstrap").delete().like("parent_email", "summerwork-%@example.com"),
    "清理历史合成启动配置",
  );

  const listed = requireData(
    await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    "扫描历史合成账号",
  );
  const syntheticUsers = listed.users.filter((user) => /^summerwork-.*@example\.com$/i.test(user.email ?? ""));
  for (const user of syntheticUsers) {
    requireData(await admin.auth.admin.deleteUser(user.id), "清理历史合成账号");
  }
}

async function main() {
  await purgeSyntheticResidue();
  const schemaProbe = await admin.from("subjects").select("id").in("id", ["math", "physics"]);
  if (schemaProbe.error || schemaProbe.data?.length !== 2) {
    throw new Error("数据库迁移尚未就绪。请先运行 npm run supabase:push。");
  }
  const templateProbe = await admin.from("homework_task_templates").select("id", { count: "exact", head: true }).eq("catalog_id", catalogId);
  if (templateProbe.error || templateProbe.count !== 200) {
    throw new Error("暑期计划模板尚未同步。请先运行 npm run supabase:sync-plan。");
  }

  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const parent = await createTestAccount("parent", runId);
  const mathTutor = await createTestAccount("math-tutor", runId);
  const physicsTutor = await createTestAccount("physics-tutor", runId);
  const studentAccount = await createTestAccount("student", runId);

  requireData(
    await admin.from("platform_bootstrap").upsert({ singleton: true, parent_email: parent.email }),
    "配置唯一合成家长启动邮箱",
  );
  pass("仅服务端配置唯一合成家长启动邮箱");

  familyId = requireData(
    await parent.client.rpc("create_family_space", { family_name: `权限验收-${runId}` }),
    "家长创建家庭空间",
  );
  pass("家长创建家庭空间");

  const student = requireData(
    await parent.client
      .from("students")
      .insert({
        family_id: familyId,
        display_name: "权限验收孩子",
        grade: "高一",
        school_year: "2026-2027",
        created_by: parent.id,
      })
      .select("id")
      .single(),
    "家长创建孩子档案",
  );
  pass("家长创建孩子档案");

  const insertedTasks = requireData(
    await parent.client.rpc("create_student_plan", { target_student_id: student.id, target_catalog_id: catalogId }),
    "家长实例化暑期计划",
  );
  assert(insertedTasks === 200, "家长为孩子实例化200条真实任务");
  const homeworkRows = requireData(await parent.client.from("homeworks").select("id").eq("student_id", student.id), "读取作业本体");
  assert(homeworkRows.length === 173, "200个执行块归属173项作业本体");

  const mathToken = await createInvitation(parent, student.id, mathTutor, "tutor", "math");
  const physicsToken = await createInvitation(parent, student.id, physicsTutor, "tutor", "physics");
  const studentToken = await createInvitation(parent, student.id, studentAccount, "student");

  const mismatch = await physicsTutor.client.rpc("accept_invitation", { raw_token: mathToken });
  assert(Boolean(mismatch.error), "邀请邮箱不匹配时拒绝");

  await acceptInvitation(mathTutor, mathToken, "数学家教接受一次性邀请");
  await acceptInvitation(physicsTutor, physicsToken, "物理家教接受一次性邀请");
  await acceptInvitation(studentAccount, studentToken, "孩子接受一次性邀请");

  const reused = await mathTutor.client.rpc("accept_invitation", { raw_token: mathToken });
  assert(Boolean(reused.error), "一次性邀请重复使用时拒绝");

  const mathSubjects = await queryAssignmentSubjects(mathTutor, student.id);
  assert(mathSubjects.length === 1 && mathSubjects[0] === "math", "数学家教只能看到数学授权");
  assert(
    (await isSubjectTutor(mathTutor, student.id, "math")) === true
      && (await isSubjectTutor(mathTutor, student.id, "physics")) === false,
    "数学家教不能获得物理权限",
  );

  const physicsSubjects = await queryAssignmentSubjects(physicsTutor, student.id);
  assert(physicsSubjects.length === 1 && physicsSubjects[0] === "physics", "物理家教只能看到物理授权");

  const mathTasks = requireData(
    await mathTutor.client.from("homework_tasks").select("id,subject_id,planned_date,version").eq("student_id", student.id).order("planned_date"),
    "数学家教读取本科任务",
  );
  assert(mathTasks.length === 30 && mathTasks.every((task) => task.subject_id === "math"), "数学家教只能读取30条数学任务");

  const physicsTasks = requireData(
    await physicsTutor.client.from("homework_tasks").select("id,subject_id").eq("student_id", student.id),
    "物理家教读取本科任务",
  );
  assert(physicsTasks.length === 42 && physicsTasks.every((task) => task.subject_id === "physics"), "物理家教只能读取42条物理任务");

  const movedDate = new Date(`${mathTasks[0].planned_date}T00:00:00Z`);
  movedDate.setUTCDate(movedDate.getUTCDate() + 1);
  const movedDateKey = movedDate.toISOString().slice(0, 10);
  requireData(
    await mathTutor.client.rpc("move_homework_blocks", {
      target_task_id: mathTasks[0].id,
      target_date: movedDateKey,
      change_reason: "权限验收",
      expected_version: mathTasks[0].version,
      move_following: false,
      target_idempotency_key: randomUUID(),
    }),
    "数学家教调整本科计划",
  );
  pass("数学家教可调整本科计划并自动留痕");

  const crossSubjectMove = await physicsTutor.client.rpc("move_homework_blocks", {
    target_task_id: mathTasks[0].id,
    target_date: mathTasks[0].planned_date,
    change_reason: "跨科权限验收",
    expected_version: mathTasks[0].version + 1,
    move_following: false,
    target_idempotency_key: randomUUID(),
  });
  assert(Boolean(crossSubjectMove.error), "物理家教不能调整数学计划");

  const studentRows = requireData(
    await studentAccount.client.from("students").select("id").eq("id", student.id),
    "孩子读取本人档案",
  );
  assert(studentRows.length === 1, "孩子可查看本人档案");
  const studentTasks = requireData(
    await studentAccount.client.from("homework_tasks").select("id,subject_id").eq("student_id", student.id),
    "孩子读取本人全部任务",
  );
  assert(studentTasks.length === 200, "孩子可查看本人六科200条任务");

  requireData(await studentAccount.client.rpc("record_student_task_event", {
    target_task_id: mathTasks[0].id,
    target_event: "started",
    target_unknown_numbers: ["7", "12(2)"],
    expected_version: 1,
    target_idempotency_key: randomUUID(),
  }), "孩子开始任务");
  requireData(await studentAccount.client.rpc("record_student_task_event", {
    target_task_id: mathTasks[0].id,
    target_event: "completed",
    target_unknown_numbers: ["7", "12(2)"],
    expected_version: 2,
    target_idempotency_key: randomUUID(),
  }), "孩子完成任务");
  pass("孩子只能写本人任务活动");

  requireData(await mathTutor.client.rpc("save_task_review", {
    target_task_id: mathTasks[0].id,
    target_accuracy_band: "100",
    target_wrong_numbers: [],
    target_error_tags: [],
    target_correction_required: false,
    target_redo_required: false,
    target_note: "权限验收",
    expected_version: 3,
    target_idempotency_key: randomUUID(),
  }), "数学家教确认本科批改");
  pass("数学家教可写入本科批改记录");

  const crossSubjectReview = await physicsTutor.client.rpc("save_task_review", {
    target_task_id: mathTasks[0].id,
    target_accuracy_band: "100",
    target_wrong_numbers: [],
    target_error_tags: [],
    target_correction_required: false,
    target_redo_required: false,
    target_note: "跨科权限验收",
    expected_version: 4,
    target_idempotency_key: randomUUID(),
  });
  assert(Boolean(crossSubjectReview.error), "物理家教不能批改数学任务");

  const studentReview = await studentAccount.client.rpc("save_task_review", {
    target_task_id: mathTasks[1].id,
    target_accuracy_band: "100",
    target_wrong_numbers: [],
    target_error_tags: [],
    target_correction_required: false,
    target_redo_required: false,
    target_note: "越权尝试",
    expected_version: 1,
    target_idempotency_key: randomUUID(),
  });
  assert(Boolean(studentReview.error), "孩子不能写批改或提交确认");

  const tutorActivity = await physicsTutor.client.rpc("record_student_task_event", {
    target_task_id: physicsTasks[0].id,
    target_event: "started",
    target_unknown_numbers: [],
    expected_version: 1,
    target_idempotency_key: randomUUID(),
  });
  assert(Boolean(tutorActivity.error), "家教不能代替孩子标记完成");
  assert(
    (await queryAssignmentSubjects(studentAccount, student.id)).length === 0,
    "孩子不能读取家教授权表",
  );

  const mathAssignment = requireData(
    await parent.client.from("tutor_assignments").select("id").eq("student_id", student.id).eq("subject_id", "math").single(),
    "读取数学家教授权",
  );
  requireData(await parent.client.rpc("revoke_tutor_access", {
    target_assignment_id: mathAssignment.id,
    revoke_reason: "真实权限撤销验收",
    target_idempotency_key: randomUUID(),
  }), "撤销数学家教科目授权");

  const revokedStudentRows = requireData(
    await mathTutor.client.from("students").select("id").eq("id", student.id),
    "撤销后检查孩子访问权限",
  );
  assert(
    revokedStudentRows.length === 0
      && (await queryAssignmentSubjects(mathTutor, student.id)).length === 0
      && (await isSubjectTutor(mathTutor, student.id, "math")) === false,
    "家教撤销后当前登录会话立即失权",
  );

  console.log(`\nSupabase 权限验收通过，共 ${checks.length} 项；测试数据将自动清理。`);
}

try {
  await main();
} catch (error) {
  console.error(`\nSupabase 权限验收失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
