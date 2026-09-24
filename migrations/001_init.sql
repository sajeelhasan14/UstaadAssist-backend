-- 001_init.sql — UstaadAssist initial schema
--
-- Run manually:
--   psql "$DATABASE_URL" -f migrations/001_init.sql
--
-- Notes that matter:
--   * teacher.id references Supabase auth.users(id). The uuid comes from the
--     verified JWT's `sub` claim, so req.auth.userId maps straight onto it.
--   * mark.obtained is NULLABLE on purpose. NULL means "not entered yet" and
--     is reported as missing. Never default it to 0 — a missing mark must
--     never be silently treated as a zero.
--   * session.status = 'conducted' is what the planner reads to freeze the past.

begin;

-- ---------------------------------------------------------------- identity

create table teacher (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  department  text,
  created_at  timestamptz not null default now()
);

create table course (
  id                   bigserial primary key,
  teacher_id           uuid not null references teacher(id) on delete cascade,
  name                 text not null,
  code                 text,
  semester             text,
  start_date           date not null,
  end_date             date not null,
  class_days           text[] not null,
  attendance_threshold numeric(5,2) not null default 75,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint course_dates_ck      check (end_date > start_date),
  constraint course_class_days_ck check (
    array_length(class_days, 1) between 1 and 7
    and class_days <@ array['mon','tue','wed','thu','fri','sat','sun']
  )
);

create index course_teacher_idx on course (teacher_id);

-- ------------------------------------------------------------ course setup

create table topic (
  id              bigserial primary key,
  course_id       bigint not null references course(id) on delete cascade,
  order_no        int    not null,
  title           text   not null,
  sessions_needed int    not null default 1 check (sessions_needed >= 1),
  min_sessions    int    not null default 1 check (min_sessions    >= 1),
  priority        text   not null default 'normal'  check (priority in ('low','normal','high')),
  status          text   not null default 'pending' check (status   in ('pending','in_progress','completed','dropped')),
  created_at      timestamptz not null default now(),
  unique (course_id, order_no),
  constraint topic_min_le_needed_ck check (min_sessions <= sessions_needed)
);

create table holiday (
  id        bigserial primary key,
  course_id bigint  not null references course(id) on delete cascade,
  date      date    not null,
  name      text,
  is_active boolean not null default true,
  source    text    not null default 'preloaded' check (source in ('preloaded','custom')),
  unique (course_id, date)
);

-- ------------------------------------------------------- the plan (backbone)

create table session (
  id            bigserial primary key,
  course_id     bigint not null references course(id) on delete cascade,
  topic_id      bigint references topic(id) on delete set null,
  date          date   not null,
  week_no       int    not null,
  part_no       int,
  total_parts   int,
  status        text   not null default 'planned' check (status in ('planned','conducted','cancelled')),
  kind          text   not null default 'regular' check (kind   in ('regular','makeup','revision')),
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index session_course_date_idx on session (course_id, date);
create index session_topic_idx       on session (topic_id);

create table replan_log (
  id           bigserial primary key,
  course_id    bigint not null references course(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  reason       text  not null,
  changes      jsonb not null
);

create index replan_log_course_idx on replan_log (course_id, triggered_at desc);

-- ------------------------------------------------------------------ people

create table student (
  id         bigserial primary key,
  teacher_id uuid not null references teacher(id) on delete cascade,
  roll_no    text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (teacher_id, roll_no)
);

create table enrollment (
  id         bigserial primary key,
  course_id  bigint not null references course(id)  on delete cascade,
  student_id bigint not null references student(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, student_id)
);

create index enrollment_student_idx on enrollment (student_id);

create table attendance (
  id         bigserial primary key,
  session_id bigint not null references session(id) on delete cascade,
  student_id bigint not null references student(id) on delete cascade,
  status     text   not null check (status in ('present','absent','leave')),
  marked_at  timestamptz not null default now(),
  unique (session_id, student_id)
);

create index attendance_student_idx on attendance (student_id);

-- ------------------------------------------------------- assessment & marks

create table assessment (
  id            bigserial primary key,
  course_id     bigint       not null references course(id) on delete cascade,
  type          text         not null check (type in ('quiz','assignment','midterm','final','participation')),
  title         text         not null,
  date          date,
  total_marks   numeric(6,2) not null check (total_marks > 0),
  original_date date,
  move_reason   text,
  created_at    timestamptz  not null default now()
);

create index assessment_course_idx on assessment (course_id);

create table assessment_topic (
  assessment_id bigint not null references assessment(id) on delete cascade,
  topic_id      bigint not null references topic(id)      on delete cascade,
  primary key (assessment_id, topic_id)
);

create table mark (
  id            bigserial primary key,
  assessment_id bigint      not null references assessment(id) on delete cascade,
  student_id    bigint      not null references student(id)    on delete cascade,
  obtained      numeric(6,2),                 -- NULL = not entered. Never 0 by default.
  is_absent     boolean     not null default false,
  updated_at    timestamptz not null default now(),
  unique (assessment_id, student_id)
);

-- ----------------------------------------------------------------- grading

create table weightage (
  id         bigserial primary key,
  course_id  bigint       not null references course(id) on delete cascade,
  component  text         not null check (component in ('quiz','assignment','midterm','final','participation')),
  percentage numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  unique (course_id, component)
);

create table grade_scale (
  id             bigserial primary key,
  course_id      bigint       not null references course(id) on delete cascade,
  grade          text         not null,
  min_percentage numeric(5,2) not null check (min_percentage >= 0 and min_percentage <= 100),
  order_no       int          not null,
  unique (course_id, grade),
  unique (course_id, order_no)
);

-- ---------------------------------------------------------------- material

create table material (
  id           bigserial primary key,
  course_id    bigint not null references course(id) on delete cascade,
  topic_id     bigint references topic(id) on delete set null,
  title        text   not null,
  storage_path text   not null,           -- path returned by Supabase Storage
  mime_type    text,
  size_bytes   bigint,
  uploaded_at  timestamptz not null default now()
);

create index material_course_idx on material (course_id);

commit;
