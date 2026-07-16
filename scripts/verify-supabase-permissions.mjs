import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

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

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
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
  const rawToken = randomBytes(32).toString("base64url");
  requireData(
    await parent.client.from("invitations").insert({
      family_id: familyId,
      email: account.email,
      role,
      student_id: studentId,
      subject_id: subjectId,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      created_by: parent.id,
    }),
    `创建${role === "student" ? "孩子" : subjectId}邀请`,
  );
  return rawToken;
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
    const { error } = await admin.from("family_spaces").delete().eq("id", familyId);
    if (error) console.error(`清理测试家庭失败：${error.message}`);
  }

  for (const userId of [...createdUserIds].reverse()) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`清理测试账号失败：${error.message}`);
  }
}

async function main() {
  const schemaProbe = await admin.from("subjects").select("id").in("id", ["math", "physics"]);
  if (schemaProbe.error || schemaProbe.data?.length !== 2) {
    throw new Error("数据库迁移尚未就绪。请先运行 npm run supabase:push。");
  }

  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const parent = await createTestAccount("parent", runId);
  const mathTutor = await createTestAccount("math-tutor", runId);
  const physicsTutor = await createTestAccount("physics-tutor", runId);
  const studentAccount = await createTestAccount("student", runId);

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

  const studentRows = requireData(
    await studentAccount.client.from("students").select("id").eq("id", student.id),
    "孩子读取本人档案",
  );
  assert(studentRows.length === 1, "孩子可查看本人档案");
  assert(
    (await queryAssignmentSubjects(studentAccount, student.id)).length === 0,
    "孩子不能读取家教授权表",
  );

  const revokedAt = new Date().toISOString();
  requireData(
    await parent.client
      .from("tutor_assignments")
      .update({ ends_at: revokedAt })
      .eq("student_id", student.id)
      .eq("subject_id", "math"),
    "撤销数学家教科目授权",
  );
  requireData(
    await parent.client
      .from("family_memberships")
      .update({ removed_at: revokedAt })
      .eq("family_id", familyId)
      .eq("user_id", mathTutor.id),
    "移除数学家教家庭成员关系",
  );

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
