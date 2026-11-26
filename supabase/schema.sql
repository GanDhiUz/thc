-- 수업 진행 웹사이트: 표 + 권한 규칙(RLS) + 저장소 + 실시간
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 안전하다.

-- 선생님 여부: 계정의 app_metadata.role = 'teacher'
create or replace function public.is_teacher() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'teacher'
$$;

create table if not exists public.students (
  id uuid primary key references auth.users on delete cascade,
  class_no int not null check (class_no between 1 and 20),
  number int not null check (number between 1 and 99),
  name text not null,
  unique (class_no, number)
);

-- 로그인한 학생의 반 (RLS 안에서 students 를 다시 읽을 때 쓰므로 security definer)
create or replace function public.my_class() returns int
language sql stable security definer set search_path = public as $$
  select class_no from public.students where id = auth.uid()
$$;

create table if not exists public.lessons (
  id bigint generated always as identity primary key,
  ord int not null default 0,
  title text not null,
  pdf_path text,
  html_path text,
  quiz_intro text,
  quiz_outro text
);
alter table public.lessons add column if not exists ppt_path text; -- PPT 를 PDF 로 저장해 올린 것

create table if not exists public.summaries (
  student_id uuid not null references public.students on delete cascade,
  lesson_id bigint not null references public.lessons on delete cascade,
  body text not null check (char_length(body) <= 5000),
  submitted_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);

create table if not exists public.room_state (
  class_no int primary key,
  lesson_id bigint references public.lessons on delete set null,
  view text not null default 'pdf' check (view in ('pdf', 'html', 'ppt', 'board')),
  page int not null default 1,
  locked boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.room_state (class_no) values (1), (2), (3), (4), (5)
on conflict do nothing;
-- 예전에 만든 표도 'ppt'·'board'(화이트보드) 를 받게 규칙을 바꾼다
alter table public.room_state drop constraint if exists room_state_view_check;
alter table public.room_state add constraint room_state_view_check check (view in ('pdf', 'html', 'ppt', 'board'));

-- 선생님 판서: 반·차시·자료(교과서/PPT/화이트보드)·쪽마다 한 줄. 좌표는 쪽 크기에 대한 비율.
create table if not exists public.ink (
  class_no int not null,
  lesson_id bigint not null references public.lessons on delete cascade,
  doc text not null check (doc in ('pdf', 'ppt', 'board')),
  page int not null,
  strokes jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (class_no, lesson_id, doc, page)
);
alter table public.ink drop constraint if exists ink_doc_check;
alter table public.ink add constraint ink_doc_check check (doc in ('pdf', 'ppt', 'board'));

-- 로그인한 사람에게만 표를 연다 (누가 무엇을 보는지는 아래 RLS 가 정한다). 로그인 안 한 사람(anon)에게는 열지 않는다.
grant select, insert, update, delete on public.students, public.lessons, public.summaries, public.room_state, public.ink to authenticated;
grant usage on all sequences in schema public to authenticated;
-- 학생 계정 함수(create-students)가 쓰는 관리자 역할
grant all on public.students, public.lessons, public.summaries, public.room_state, public.ink to service_role;

alter table public.students enable row level security;
alter table public.lessons enable row level security;
alter table public.summaries enable row level security;
alter table public.room_state enable row level security;
alter table public.ink enable row level security;

drop policy if exists "students read" on public.students;
create policy "students read" on public.students for select to authenticated
  using (id = auth.uid() or public.is_teacher());
drop policy if exists "students teacher write" on public.students;
create policy "students teacher write" on public.students for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "lessons read" on public.lessons;
create policy "lessons read" on public.lessons for select to authenticated using (true);
drop policy if exists "lessons teacher write" on public.lessons;
create policy "lessons teacher write" on public.lessons for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "summaries read" on public.summaries;
create policy "summaries read" on public.summaries for select to authenticated
  using (student_id = auth.uid() or public.is_teacher());
drop policy if exists "summaries own insert" on public.summaries;
create policy "summaries own insert" on public.summaries for insert to authenticated
  with check (student_id = auth.uid());
drop policy if exists "summaries own update" on public.summaries;
create policy "summaries own update" on public.summaries for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists "summaries teacher delete" on public.summaries;
create policy "summaries teacher delete" on public.summaries for delete to authenticated
  using (public.is_teacher());

drop policy if exists "room read" on public.room_state;
create policy "room read" on public.room_state for select to authenticated
  using (public.is_teacher() or class_no = public.my_class());
drop policy if exists "room teacher write" on public.room_state;
create policy "room teacher write" on public.room_state for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "ink read" on public.ink;
create policy "ink read" on public.ink for select to authenticated
  using (public.is_teacher() or class_no = public.my_class());
drop policy if exists "ink teacher write" on public.ink;
create policy "ink teacher write" on public.ink for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- 비공개 저장소: 교과서 PDF, PPT용 PDF, 단원 HTML
insert into storage.buckets (id, name, public) values ('materials', 'materials', false)
on conflict (id) do nothing;
drop policy if exists "materials read" on storage.objects;
create policy "materials read" on storage.objects for select to authenticated
  using (bucket_id = 'materials');
drop policy if exists "materials teacher insert" on storage.objects;
create policy "materials teacher insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and public.is_teacher());
drop policy if exists "materials teacher update" on storage.objects;
create policy "materials teacher update" on storage.objects for update to authenticated
  using (bucket_id = 'materials' and public.is_teacher());
drop policy if exists "materials teacher delete" on storage.objects;
create policy "materials teacher delete" on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and public.is_teacher());

-- 실시간 알림: 화면 고정(room_state), 새 요약(summaries), 판서(ink)
do $$ begin
  alter publication supabase_realtime add table public.room_state;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.summaries;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.ink;
exception when duplicate_object then null; end $$;
