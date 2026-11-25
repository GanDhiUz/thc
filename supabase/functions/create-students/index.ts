// 학생 명단으로 로그인 계정과 6자리 개인 코드를 만든다. 선생님만 부를 수 있다.
// 입력: { rows: [{ class_no, number, name }], reset: boolean }
// 출력: { results: [{ class_no, number, name, code?, status }] }  — 코드는 여기서 한 번만 돌려주고 어디에도 저장하지 않는다.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const email = (c: number, n: number) => `1-${c}-${String(n).padStart(2, "0")}@student.local`;
const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (user?.app_metadata?.role !== "teacher") return json({ error: "선생님 계정만 쓸 수 있습니다." }, 403);

  const { rows, reset } = await req.json().catch(() => ({}));
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 300) return json({ error: "명단이 비었거나 너무 깁니다." }, 400);

  const results = [];
  for (const r of rows) {
    const class_no = Number(r.class_no), number = Number(r.number), name = String(r.name ?? "").trim();
    if (!(class_no >= 1 && class_no <= 20 && number >= 1 && number <= 99 && name)) {
      results.push({ class_no: r.class_no, number: r.number, name, status: "형식 오류" });
      continue;
    }
    const code = newCode();
    const { data: existing } = await admin.from("students").select("id").eq("class_no", class_no).eq("number", number).maybeSingle();

    if (existing) {
      await admin.from("students").update({ name }).eq("id", existing.id);
      if (!reset) { results.push({ class_no, number, name, status: "이미 있음(코드 유지)" }); continue; }
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password: code });
      results.push(error ? { class_no, number, name, status: "실패: " + error.message } : { class_no, number, name, code, status: "코드 새로 발급" });
      continue;
    }

    const { data: created, error } = await admin.auth.admin.createUser({ email: email(class_no, number), password: code, email_confirm: true });
    if (error || !created.user) { results.push({ class_no, number, name, status: "실패: " + error?.message }); continue; }
    const { error: insErr } = await admin.from("students").insert({ id: created.user.id, class_no, number, name });
    if (insErr) {
      await admin.auth.admin.deleteUser(created.user.id); // 명단 행이 없으면 계정도 남기지 않는다
      results.push({ class_no, number, name, status: "실패: " + insErr.message });
      continue;
    }
    results.push({ class_no, number, name, code, status: "새로 만듦" });
  }
  return json({ results });
});
