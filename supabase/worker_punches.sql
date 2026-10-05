-- שעון עובדים — טבלת דיווחי שעות
--
-- Run this ONCE in the hub's Supabase project:
--   https://supabase.com/dashboard/project/vexdreijmfntkhpfbacc/sql/new
-- Paste, press RUN. Safe to run twice.
--
-- Why a separate table instead of a key in hub_state:
--   hub_state is one row per (user_id, key) holding a whole JSON blob, and the client
--   read-modify-writes it. Two people writing the same key overwrite each other, and
--   anything allowed to write hub_state could write ANY key — customers, prices, costs.
--   A worker needs to add one line and see nothing. That is an insert-only table.
--
-- The worker's page uses the project's publishable key, which is public by design. So the
-- policies below are the actual boundary: anon may INSERT and nothing else. It cannot read
-- back a single row, not even its own. Someone who finds the URL can file a bogus punch —
-- which lands in an approval queue that Daniel confirms before it becomes wages. That is
-- the intended trust level; it is not a login and is not claimed to be one.

create table if not exists public.worker_punches (
  id          uuid primary key default gen_random_uuid(),
  worker      text        not null,
  work_date   date        not null,
  hours       numeric(5,2) not null check (hours > 0 and hours <= 24),
  started_at  timestamptz,
  ended_at    timestamptz,
  note        text,
  source      text        not null default 'clock',   -- 'clock' | 'manual'
  status      text        not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  created_at  timestamptz not null default now()
);

create index if not exists worker_punches_pending_idx
  on public.worker_punches (status, work_date desc);

alter table public.worker_punches enable row level security;

-- anon: insert only.
drop policy if exists "anon_insert_punch" on public.worker_punches;
create policy "anon_insert_punch" on public.worker_punches
  for insert to anon with check (true);

-- the logged-in owner: read and approve/reject.
drop policy if exists "authed_read_punch" on public.worker_punches;
create policy "authed_read_punch" on public.worker_punches
  for select to authenticated using (true);

drop policy if exists "authed_update_punch" on public.worker_punches;
create policy "authed_update_punch" on public.worker_punches
  for update to authenticated using (true) with check (true);

drop policy if exists "authed_delete_punch" on public.worker_punches;
create policy "authed_delete_punch" on public.worker_punches
  for delete to authenticated using (true);

-- Belt and braces, matching the retail project's migration of 2026-06-12: revoke the grant
-- as well as withholding the policy, so the table cannot be read even if a permissive
-- policy is ever added by accident.
revoke select on public.worker_punches from anon;
