-- 003_security.sql — close the public API, and let teachers use their own storage folder
--
-- Run manually (or paste into the Supabase SQL editor):
--   psql "$DATABASE_URL" -f migrations/003_security.sql
--
-- 1. ROW LEVEL SECURITY ON EVERY TABLE
--
--    Supabase publishes every table in the `public` schema through its REST API
--    (PostgREST). With RLS off, anyone holding the anon key — which ships inside
--    the mobile app, so it is public — can read, and write, every course,
--    student, mark and attendance row of every teacher.
--
--    Turning RLS on with NO policies closes that door completely: the anon and
--    authenticated roles get zero rows. The app never talks to these tables
--    directly; it goes through the Express API.
--
--    The Express backend is unaffected: it connects as `postgres`, which owns
--    these tables and has BYPASSRLS, so RLS does not apply to it.
--
-- 2. STORAGE POLICIES FOR THE `materials` BUCKET
--
--    The app uploads files straight to Supabase Storage (they never pass
--    through Express). Every path starts with the teacher's own user id:
--        <auth user id>/<course id>/<folder>/<timestamp>-<file name>
--    These policies let a signed-in teacher upload, read and delete ONLY inside
--    the folder named after them. The bucket stays private; files are opened
--    through short-lived signed URLs.

begin;

-- ------------------------------------------------------------------ 1. RLS

alter table public.teacher          enable row level security;
alter table public.course           enable row level security;
alter table public.topic            enable row level security;
alter table public.holiday          enable row level security;
alter table public.session          enable row level security;
alter table public.replan_log       enable row level security;
alter table public.makeup_date      enable row level security;
alter table public.student          enable row level security;
alter table public.enrollment       enable row level security;
alter table public.attendance       enable row level security;
alter table public.assessment       enable row level security;
alter table public.assessment_topic enable row level security;
alter table public.mark             enable row level security;
alter table public.weightage        enable row level security;
alter table public.grade_scale      enable row level security;
alter table public.material         enable row level security;

-- ------------------------------------------------------- 2. storage policies

drop policy if exists "Teachers upload to their own folder" on storage.objects;
drop policy if exists "Teachers read their own files"       on storage.objects;
drop policy if exists "Teachers delete their own files"     on storage.objects;

create policy "Teachers upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Teachers read their own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Teachers delete their own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

commit;
