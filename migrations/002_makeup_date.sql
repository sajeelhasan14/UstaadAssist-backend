-- 002_makeup_date.sql — remember the makeup classes the teacher agreed to
--
-- Run manually:
--   psql "$DATABASE_URL" -f migrations/002_makeup_date.sql
--
-- Why this table exists:
--   The "Extend" deficit option (Section 3.5) adds classes on days the teacher
--   does not normally teach. generateSlots() only ever produces normal class
--   days, so it can never rediscover those dates. They cannot be stored as
--   session rows either, because every replan deletes and rebuilds the planned
--   sessions. So an agreed makeup date is stored here once, and every later
--   replan reads it back and feeds it to the planner as an extra slot.

begin;

create table makeup_date (
  id         bigserial primary key,
  course_id  bigint not null references course(id) on delete cascade,
  date       date   not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (course_id, date)
);

create index makeup_date_course_idx on makeup_date (course_id, date);

commit;
