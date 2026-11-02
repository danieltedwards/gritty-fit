-- =====================================================================
-- GRIT — database schema (v1)
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again: it only creates what is missing and refreshes
-- functions and access rules.
-- =====================================================================

-- ---------- tables ----------

-- One row per account. Coaches and clients are both "profiles".
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'client' check (role in ('client', 'coach')),
  coach_id    uuid references public.profiles (id) on delete set null,
  targets     jsonb,            -- nutrition/training targets set by the coach
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

-- Everything a person logs (food, workouts, weigh-ins, journal, habits, ...),
-- one row per record. The app syncs these both ways.
create table if not exists public.entries (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null,
  id          text not null,
  data        jsonb,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind, id)
);
create index if not exists entries_user_updated on public.entries (user_id, updated_at);

-- Training plans written by a coach. visibility 'all' = every client of the coach,
-- 'assigned' = only clients listed in plan_access.
create table if not exists public.plans (
  id          text primary key,
  coach_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  data        jsonb not null,
  published   boolean not null default true,
  visibility  text not null default 'all' check (visibility in ('all', 'assigned')),
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.plan_access (
  plan_id     text not null references public.plans (id) on delete cascade,
  client_id   uuid not null references public.profiles (id) on delete cascade,
  primary key (plan_id, client_id)
);

-- One-time invite codes a coach shares with a new client.
create table if not exists public.invites (
  code        text primary key,
  coach_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label       text,
  created_at  timestamptz not null default now(),
  used_by     uuid references public.profiles (id) on delete set null,
  used_at     timestamptz
);

-- Messages from coach to client.
create table if not exists public.coach_notes (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  client_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists coach_notes_client on public.coach_notes (client_id, created_at desc);

-- ---------- helper functions (security definer: they bypass row rules safely) ----------

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'coach');
$$;

create or replace function public.my_coach() returns uuid
language sql stable security definer set search_path = public as $$
  select coach_id from profiles where id = auth.uid();
$$;

create or replace function public.coaches(client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = client and coach_id = auth.uid());
$$;

-- Plan helpers (avoid policies on plans and plan_access referring to each other in a loop)
create or replace function public.owns_plan(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plans where id = pid and coach_id = auth.uid());
$$;
create or replace function public.has_plan_access(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from plan_access where plan_id = pid and client_id = auth.uid());
$$;

-- ---------- triggers ----------

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Server sets updated_at (the app's sync relies on server time).
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before insert or update on public.entries
  for each row execute function public.touch_updated_at();
drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before insert or update on public.plans
  for each row execute function public.touch_updated_at();

-- Nobody can promote themselves or pick their own coach by editing their profile.
-- Clients may change only their name / last_seen. A coach may change a client's
-- name, targets, or remove them (coach_id = null).
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('grit.bypass', true) = 'on' then return new; end if;
  new.id := old.id;
  new.email := old.email;
  new.role := old.role;
  new.created_at := old.created_at;
  if auth.uid() = old.id then
    -- editing yourself
    if old.role <> 'coach' then
      new.coach_id := old.coach_id;
      new.targets := old.targets;
    end if;
  else
    -- a coach editing their client
    if new.coach_id is not null and new.coach_id is distinct from old.coach_id then
      new.coach_id := old.coach_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------- row level security ----------

alter table public.profiles    enable row level security;
alter table public.entries     enable row level security;
alter table public.plans       enable row level security;
alter table public.plan_access enable row level security;
alter table public.invites     enable row level security;
alter table public.coach_notes enable row level security;

-- profiles
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or coach_id = auth.uid() or id = public.my_coach());
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid() or coach_id = auth.uid())
  with check (id = auth.uid() or coach_id = auth.uid());

-- entries: you own yours; your coach can read them
drop policy if exists "entries own" on public.entries;
create policy "entries own" on public.entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "entries coach read" on public.entries;
create policy "entries coach read" on public.entries for select to authenticated
  using (public.coaches(user_id));

-- plans
drop policy if exists "plans coach" on public.plans;
create policy "plans coach" on public.plans for all to authenticated
  using (coach_id = auth.uid() and public.is_coach())
  with check (coach_id = auth.uid() and public.is_coach());
drop policy if exists "plans client read" on public.plans;
create policy "plans client read" on public.plans for select to authenticated
  using (published and coach_id = public.my_coach() and (
    visibility = 'all' or public.has_plan_access(id)));

-- plan access
drop policy if exists "plan_access coach" on public.plan_access;
create policy "plan_access coach" on public.plan_access for all to authenticated
  using (public.owns_plan(plan_id) and public.coaches(client_id))
  with check (public.owns_plan(plan_id) and public.coaches(client_id));
drop policy if exists "plan_access client read" on public.plan_access;
create policy "plan_access client read" on public.plan_access for select to authenticated
  using (client_id = auth.uid());

-- invites (clients redeem through accept_invite(), never directly)
drop policy if exists "invites coach" on public.invites;
create policy "invites coach" on public.invites for all to authenticated
  using (coach_id = auth.uid() and public.is_coach())
  with check (coach_id = auth.uid() and public.is_coach());

-- coach notes
drop policy if exists "notes coach" on public.coach_notes;
create policy "notes coach" on public.coach_notes for all to authenticated
  using (coach_id = auth.uid() and public.coaches(client_id))
  with check (coach_id = auth.uid() and public.coaches(client_id));
drop policy if exists "notes client read" on public.coach_notes;
create policy "notes client read" on public.coach_notes for select to authenticated
  using (client_id = auth.uid());

-- ---------- actions the app calls ----------

-- Creates your profile if it's missing (e.g. you signed up before this schema was installed).
create or replace function public.ensure_profile() returns void
language sql security definer set search_path = public as $$
  insert into profiles (id, email)
  select u.id, u.email from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
$$;

-- Backfill profiles for anyone who signed up before this schema was installed.
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do nothing;

-- The first person to call this becomes the coach. After that it always fails.
create or replace function public.claim_coach() returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from profiles where role = 'coach') then
    raise exception 'A coach account already exists';
  end if;
  perform set_config('grit.bypass', 'on', true);
  update profiles set role = 'coach', coach_id = null where id = auth.uid();
  return 'coach';
end $$;

-- A client redeems an invite code and joins that coach's roster.
create or replace function public.accept_invite(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare inv invites; coach_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into inv from invites where code = upper(trim(p_code)) for update;
  if not found then raise exception 'That invite code is not valid'; end if;
  if inv.used_by is not null and inv.used_by <> auth.uid() then raise exception 'That invite code was already used'; end if;
  if exists (select 1 from profiles where id = auth.uid() and role = 'coach') then raise exception 'Coach accounts cannot join a roster'; end if;
  perform set_config('grit.bypass', 'on', true);
  update profiles set coach_id = inv.coach_id where id = auth.uid();
  update invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  select coalesce(full_name, email) into coach_name from profiles where id = inv.coach_id;
  return coach_name;
end $$;

-- Coach removes a client from their roster (the client keeps their own data).
create or replace function public.remove_client(p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_client and coach_id = auth.uid()) then
    raise exception 'Not your client';
  end if;
  perform set_config('grit.bypass', 'on', true);
  update profiles set coach_id = null, targets = null where id = p_client;
  delete from plan_access where client_id = p_client;
end $$;

-- Client marks coach notes as read.
create or replace function public.mark_notes_read() returns void
language sql security definer set search_path = public as $$
  update coach_notes set read_at = now() where client_id = auth.uid() and read_at is null;
$$;

-- Coach dashboard: one row per client with recent activity.
drop function if exists public.coach_overview();
create or replace function public.coach_overview()
returns table (
  client_id uuid, email text, full_name text, joined timestamptz, last_activity timestamptz,
  workouts_7d int, food_days_7d int, journal_days_7d int,
  last_weight numeric, last_weight_date text, prev_weight numeric, program jsonb, unread_notes int,
  nutrition jsonb, shared_photos int
)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, p.created_at,
    (select max(e.updated_at) from entries e where e.user_id = p.id),
    (select count(distinct e.data->>'date')::int from entries e where e.user_id = p.id and e.kind = 'workouts' and not e.deleted
       and (e.data->>'date') >= to_char(current_date - 6, 'YYYY-MM-DD')),
    (select count(distinct e.data->>'date')::int from entries e where e.user_id = p.id and e.kind = 'food' and not e.deleted
       and (e.data->>'date') >= to_char(current_date - 6, 'YYYY-MM-DD')),
    (select count(*)::int from entries e where e.user_id = p.id and e.kind = 'journal' and not e.deleted
       and (e.data->>'date') >= to_char(current_date - 6, 'YYYY-MM-DD')),
    w.weight, w.wdate, w2.weight,
    (select e.data->'program' from entries e where e.user_id = p.id and e.kind = 'program' and e.id = 'main' and not e.deleted),
    (select count(*)::int from coach_notes n where n.client_id = p.id and n.read_at is null),
    (select jsonb_build_object('profile', e.data->'profile') from entries e where e.user_id = p.id and e.kind = 'nutrition' and e.id = 'main' and not e.deleted),
    (select count(*)::int from entries e where e.user_id = p.id and e.kind = 'photo' and not e.deleted)
  from profiles p
  left join lateral (
    select (e.data->>'weight')::numeric as weight, e.data->>'date' as wdate from entries e
    where e.user_id = p.id and e.kind = 'body' and not e.deleted and e.data ? 'weight' and e.data->>'weight' is not null
    order by e.data->>'date' desc limit 1) w on true
  left join lateral (
    select (e.data->>'weight')::numeric as weight from entries e
    where e.user_id = p.id and e.kind = 'body' and not e.deleted and e.data->>'weight' is not null
      and (e.data->>'date') <= to_char(current_date - 7, 'YYYY-MM-DD')
    order by e.data->>'date' desc limit 1) w2 on true
  where p.coach_id = auth.uid() and public.is_coach()
  order by coalesce(p.full_name, p.email);
$$;

-- Lock down: only signed-in users can call the actions.
revoke all on function public.claim_coach() from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.mark_notes_read() from public, anon;
revoke all on function public.ensure_profile() from public, anon;
revoke all on function public.remove_client(uuid) from public, anon;
revoke all on function public.coach_overview() from public, anon;
grant execute on function public.claim_coach() to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.mark_notes_read() to authenticated;
grant execute on function public.ensure_profile() to authenticated;
grant execute on function public.remove_client(uuid) to authenticated;
grant execute on function public.coach_overview() to authenticated;

-- Table privileges for signed-in users (row rules above still apply). Nothing for anon.
grant select, insert, update, delete on public.entries, public.plans, public.plan_access, public.invites, public.coach_notes to authenticated;
grant select, update on public.profiles to authenticated;
revoke all on public.profiles, public.entries, public.plans, public.plan_access, public.invites, public.coach_notes from anon;

-- ---------- progress photos the client chose to share with their coach ----------
-- Private bucket; files live at <client id>/<photo id>.jpg. The client can add/remove their own;
-- their coach can view them. Nobody else can.
insert into storage.buckets (id, name, public) values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

create or replace function public.photo_owner(path text) returns uuid
language sql immutable as $$
  select case when split_part(path, '/', 1) ~ '^[0-9a-fA-F-]{36}$' then split_part(path, '/', 1)::uuid end;
$$;

drop policy if exists "progress photos own" on storage.objects;
create policy "progress photos own" on storage.objects for all to authenticated
  using (bucket_id = 'progress-photos' and public.photo_owner(name) = auth.uid())
  with check (bucket_id = 'progress-photos' and public.photo_owner(name) = auth.uid());
drop policy if exists "progress photos coach read" on storage.objects;
create policy "progress photos coach read" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and public.coaches(public.photo_owner(name)));

-- ---------- recipe library (coach) ----------
create table if not exists public.recipes (
  id          text primary key,
  coach_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  data        jsonb not null,
  published   boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.recipes enable row level security;
drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before insert or update on public.recipes
  for each row execute function public.touch_updated_at();
drop policy if exists "recipes coach" on public.recipes;
create policy "recipes coach" on public.recipes for all to authenticated
  using (coach_id = auth.uid() and public.is_coach())
  with check (coach_id = auth.uid() and public.is_coach());
drop policy if exists "recipes client read" on public.recipes;
create policy "recipes client read" on public.recipes for select to authenticated
  using (published and coach_id = public.my_coach());
grant select, insert, update, delete on public.recipes to authenticated;
revoke all on public.recipes from anon;
