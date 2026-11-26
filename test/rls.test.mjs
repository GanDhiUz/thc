// schema.sql 을 Supabase 비슷한 빈 Postgres 에 올리고 권한 규칙을 확인한다
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create schema storage; create table storage.buckets(id text primary key, name text, public bool);
create table storage.objects(id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
`);
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
await db.exec(schema);
await db.exec(schema); // 두 번 실행해도 안전해야 한다
await db.exec(`
grant usage on schema public, auth, storage to authenticated;
grant all on all tables in schema public, storage to authenticated;
grant all on all sequences in schema public, storage to authenticated;
grant execute on all functions in schema public, auth to authenticated;
`);

const T = "00000000-0000-0000-0000-00000000000t".replace("t", "1"), A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000b2";
await db.exec(`insert into auth.users values ('${T}'),('${A}'),('${B}');
insert into public.students values ('${A}',1,7,'가짜학생'),('${B}',2,3,'테스트학생');
insert into public.lessons (ord,title) values (1,'1차시');`);

async function as(sub, teacher, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify({ sub, role: "authenticated", app_metadata: teacher ? { role: "teacher" } : {} })}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql)).rows, affected: (await db.query("select 1")).rows && undefined }; }
  catch (e) { return { error: e.message }; }
}
const rows = async (...a) => (await as(...a)).rows;
const fails = async (...a) => assert.ok((await as(...a)).error, "실패해야 함: " + a[2]);

// 학생 A
assert.equal((await rows(A, false, "select * from students")).length, 1, "학생은 자기 행만");
assert.deepEqual((await rows(A, false, "select class_no from room_state")).map((r) => r.class_no), [1], "자기 반 상태만");
await as(A, false, "insert into summaries(student_id,lesson_id,body) values ('" + A + "',1,'첫 요약')");
const up = await as(A, false, "insert into summaries(student_id,lesson_id,body) values ('" + A + "',1,'고친 요약') on conflict (student_id,lesson_id) do update set body=excluded.body, submitted_at=now() returning body");
assert.equal(up.rows?.[0]?.body, "고친 요약", "다시 내면 덮어쓰기: " + up.error);
await fails(A, false, "insert into summaries(student_id,lesson_id,body) values ('" + B + "',1,'남의 요약')");
await fails(A, false, "insert into lessons(title) values ('x')");
await fails(A, false, "insert into room_state(class_no) values (9)");
assert.equal((await rows(A, false, "update room_state set locked=true returning *")).length, 0, "학생은 고정 못 바꿈");
await fails(A, false, "update summaries set student_id='" + B + "'");
await fails(A, false, "insert into storage.objects(bucket_id,name) values ('materials','x.pdf')");
assert.equal((await rows(A, false, "delete from summaries returning *")).length, 0, "학생은 요약 못 지움");

// 학생 B
assert.equal((await rows(B, false, "select * from summaries")).length, 0, "남의 요약 못 봄");
assert.equal((await rows(B, false, "select * from students")).length, 1);

// 로그인 안 한 사람(anon) 은 아무것도 못 봄
await db.exec("reset role; select set_config('request.jwt.claims','',false); set role anon;");
await assert.rejects(db.query("select * from students"));

// 선생님
assert.equal((await rows(T, true, "select * from students")).length, 2, "선생님은 전체");
assert.equal((await rows(T, true, "select * from summaries")).length, 1);
assert.equal((await rows(T, true, "update room_state set locked=true, page=3 where class_no=1 returning *")).length, 1);
assert.equal((await rows(A, false, "select locked, page from room_state"))[0].page, 3, "학생이 바뀐 상태를 읽음");
assert.ok(!(await as(T, true, "insert into storage.objects(bucket_id,name) values ('materials','lesson-1/book.pdf')")).error);
assert.equal((await rows(A, false, "select * from storage.objects")).length, 1, "학생은 자료 읽기 가능");

// 판서: 선생님만 쓰고, 같은 반 학생만 읽는다
assert.ok(!(await as(T, true, "insert into ink(class_no,lesson_id,doc,page,strokes) values (1,1,'pdf',3,'[{\"c\":\"#000\",\"w\":0.004,\"p\":[0.1,0.2]}]')")).error);
assert.ok(!(await as(T, true, "insert into ink(class_no,lesson_id,doc,page) values (1,1,'ppt',3) on conflict (class_no,lesson_id,doc,page) do update set strokes='[]'")).error, "PPT 판서도 저장");
assert.equal((await rows(A, false, "select * from ink where page=3")).length, 2, "1반 학생은 1반 판서를 봄");
assert.equal((await rows(B, false, "select * from ink")).length, 0, "2반 학생은 1반 판서 못 봄");
await fails(A, false, "insert into ink(class_no,lesson_id,doc,page) values (1,1,'pdf',4)");
await fails(A, false, "insert into ink(class_no,lesson_id,doc,page) values (1,1,'pdf',3) on conflict (class_no,lesson_id,doc,page) do update set strokes='[]'");
assert.equal((await rows(A, false, "update ink set strokes='[]' returning *")).length, 0, "학생은 판서 못 바꿈");
assert.equal((await rows(A, false, "delete from ink returning *")).length, 0, "학생은 판서 못 지움");
assert.equal(JSON.parse(JSON.stringify((await rows(T, true, "select strokes from ink where doc='pdf'"))[0].strokes)).length, 1, "판서가 그대로 남음");
assert.ok(!(await as(T, true, "update room_state set view='ppt' where class_no=1")).error, "화면 상태에 ppt 허용");
assert.ok(!(await as(T, true, "update lessons set ppt_path='lesson-1/ppt.pdf'")).error);
// 화이트보드: 파일 없는 차시에서도 판서, 같은 반만 보고 학생은 못 바꿈
assert.ok(!(await as(T, true, "update room_state set view='board', page=2 where class_no=1")).error, "화면 상태에 board 허용");
assert.ok(!(await as(T, true, "insert into ink(class_no,lesson_id,doc,page,strokes) values (1,1,'board',2,'[{\"c\":\"#000\",\"w\":0.004,\"p\":[0.5,0.5]}]')")).error, "화이트보드 판서 저장");
assert.equal((await rows(A, false, "select * from ink where doc='board'")).length, 1, "1반 학생은 화이트보드 판서를 봄");
assert.equal((await rows(B, false, "select * from ink where doc='board'")).length, 0, "2반 학생은 못 봄");
await fails(A, false, "insert into ink(class_no,lesson_id,doc,page) values (1,1,'board',1)");
assert.equal((await rows(A, false, "update ink set strokes='[]' where doc='board' returning *")).length, 0, "학생은 화이트보드 판서 못 바꿈");
assert.equal((await rows(A, false, "delete from ink where doc='board' returning *")).length, 0, "학생은 화이트보드 판서 못 지움");
await fails(T, true, "update room_state set view='xyz' where class_no=1");
await fails(T, true, "insert into ink(class_no,lesson_id,doc,page) values (1,1,'html',1)");
console.log("RLS 검사 모두 통과");
