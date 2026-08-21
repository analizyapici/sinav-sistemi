-- ============================================================
-- Online Sınav Sistemi — Supabase Free Plan Schema
-- SQL Editor'da tek seferde çalıştırın
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- ADMIN ----------
create table if not exists admin_config (
  id int primary key default 1 check (id = 1),
  password_hash text not null,
  preparer_name text not null default 'Sistem Yöneticisi',
  updated_at timestamptz not null default now()
);

-- İlk kurulum: şifre "admin123" (HEMEN değiştirin)
-- generate: select crypt('sizin_sifre', gen_salt('bf'));
insert into admin_config (id, password_hash, preparer_name)
values (1, crypt('admin123', gen_salt('bf')), 'Sistem Yöneticisi')
on conflict (id) do nothing;

create table if not exists admin_tokens (
  token uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);

-- ---------- EXAMS ----------
create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  teacher_name text not null default '',
  time_limit_sec int not null default 600 check (time_limit_sec > 0),
  description text not null default '',
  custom_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_exams_code on exams (code);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  sort_order int not null default 0,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  answer text not null default '',
  image_url text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_questions_exam on questions (exam_id, sort_order);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  number text not null,
  class_name text not null,
  name text not null,
  unique (exam_id, number)
);

create index if not exists idx_students_exam_class on students (exam_id, class_name);

-- ---------- SESSIONS & SUBMISSIONS ----------
create table if not exists exam_sessions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  student_key text not null,
  password_hash text not null,
  client_token uuid not null default gen_random_uuid(),
  question_order int[] not null default '{}',
  answers jsonb not null default '[]'::jsonb,
  durations jsonb not null default '[]'::jsonb,
  current_idx int not null default 0,
  time_left int not null default 0,
  focus_loss int not null default 0,
  last_seen timestamptz not null default now(),
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  created_at timestamptz not null default now(),
  unique (student_key)
);

create index if not exists idx_sessions_active_seen
  on exam_sessions (last_seen desc)
  where status = 'in_progress';

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,
  student_id uuid references students(id) on delete set null,
  session_id uuid references exam_sessions(id) on delete set null,
  student_key text not null,
  name text not null,
  number text not null,
  class_name text not null,
  exam_code text not null,
  password_hash text not null,
  score numeric(6,2) not null default 0,
  correct int not null default 0,
  incorrect int not null default 0,
  empty int not null default 0,
  time_spent int not null default 0,
  focus_loss int not null default 0,
  ip_address text default '',
  question_order int[] default '{}',
  all_answers jsonb default '[]'::jsonb,
  question_durations jsonb default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (student_key)
);

create index if not exists idx_submissions_exam_time
  on submissions (exam_code, submitted_at desc);
create index if not exists idx_submissions_number
  on submissions (number);

-- ============================================================
-- RLS: tablolara doğrudan anon erişim KAPALI; her şey RPC ile
-- ============================================================
alter table admin_config enable row level security;
alter table admin_tokens enable row level security;
alter table exams enable row level security;
alter table questions enable row level security;
alter table students enable row level security;
alter table exam_sessions enable row level security;
alter table submissions enable row level security;

-- Politikasız = dışarıdan select/insert yok (service role ve security definer RPC hariç)

-- ============================================================
-- HELPERS
-- ============================================================
create or replace function _normalize_exam_code(c text)
returns text language sql immutable as $$
  select upper(substring(regexp_replace(coalesce(c,''), '[^a-zA-Z0-9_]', '', 'g') from 1 for 20));
$$;

create or replace function _admin_ok(p_token uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from admin_tokens t
    where t.token = p_token and t.expires_at > now()
  );
$$;

-- ============================================================
-- PUBLIC / STUDENT RPCs
-- ============================================================

-- Bağlantı + sistem adı
create or replace function public_ping()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  select preparer_name into v_name from admin_config where id = 1;
  return jsonb_build_object(
    'ok', true,
    'preparer_name', coalesce(v_name, 'Sistem Yöneticisi'),
    'ts', now()
  );
end;
$$;
grant execute on function public_ping() to anon, authenticated;

-- Sınav özeti (cevaplar YOK)
create or replace function get_exam_public(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := _normalize_exam_code(p_code);
  v_exam exams%rowtype;
  v_qcount int;
  v_scount int;
  v_classes text[];
begin
  select * into v_exam from exams where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Sınav bulunamadı');
  end if;

  select count(*) into v_qcount from questions where exam_id = v_exam.id;
  select count(*) into v_scount from students where exam_id = v_exam.id;
  select array_agg(distinct class_name order by class_name)
    into v_classes from students where exam_id = v_exam.id;

  return jsonb_build_object(
    'ok', true,
    'exam', jsonb_build_object(
      'id', v_exam.id,
      'code', v_exam.code,
      'teacher_name', v_exam.teacher_name,
      'time_limit', v_exam.time_limit_sec,
      'description', v_exam.description,
      'is_active', v_exam.is_active,
      'question_count', v_qcount,
      'student_count', v_scount,
      'classes', coalesce(to_jsonb(v_classes), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function get_exam_public(text) to anon, authenticated;

-- Sınıftaki öğrenciler (sadece ad + numara; tam liste yerine)
create or replace function get_students_by_class(p_code text, p_class text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := _normalize_exam_code(p_code);
  v_exam_id uuid;
  v_rows jsonb;
begin
  select id into v_exam_id from exams where code = v_code;
  if v_exam_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sınav yok');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'number', s.number,
    'name', s.name,
    'class_name', s.class_name
  ) order by s.name), '[]'::jsonb)
  into v_rows
  from students s
  where s.exam_id = v_exam_id and s.class_name = p_class;

  return jsonb_build_object('ok', true, 'students', v_rows);
end;
$$;
grant execute on function get_students_by_class(text, text) to anon, authenticated;

-- Öğrenci girişi / oturum
create or replace function student_enter(
  p_code text,
  p_number text,
  p_name text,
  p_class text,
  p_password text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := _normalize_exam_code(p_code);
  v_exam exams%rowtype;
  v_student students%rowtype;
  v_key text;
  v_sub submissions%rowtype;
  v_ses exam_sessions%rowtype;
  v_qcount int;
  v_order int[];
  v_i int;
  v_questions jsonb;
begin
  if length(coalesce(p_password,'')) < 1 then
    return jsonb_build_object('ok', false, 'error', 'Şifre gerekli');
  end if;

  select * into v_exam from exams where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Sınav bulunamadı');
  end if;

  select * into v_student from students
  where exam_id = v_exam.id and number = trim(p_number);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Öğrenci listede yok');
  end if;

  -- İsim/sınıf doğrulama (esnek trim)
  if trim(v_student.name) <> trim(p_name) or trim(v_student.class_name) <> trim(p_class) then
    return jsonb_build_object('ok', false, 'error', 'Öğrenci bilgisi eşleşmiyor');
  end if;

  v_key := v_code || '_' || trim(p_number);

  -- Mevcut sonuç
  select * into v_sub from submissions where student_key = v_key;
  if found then
    if v_sub.password_hash = crypt(p_password, v_sub.password_hash) then
      return jsonb_build_object(
        'ok', true,
        'mode', 'result',
        'submission', jsonb_build_object(
          'id', v_sub.id,
          'name', v_sub.name,
          'number', v_sub.number,
          'className', v_sub.class_name,
          'examCode', v_sub.exam_code,
          'score', v_sub.score,
          'correct', v_sub.correct,
          'incorrect', v_sub.incorrect,
          'empty', v_sub.empty,
          'timeSpent', v_sub.time_spent,
          'focusLossCount', v_sub.focus_loss,
          'ipAddress', v_sub.ip_address,
          'questionOrder', v_sub.question_order,
          'allAnswers', v_sub.all_answers,
          'questionDurations', v_sub.question_durations,
          'submitted_at', v_sub.submitted_at
        )
      );
    else
      return jsonb_build_object('ok', false, 'error', 'Hatalı şifre (sonuç için)');
    end if;
  end if;

  if v_exam.is_active is not true then
    return jsonb_build_object('ok', false, 'error', 'Sınav kapalı ve daha önce sonuç yok');
  end if;

  select count(*) into v_qcount from questions where exam_id = v_exam.id;
  if v_qcount = 0 then
    return jsonb_build_object('ok', false, 'error', 'Bu sınavda soru yok');
  end if;

  -- Yarım oturum
  select * into v_ses from exam_sessions where student_key = v_key and status = 'in_progress';
  if found then
    if v_ses.password_hash is distinct from crypt(p_password, v_ses.password_hash) then
      return jsonb_build_object('ok', false, 'error', 'Yarım oturum için hatalı şifre');
    end if;
    -- token yenile (aynı cihaz devam)
    update exam_sessions
      set client_token = gen_random_uuid(), last_seen = now()
      where id = v_ses.id
      returning * into v_ses;
  else
    -- Yeni order 0..n-1 (karıştırma client'ta seed ile de yapılabilir; sunucu sırayı saklar)
    v_order := array(select generate_series(0, v_qcount - 1));
    insert into exam_sessions (
      exam_id, student_id, student_key, password_hash,
      question_order, answers, durations, current_idx, time_left, focus_loss, status
    ) values (
      v_exam.id, v_student.id, v_key, crypt(p_password, gen_salt('bf')),
      v_order,
      to_jsonb((select array_agg(null::text) from generate_series(1, v_qcount))),
      to_jsonb((select array_agg(0) from generate_series(1, v_qcount))),
      0, v_exam.time_limit_sec, 0, 'in_progress'
    ) returning * into v_ses;
  end if;

  -- Sorular (CEVAP YOK)
  select coalesce(jsonb_agg(jsonb_build_object(
    'idx', q.sort_order,
    'question', q.question,
    'options', q.options,
    'image', q.image_url
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions
  from questions q where q.exam_id = v_exam.id;

  return jsonb_build_object(
    'ok', true,
    'mode', 'exam',
    'session', jsonb_build_object(
      'id', v_ses.id,
      'client_token', v_ses.client_token,
      'questionOrder', v_ses.question_order,
      'selectedAnswers', v_ses.answers,
      'questionDurations', v_ses.durations,
      'currentQuestionIndex', v_ses.current_idx,
      'timeLeft', v_ses.time_left,
      'focusLossCount', v_ses.focus_loss
    ),
    'exam', jsonb_build_object(
      'code', v_exam.code,
      'teacher_name', v_exam.teacher_name,
      'time_limit', v_exam.time_limit_sec,
      'description', v_exam.description,
      'is_active', v_exam.is_active
    ),
    'student', jsonb_build_object(
      'name', v_student.name,
      'number', v_student.number,
      'className', v_student.class_name,
      'examCode', v_exam.code
    ),
    'questions', v_questions
  );
end;
$$;
grant execute on function student_enter(text,text,text,text,text) to anon, authenticated;

-- İlerleme kaydı (seyrek çağrılmalı)
create or replace function save_progress(
  p_session_id uuid,
  p_token uuid,
  p_answers jsonb,
  p_durations jsonb,
  p_current_idx int,
  p_time_left int,
  p_focus_loss int,
  p_question_order int[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ses exam_sessions%rowtype;
begin
  select * into v_ses from exam_sessions where id = p_session_id;
  if not found or v_ses.client_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'error', 'Oturum geçersiz');
  end if;
  if v_ses.status <> 'in_progress' then
    return jsonb_build_object('ok', false, 'error', 'Oturum kapalı');
  end if;

  update exam_sessions set
    answers = coalesce(p_answers, answers),
    durations = coalesce(p_durations, durations),
    current_idx = coalesce(p_current_idx, current_idx),
    time_left = greatest(coalesce(p_time_left, time_left), 0),
    focus_loss = coalesce(p_focus_loss, focus_loss),
    question_order = coalesce(p_question_order, question_order),
    last_seen = now()
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'saved_at', now());
end;
$$;
grant execute on function save_progress(uuid,uuid,jsonb,jsonb,int,int,int,int[]) to anon, authenticated;

-- Sınavı bitir — puan sunucuda
create or replace function submit_exam(
  p_session_id uuid,
  p_token uuid,
  p_answers jsonb,
  p_durations jsonb,
  p_time_spent int,
  p_focus_loss int,
  p_ip text default '',
  p_question_order int[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ses exam_sessions%rowtype;
  v_exam exams%rowtype;
  v_student students%rowtype;
  v_q record;
  v_ans text;
  v_c int := 0;
  v_i int := 0;
  v_e int := 0;
  v_total int := 0;
  v_score numeric(6,2);
  v_order int[];
  v_sub submissions%rowtype;
  v_key text;
begin
  select * into v_ses from exam_sessions where id = p_session_id for update;
  if not found or v_ses.client_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'error', 'Oturum geçersiz');
  end if;

  v_key := v_ses.student_key;

  -- Zaten submission var mı?
  if exists(select 1 from submissions where student_key = v_key) then
    select * into v_sub from submissions where student_key = v_key;
    return jsonb_build_object('ok', true, 'mode', 'result', 'submission', to_jsonb(v_sub));
  end if;

  select * into v_exam from exams where id = v_ses.exam_id;
  select * into v_student from students where id = v_ses.student_id;

  v_order := coalesce(p_question_order, v_ses.question_order);
  if p_answers is not null then
    v_ses.answers := p_answers;
  end if;

  for v_q in
    select sort_order, answer from questions where exam_id = v_exam.id order by sort_order
  loop
    v_total := v_total + 1;
    v_ans := nullif(trim(both from coalesce(v_ses.answers ->> v_q.sort_order, '')), '');
    if v_ans is null then
      v_e := v_e + 1;
    elsif lower(v_ans) = lower(trim(v_q.answer)) then
      v_c := v_c + 1;
    else
      v_i := v_i + 1;
    end if;
  end loop;

  v_score := case when v_total > 0 then round((v_c * 100.0 / v_total)::numeric, 2) else 0 end;

  insert into submissions (
    exam_id, student_id, session_id, student_key,
    name, number, class_name, exam_code, password_hash,
    score, correct, incorrect, empty, time_spent, focus_loss, ip_address,
    question_order, all_answers, question_durations
  ) values (
    v_exam.id, v_student.id, v_ses.id, v_key,
    v_student.name, v_student.number, v_student.class_name, v_exam.code, v_ses.password_hash,
    v_score, v_c, v_i, v_e,
    coalesce(p_time_spent, greatest(v_exam.time_limit_sec - v_ses.time_left, 0)),
    coalesce(p_focus_loss, v_ses.focus_loss),
    coalesce(p_ip, ''),
    v_order,
    coalesce(p_answers, v_ses.answers),
    coalesce(p_durations, v_ses.durations)
  ) returning * into v_sub;

  update exam_sessions set
    status = 'submitted',
    answers = coalesce(p_answers, answers),
    durations = coalesce(p_durations, durations),
    focus_loss = coalesce(p_focus_loss, focus_loss),
    last_seen = now()
  where id = v_ses.id;

  return jsonb_build_object(
    'ok', true,
    'mode', 'result',
    'submission', jsonb_build_object(
      'id', v_sub.id,
      'name', v_sub.name,
      'number', v_sub.number,
      'className', v_sub.class_name,
      'examCode', v_sub.exam_code,
      'score', v_sub.score,
      'correct', v_sub.correct,
      'incorrect', v_sub.incorrect,
      'empty', v_sub.empty,
      'timeSpent', v_sub.time_spent,
      'focusLossCount', v_sub.focus_loss,
      'ipAddress', v_sub.ip_address,
      'questionOrder', v_sub.question_order,
      'allAnswers', v_sub.all_answers,
      'questionDurations', v_sub.question_durations,
      'submitted_at', v_sub.submitted_at
    )
  );
end;
$$;
grant execute on function submit_exam(uuid,uuid,jsonb,jsonb,int,int,text,int[]) to anon, authenticated;

-- Öğrenci sonuç detayı (sınav kapalıysa sorular+cevaplar, sıralama özeti)
create or replace function get_student_result_view(p_student_key text, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sub submissions%rowtype;
  v_exam exams%rowtype;
  v_active boolean;
  v_history jsonb;
  v_all jsonb;
  v_questions jsonb;
begin
  select * into v_sub from submissions where student_key = p_student_key;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Sonuç yok');
  end if;
  if v_sub.password_hash is distinct from crypt(p_password, v_sub.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'Hatalı şifre');
  end if;

  select * into v_exam from exams where id = v_sub.exam_id;
  v_active := coalesce(v_exam.is_active, true);

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', s.exam_code, 'score', s.score, 'date', s.submitted_at
  ) order by s.submitted_at), '[]'::jsonb)
  into v_history
  from submissions s where s.number = v_sub.number;

  if v_active then
    return jsonb_build_object(
      'ok', true,
      'restricted', true,
      'submission', jsonb_build_object(
        'name', v_sub.name, 'number', v_sub.number, 'className', v_sub.class_name,
        'examCode', v_sub.exam_code, 'score', v_sub.score,
        'correct', v_sub.correct, 'incorrect', v_sub.incorrect, 'empty', v_sub.empty
      ),
      'history', v_history
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', s.name, 'number', s.number, 'className', s.class_name,
    'score', s.score, 'timeSpent', s.time_spent
  ) order by s.score desc, s.time_spent asc), '[]'::jsonb)
  into v_all from submissions s where s.exam_id = v_sub.exam_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'question', q.question, 'options', q.options, 'answer', q.answer, 'image', q.image_url
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions from questions q where q.exam_id = v_sub.exam_id;

  return jsonb_build_object(
    'ok', true,
    'restricted', false,
    'submission', jsonb_build_object(
      'id', v_sub.id,
      'name', v_sub.name, 'number', v_sub.number, 'className', v_sub.class_name,
      'examCode', v_sub.exam_code, 'score', v_sub.score,
      'correct', v_sub.correct, 'incorrect', v_sub.incorrect, 'empty', v_sub.empty,
      'timeSpent', v_sub.time_spent, 'focusLossCount', v_sub.focus_loss,
      'allAnswers', v_sub.all_answers, 'questionDurations', v_sub.question_durations,
      'questionOrder', v_sub.question_order
    ),
    'history', v_history,
    'leaderboard', v_all,
    'questions', v_questions
  );
end;
$$;
grant execute on function get_student_result_view(text, text) to anon, authenticated;

-- ============================================================
-- ADMIN RPCs
-- ============================================================

create or replace function admin_login(p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_token uuid;
  v_name text;
begin
  select password_hash, preparer_name into v_hash, v_name from admin_config where id = 1;
  if v_hash is null or v_hash is distinct from crypt(p_password, v_hash) then
    return jsonb_build_object('ok', false, 'error', 'Hatalı şifre');
  end if;
  -- eski token temizliği (free DB şişmesin)
  delete from admin_tokens where expires_at < now();
  insert into admin_tokens default values returning token into v_token;
  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'preparer_name', v_name,
    'expires_hours', 12
  );
end;
$$;
grant execute on function admin_login(text) to anon, authenticated;

create or replace function admin_change_password(p_token uuid, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  if length(coalesce(p_new,'')) < 4 then
    return jsonb_build_object('ok', false, 'error', 'Şifre kısa');
  end if;
  update admin_config set password_hash = crypt(p_new, gen_salt('bf')), updated_at = now() where id = 1;
  delete from admin_tokens where token <> p_token; -- diğer oturumları düşür
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_change_password(uuid, text) to anon, authenticated;

create or replace function admin_upsert_exam(
  p_token uuid,
  p_code text,
  p_teacher text,
  p_time_min int,
  p_desc text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := _normalize_exam_code(p_code);
  v_id uuid;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  if v_code is null or length(v_code) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Geçersiz kod');
  end if;

  insert into exams (code, teacher_name, time_limit_sec, description, updated_at)
  values (v_code, coalesce(p_teacher,''), greatest(coalesce(p_time_min,10),1) * 60, coalesce(p_desc,''), now())
  on conflict (code) do update set
    teacher_name = excluded.teacher_name,
    time_limit_sec = excluded.time_limit_sec,
    description = excluded.description,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end;
$$;
grant execute on function admin_upsert_exam(uuid,text,text,int,text) to anon, authenticated;

create or replace function admin_list_exams(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'code', e.code,
    'teacher_name', e.teacher_name,
    'time_limit', e.time_limit_sec,
    'description', e.description,
    'custom_name', e.custom_name,
    'is_active', e.is_active,
    'question_count', (select count(*) from questions q where q.exam_id = e.id),
    'student_count', (select count(*) from students s where s.exam_id = e.id),
    'submission_count', (select count(*) from submissions sub where sub.exam_id = e.id)
  ) order by e.created_at desc), '[]'::jsonb)
  into v_rows from exams e;

  return jsonb_build_object('ok', true, 'exams', v_rows);
end;
$$;
grant execute on function admin_list_exams(uuid) to anon, authenticated;

create or replace function admin_toggle_exam(p_token uuid, p_code text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  update exams set is_active = p_active, updated_at = now()
  where code = _normalize_exam_code(p_code);
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_toggle_exam(uuid, text, boolean) to anon, authenticated;

create or replace function admin_update_exam_meta(
  p_token uuid, p_code text, p_teacher text default null, p_custom_name text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  update exams set
    teacher_name = coalesce(p_teacher, teacher_name),
    custom_name = coalesce(p_custom_name, custom_name),
    updated_at = now()
  where code = _normalize_exam_code(p_code);
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_update_exam_meta(uuid,text,text,text) to anon, authenticated;

create or replace function admin_delete_exam(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  select id into v_id from exams where code = _normalize_exam_code(p_code);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'Yok');
  end if;
  delete from exams where id = v_id; -- cascade
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_delete_exam(uuid, text) to anon, authenticated;

create or replace function admin_set_questions(p_token uuid, p_code text, p_questions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exam_id uuid;
  v_item jsonb;
  v_ord int := 0;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  select id into v_exam_id from exams where code = _normalize_exam_code(p_code);
  if v_exam_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sınav yok — önce oluşturun');
  end if;

  delete from questions where exam_id = v_exam_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb))
  loop
    insert into questions (exam_id, sort_order, question, options, answer, image_url)
    values (
      v_exam_id,
      v_ord,
      coalesce(v_item->>'question', ''),
      coalesce(v_item->'options', '[]'::jsonb),
      coalesce(v_item->>'answer', ''),
      coalesce(v_item->>'image', v_item->>'image_url', '')
    );

    v_ord := v_ord + 1;
  end loop;

  return jsonb_build_object('ok', true, 'count', v_ord);
end;
$$;
grant execute on function admin_set_questions(uuid, text, jsonb) to anon, authenticated;

create or replace function admin_get_questions(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exam_id uuid;
  v_rows jsonb;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  select id into v_exam_id from exams where code = _normalize_exam_code(p_code);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'question', q.question,
    'options', q.options,
    'answer', q.answer,
    'image', q.image_url,
    'sort_order', q.sort_order
  ) order by q.sort_order), '[]'::jsonb)
  into v_rows from questions q where q.exam_id = v_exam_id;

  return jsonb_build_object('ok', true, 'questions', v_rows);
end;
$$;
grant execute on function admin_get_questions(uuid, text) to anon, authenticated;

create or replace function admin_set_students(p_token uuid, p_code text, p_students jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exam_id uuid;
  v_item jsonb;
  v_n int := 0;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  select id into v_exam_id from exams where code = _normalize_exam_code(p_code);
  if v_exam_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sınav yok');
  end if;

  delete from students where exam_id = v_exam_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    insert into students (exam_id, number, class_name, name)
    values (
      v_exam_id,
      trim(coalesce(v_item->>'number', '')),
      trim(coalesce(v_item->>'className', v_item->>'class_name', '')),
      trim(coalesce(v_item->>'name', ''))
    )
    on conflict (exam_id, number) do update set
      class_name = excluded.class_name,
      name = excluded.name;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'count', v_n);
end;
$$;
grant execute on function admin_set_students(uuid, text, jsonb) to anon, authenticated;

create or replace function admin_get_students(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exam_id uuid;
  v_rows jsonb;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  select id into v_exam_id from exams where code = _normalize_exam_code(p_code);
  select coalesce(jsonb_agg(jsonb_build_object(
    'number', s.number, 'className', s.class_name, 'name', s.name
  ) order by s.class_name, s.name), '[]'::jsonb)
  into v_rows from students s where s.exam_id = v_exam_id;
  return jsonb_build_object('ok', true, 'students', v_rows);
end;
$$;
grant execute on function admin_get_students(uuid, text) to anon, authenticated;

create or replace function admin_list_submissions(
  p_token uuid,
  p_code text default null,
  p_name text default null,
  p_class text default null,
  p_limit int default 250,
  p_offset int default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
  v_total int;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;

  select count(*) into v_total
  from submissions s
  where (p_code is null or p_code = '' or s.exam_code ilike '%' || p_code || '%')
    and (p_name is null or p_name = '' or s.name ilike '%' || p_name || '%')
    and (p_class is null or p_class = '' or s.class_name = p_class);

  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'number', s.number,
      'className', s.class_name,
      'examCode', s.exam_code,
      'score', s.score,
      'correct', s.correct,
      'incorrect', s.incorrect,
      'empty', s.empty,
      'timeSpent', s.time_spent,
      'focusLossCount', s.focus_loss,
      'ipAddress', s.ip_address,
      'allAnswers', s.all_answers,
      'questionDurations', s.question_durations,
      'submitted_at', s.submitted_at
    ) as row_data
    from submissions s
    where (p_code is null or p_code = '' or s.exam_code ilike '%' || p_code || '%')
      and (p_name is null or p_name = '' or s.name ilike '%' || p_name || '%')
      and (p_class is null or p_class = '' or s.class_name = p_class)
    order by s.submitted_at desc
    limit least(coalesce(p_limit, 250), 500)
    offset greatest(coalesce(p_offset, 0), 0)
  ) t;

  return jsonb_build_object('ok', true, 'total', v_total, 'submissions', v_rows);
end;
$$;
grant execute on function admin_list_submissions(uuid,text,text,text,int,int) to anon, authenticated;

create or replace function admin_delete_submission(p_token uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  delete from submissions where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_delete_submission(uuid, uuid) to anon, authenticated;

create or replace function admin_delete_submissions_filtered(
  p_token uuid, p_code text, p_name text, p_class text, p_all boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  if p_all then
    delete from submissions;
    get diagnostics v_n = row_count;
  else
    delete from submissions s
    where (p_code is null or p_code = '' or s.exam_code ilike '%' || p_code || '%')
      and (p_name is null or p_name = '' or s.name ilike '%' || p_name || '%')
      and (p_class is null or p_class = '' or s.class_name = p_class);
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('ok', true, 'deleted', v_n);
end;
$$;
grant execute on function admin_delete_submissions_filtered(uuid,text,text,text,boolean) to anon, authenticated;

create or replace function admin_online_students(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;

  -- 5 dk içinde görülen in_progress
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', es.id,
    'name', st.name,
    'number', st.number,
    'className', st.class_name,
    'examCode', e.code,
    'currentQuestionIndex', es.current_idx,
    'timeLeft', es.time_left,
    'focusLossCount', es.focus_loss,
    'last_seen', es.last_seen
  ) order by es.last_seen desc), '[]'::jsonb)
  into v_rows
  from exam_sessions es
  join students st on st.id = es.student_id
  join exams e on e.id = es.exam_id
  where es.status = 'in_progress'
    and es.last_seen > now() - interval '5 minutes';

  return jsonb_build_object('ok', true, 'students', v_rows);
end;
$$;
grant execute on function admin_online_students(uuid) to anon, authenticated;

create or replace function admin_exam_stats(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exam_id uuid;
  v_subs jsonb;
  v_missing jsonb;
  v_avg numeric;
  v_count int;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  select id into v_exam_id from exams where code = _normalize_exam_code(p_code);
  if v_exam_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sınav yok');
  end if;

  select count(*), coalesce(avg(score),0)
  into v_count, v_avg from submissions where exam_id = v_exam_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', s.name, 'number', s.number, 'className', s.class_name,
    'score', s.score, 'timeSpent', s.time_spent
  )), '[]'::jsonb)
  into v_subs from submissions s where s.exam_id = v_exam_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', st.name, 'number', st.number, 'className', st.class_name
  ) order by st.class_name, st.name), '[]'::jsonb)
  into v_missing
  from students st
  where st.exam_id = v_exam_id
    and not exists (
      select 1 from submissions sub
      where sub.exam_id = v_exam_id and sub.number = st.number
    );

  return jsonb_build_object(
    'ok', true,
    'count', v_count,
    'average', round(v_avg::numeric, 2),
    'submissions', v_subs,
    'missing', v_missing
  );
end;
$$;
grant execute on function admin_exam_stats(uuid, text) to anon, authenticated;

create or replace function admin_get_submission(p_token uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sub submissions%rowtype;
  v_questions jsonb;
  v_all jsonb;
  v_history jsonb;
  v_active boolean;
begin
  if not _admin_ok(p_token) then
    return jsonb_build_object('ok', false, 'error', 'Yetkisiz');
  end if;
  select * into v_sub from submissions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Yok');
  end if;

  select is_active into v_active from exams where id = v_sub.exam_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'question', q.question, 'options', q.options, 'answer', q.answer, 'image', q.image_url
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions from questions q where q.exam_id = v_sub.exam_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', s.name, 'number', s.number, 'className', s.class_name,
    'score', s.score, 'timeSpent', s.time_spent
  ) order by s.score desc), '[]'::jsonb)
  into v_all from submissions s where s.exam_id = v_sub.exam_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', s.exam_code, 'score', s.score, 'date', s.submitted_at
  ) order by s.submitted_at), '[]'::jsonb)
  into v_history from submissions s where s.number = v_sub.number;

  return jsonb_build_object(
    'ok', true,
    'restricted', false,
    'is_active', coalesce(v_active, true),
    'submission', jsonb_build_object(
      'id', v_sub.id,
      'name', v_sub.name, 'number', v_sub.number, 'className', v_sub.class_name,
      'examCode', v_sub.exam_code, 'score', v_sub.score,
      'correct', v_sub.correct, 'incorrect', v_sub.incorrect, 'empty', v_sub.empty,
      'timeSpent', v_sub.time_spent, 'focusLossCount', v_sub.focus_loss,
      'allAnswers', v_sub.all_answers, 'questionDurations', v_sub.question_durations,
      'questionOrder', v_sub.question_order
    ),
    'questions', v_questions,
    'leaderboard', v_all,
    'history', v_history
  );
end;
$$;
grant execute on function admin_get_submission(uuid, uuid) to anon, authenticated;

-- Free plan bakımı: eski submitted session ve token temizle
create or replace function maintenance_cleanup()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v1 int; v2 int;
begin
  delete from admin_tokens where expires_at < now();
  get diagnostics v1 = row_count;
  delete from exam_sessions
  where status = 'submitted' and last_seen < now() - interval '7 days';
  get diagnostics v2 = row_count;
  return jsonb_build_object('ok', true, 'tokens', v1, 'sessions', v2);
end;
$$;
grant execute on function maintenance_cleanup() to anon, authenticated;

-- Keep-alive (cron)
create or replace function keep_alive()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'ts', now());
$$;
grant execute on function keep_alive() to anon, authenticated;
