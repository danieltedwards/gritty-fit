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

-- ---------- chat between coach and client ----------
-- One conversation per client (client_id). Both the client and their coach can read it and post to it.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.profiles (id) on delete cascade,
  sender_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists messages_thread on public.messages (client_id, created_at);
alter table public.messages enable row level security;

-- who may take part in a client's conversation: the client, or the client's coach
create or replace function public.in_chat(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_client = auth.uid() and exists (select 1 from profiles where id = auth.uid() and coach_id is not null)
      or exists (select 1 from profiles where id = p_client and coach_id = auth.uid());
$$;

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated
  using (public.in_chat(client_id));
drop policy if exists "messages send" on public.messages;
create policy "messages send" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and read_at is null and public.in_chat(client_id));
drop policy if exists "messages delete own" on public.messages;
create policy "messages delete own" on public.messages for delete to authenticated
  using (sender_id = auth.uid());
grant select, insert, delete on public.messages to authenticated;
revoke all on public.messages from anon;

-- mark the other person's messages in a conversation as read
create or replace function public.mark_chat_read(p_client uuid) returns void
language sql security definer set search_path = public as $$
  update messages set read_at = now()
  where client_id = p_client and sender_id <> auth.uid() and read_at is null and public.in_chat(p_client);
$$;

-- unread counts and latest message per conversation, for the caller
create or replace function public.chat_summary()
returns table (client_id uuid, unread bigint, last_body text, last_at timestamptz, last_sender uuid)
language sql stable security definer set search_path = public as $$
  select m.client_id,
         count(*) filter (where m.sender_id <> auth.uid() and m.read_at is null),
         (array_agg(m.body order by m.created_at desc))[1],
         max(m.created_at),
         (array_agg(m.sender_id order by m.created_at desc))[1]
  from messages m
  where public.in_chat(m.client_id)
  group by m.client_id;
$$;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.chat_summary() from public, anon;
revoke all on function public.in_chat(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.chat_summary() to authenticated;
grant execute on function public.in_chat(uuid) to authenticated;

-- =====================================================================
-- Notifications: in-app inbox, phone (web push) delivery and reminders
-- =====================================================================

-- One row per notification shown in a person's bell. Created only by the triggers and the
-- reminder job below (never directly by the app).
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('chat', 'note', 'plan', 'nutrition', 'recipe', 'reminder')),
  title       text not null,
  body        text,
  link        jsonb,                 -- where tapping it goes, e.g. {"tab":"chat"}
  grp         text,                  -- groups bursts (e.g. many plans uploaded at once) into one row
  count       int not null default 1,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications own delete" on public.notifications;
create policy "notifications own delete" on public.notifications for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.notifications to authenticated;
revoke all on public.notifications from anon;

-- Each phone/browser that allowed notifications
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  ua          text,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;

-- Each person's notification settings and reminders
create table if not exists public.notify_prefs (
  user_id     uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  types       jsonb not null default '{"chat":true,"note":true,"plan":true,"nutrition":true,"recipe":true,"reminder":true}',
  quiet_start text,                  -- 'HH:MM' local time, no phone alerts from here…
  quiet_end   text,                  -- …until here (alerts still land in the bell)
  tz          text not null default 'America/New_York',
  reminders   jsonb not null default '[]',   -- [{"type":"food","on":true,"time":"20:00","days":[1,2,3,4,5,6,7]}, …]
  sent        jsonb not null default '{}',   -- {"food":"2026-11-04", …} last local day each reminder went out
  updated_at  timestamptz not null default now()
);
alter table public.notify_prefs enable row level security;
drop policy if exists "prefs own" on public.notify_prefs;
create policy "prefs own" on public.notify_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.notify_prefs to authenticated;
revoke all on public.notify_prefs from anon;

-- mark read
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- create (or, for a burst with the same group within 6 hours, update) a notification
create or replace function public.grit_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link jsonb, p_grp text default null, p_many_title text default null)
returns void language plpgsql security definer set search_path = public as $$
declare existing notifications%rowtype;
begin
  if p_user is null then return; end if;
  if p_grp is not null then
    select * into existing from notifications
      where user_id = p_user and grp = p_grp and read_at is null and created_at > now() - interval '6 hours'
      order by created_at desc limit 1;
    if found then
      update notifications set count = existing.count + 1,
        title = coalesce(replace(p_many_title, '{n}', (existing.count + 1)::text), p_title), body = p_body
        where id = existing.id;
      return;
    end if;
  end if;
  insert into notifications (user_id, kind, title, body, link, grp) values (p_user, p_kind, p_title, p_body, p_link, p_grp);
end;
$$;
revoke all on function public.grit_notify(uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;

-- display name helper
create or replace function public.display_name(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), split_part(email, '@', 1), 'Someone') from profiles where id = p;
$$;

-- ---------- triggers: coach and client actions create notifications ----------
create or replace function public.on_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare to_user uuid;
begin
  if new.sender_id = new.client_id then select coach_id into to_user from profiles where id = new.client_id;
  else to_user := new.client_id; end if;
  perform grit_notify(to_user, 'chat', display_name(new.sender_id), left(new.body, 160),
    jsonb_build_object('tab', 'chat', 'client', new.client_id), 'chat:' || new.client_id, display_name(new.sender_id) || ' ({n} messages)');
  return new;
end;
$$;
drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages for each row execute function public.on_message_notify();

create or replace function public.on_note_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform grit_notify(new.client_id, 'note', 'Note from your coach', left(new.body, 160), jsonb_build_object('tab', 'today'));
  return new;
end;
$$;
drop trigger if exists coach_notes_notify on public.coach_notes;
create trigger coach_notes_notify after insert on public.coach_notes for each row execute function public.on_note_notify();

create or replace function public.on_plan_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; nm text := coalesce(new.data->>'name', 'a new plan'); fc uuid;
begin
  if not new.published then return new; end if;
  if tg_op = 'UPDATE' and old.published and old.data->>'forClient' is not distinct from new.data->>'forClient' then return new; end if;
  begin fc := nullif(new.data->>'forClient', '')::uuid; exception when others then fc := null; end;
  if fc is not null then
    perform grit_notify(fc, 'plan', 'Your coach made a plan for you', nm, jsonb_build_object('tab', 'guide', 'id', new.id));
  elsif new.visibility = 'all' then
    for c in select id from profiles where coach_id = new.coach_id loop
      perform grit_notify(c.id, 'plan', 'New plan from your coach', nm, jsonb_build_object('tab', 'plans'), 'library', '{n} new plans from your coach');
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists plans_notify on public.plans;
create trigger plans_notify after insert or update of published, data on public.plans for each row execute function public.on_plan_notify();

create or replace function public.on_plan_access_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform grit_notify(new.client_id, 'plan', 'Your coach shared a plan with you',
    (select data->>'name' from plans where id = new.plan_id), jsonb_build_object('tab', 'plans'), 'library', '{n} new plans from your coach');
  return new;
end;
$$;
drop trigger if exists plan_access_notify on public.plan_access;
create trigger plan_access_notify after insert on public.plan_access for each row execute function public.on_plan_access_notify();

create or replace function public.on_recipe_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not new.published then return new; end if;
  if tg_op = 'UPDATE' and old.published then return new; end if;
  for c in select id from profiles where coach_id = new.coach_id loop
    perform grit_notify(c.id, 'recipe', 'New recipe from your coach', coalesce(new.data->>'name', 'A new recipe'), jsonb_build_object('tab', 'food'), 'recipes', '{n} new recipes from your coach');
  end loop;
  return new;
end;
$$;
drop trigger if exists recipes_notify on public.recipes;
create trigger recipes_notify after insert or update of published on public.recipes for each row execute function public.on_recipe_notify();

create or replace function public.on_targets_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.targets is distinct from old.targets and new.targets is not null and auth.uid() is distinct from new.id then
    perform grit_notify(new.id, 'nutrition', 'Your coach updated your targets', 'Calories, macros or training targets changed. Tap to see today''s numbers.', jsonb_build_object('tab', 'food'), 'targets');
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_targets_notify on public.profiles;
create trigger profiles_targets_notify after update of targets on public.profiles for each row execute function public.on_targets_notify();

-- ---------- reminders (run every 15 minutes by pg_cron) ----------
create or replace function public.run_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare p record; r jsonb; loc timestamp; d text; mins int; dow int; t int; typ text; n int := 0;
  title text; body text; link jsonb; done boolean; habits_total int; habits_done int; pname text;
begin
  for p in select * from notify_prefs where jsonb_array_length(reminders) > 0 and coalesce((types->>'reminder')::boolean, true) loop
    begin loc := now() at time zone p.tz; exception when others then loc := now() at time zone 'America/New_York'; end;
    d := to_char(loc, 'YYYY-MM-DD'); mins := extract(hour from loc)::int * 60 + extract(minute from loc)::int; dow := extract(isodow from loc)::int;
    for r in select * from jsonb_array_elements(p.reminders) loop
      typ := r->>'type';
      continue when not coalesce((r->>'on')::boolean, false) or typ is null or r->>'time' is null;
      continue when r ? 'days' and jsonb_typeof(r->'days') = 'array' and jsonb_array_length(r->'days') > 0 and not (r->'days' @> to_jsonb(dow));
      t := split_part(r->>'time', ':', 1)::int * 60 + split_part(r->>'time', ':', 2)::int;
      continue when mins < t or mins >= t + 30;            -- due in this half hour
      continue when p.sent->>typ = d;                       -- already sent today
      done := false; title := null; body := null; link := null;
      if typ = 'food' then
        select exists (select 1 from entries where user_id = p.user_id and kind = 'food' and not deleted and data->>'date' = d) into done;
        title := 'Log today''s food'; body := 'Nothing logged yet today. Two minutes now keeps you on track.'; link := '{"tab":"food"}';
      elsif typ = 'workout' then
        select exists (select 1 from entries where user_id = p.user_id and kind = 'workouts' and not deleted and data->>'date' = d) into done;
        select pl.data->>'name' into pname from entries e join plans pl on pl.id = e.data->'programs'->0->>'planId'
          where e.user_id = p.user_id and e.kind = 'program' and e.id = 'main' limit 1;
        title := 'Workout day 💪'; body := case when pname is not null then 'Time to train: ' || pname || '.' else 'Time to get your workout in.' end; link := '{"tab":"train"}';
      elsif typ = 'weigh' then
        select exists (select 1 from entries where user_id = p.user_id and kind = 'body' and not deleted and data->>'date' = d) into done;
        title := 'Weigh-in day'; body := 'Step on the scale and log it. Same time, same conditions.'; link := '{"tab":"body"}';
      elsif typ = 'habits' then
        select count(*) into habits_total from entries where user_id = p.user_id and kind = 'habits' and not deleted;
        select coalesce(jsonb_array_length(data->'ids'), 0) into habits_done from entries where user_id = p.user_id and kind = 'habitday' and id = d and not deleted;
        habits_done := coalesce(habits_done, 0);
        done := habits_total > 0 and habits_done >= habits_total;
        title := 'Daily habits'; body := case when habits_total > 0 then habits_done || ' of ' || habits_total || ' habits done today. Finish strong.' else 'Check off today''s habits.' end; link := '{"tab":"today"}';
      elsif typ = 'journal' then
        select exists (select 1 from entries where user_id = p.user_id and kind = 'journal' and not deleted and data->>'date' = d) into done;
        title := 'Daily check-in'; body := 'How did today go? Two minutes, be honest.'; link := '{"tab":"journal"}';
      elsif typ = 'water' then
        title := 'Water check'; body := 'Grab a glass of water.'; link := '{"tab":"today"}';
      else continue;
      end if;
      update notify_prefs set sent = sent || jsonb_build_object(typ, d) where user_id = p.user_id;
      if not done then
        insert into notifications (user_id, kind, title, body, link, grp) values (p.user_id, 'reminder', title, body, link, null);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.run_reminders() from public, anon, authenticated;

-- schedule it (pg_cron is available on every Supabase plan; skipped quietly where it isn't installed)
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron not available: %', sqlerrm; end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'grit-reminders';
    perform cron.schedule('grit-reminders', '*/15 * * * *', 'select public.run_reminders()');
  end if;
end $$;

-- "Send a test" button in notification settings
create or replace function public.notify_test() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into notifications (user_id, kind, title, body, link) values (auth.uid(), 'reminder', 'Test notification 🔔', 'Notifications are working on this device.', '{"tab":"inbox"}');
end;
$$;
revoke all on function public.notify_test() from public, anon;
grant execute on function public.notify_test() to authenticated;

-- Small app-wide settings the app can read (e.g. the public web-push key). Only the coach can change them.
create table if not exists public.app_config (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists "app_config read" on public.app_config;
create policy "app_config read" on public.app_config for select to authenticated using (true);
grant select on public.app_config to authenticated;
revoke all on public.app_config from anon;
create or replace function public.set_app_config(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Only the coach can change app settings'; end if;
  insert into app_config (key, value, updated_at) values (p_key, p_value, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;
revoke all on function public.set_app_config(text, text) from public, anon;
grant execute on function public.set_app_config(text, text) to authenticated;

-- =====================================================================
-- One-off workouts the coach sends a client (outside their normal plan)
-- =====================================================================
create table if not exists public.assigned_workouts (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  client_id   uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (length(title) between 1 and 120),
  day         jsonb not null,          -- same shape as a plan day: {name, blocks:[…], instructions, …}
  note        text,
  for_date    date,                    -- null = any day
  replaces    jsonb,                   -- {"planId":…, "dayId":…, "label":…} when it counts as a plan day
  status      text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  done_at     timestamptz,
  workout_id  text,
  created_at  timestamptz not null default now()
);
create index if not exists assigned_client on public.assigned_workouts (client_id, created_at desc);
alter table public.assigned_workouts enable row level security;
drop policy if exists "assigned coach" on public.assigned_workouts;
create policy "assigned coach" on public.assigned_workouts for all to authenticated
  using (coach_id = auth.uid() and public.coaches(client_id))
  with check (coach_id = auth.uid() and public.coaches(client_id));
drop policy if exists "assigned client read" on public.assigned_workouts;
create policy "assigned client read" on public.assigned_workouts for select to authenticated
  using (client_id = auth.uid());
grant select, insert, update, delete on public.assigned_workouts to authenticated;
revoke all on public.assigned_workouts from anon;

-- the client marks one done (with the logged workout's id) or skips it
create or replace function public.finish_assigned(p_id uuid, p_status text, p_workout text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('done', 'skipped', 'pending') then raise exception 'bad status'; end if;
  update assigned_workouts set status = p_status, done_at = case when p_status = 'pending' then null else now() end,
    workout_id = case when p_status = 'done' then p_workout else null end
  where id = p_id and client_id = auth.uid();
end;
$$;
revoke all on function public.finish_assigned(uuid, text, text) from public, anon;
grant execute on function public.finish_assigned(uuid, text, text) to authenticated;

-- notify the client when a workout arrives, and the coach when it's done
create or replace function public.on_assigned_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform grit_notify(new.client_id, 'plan', 'Your coach sent you a workout',
      new.title || case when new.for_date is not null then ' · ' || to_char(new.for_date, 'Dy Mon DD') else '' end,
      jsonb_build_object('tab', 'train'));
  elsif new.status = 'done' and old.status is distinct from 'done' then
    perform grit_notify(new.coach_id, 'plan', display_name(new.client_id) || ' finished a workout', new.title, jsonb_build_object('tab', 'coach'));
  end if;
  return new;
end;
$$;
drop trigger if exists assigned_notify on public.assigned_workouts;
create trigger assigned_notify after insert or update of status on public.assigned_workouts for each row execute function public.on_assigned_notify();

-- =====================================================================
-- AI plan imports (PDF / Word / Excel / photo → GRIT plan), handled by the import-plan Edge Function
-- =====================================================================
create table if not exists public.plan_imports (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  filename    text,
  notes       text,
  status      text not null default 'processing' check (status in ('processing', 'done', 'error', 'used')),
  batch_id    text,
  result      jsonb,
  error       text,
  tokens      int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists plan_imports_coach on public.plan_imports (coach_id, created_at desc);
alter table public.plan_imports enable row level security;
drop policy if exists "imports coach" on public.plan_imports;
create policy "imports coach" on public.plan_imports for select to authenticated using (coach_id = auth.uid());
drop policy if exists "imports coach delete" on public.plan_imports;
create policy "imports coach delete" on public.plan_imports for delete to authenticated using (coach_id = auth.uid());
drop policy if exists "imports coach update" on public.plan_imports;
create policy "imports coach update" on public.plan_imports for update to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
grant select, update, delete on public.plan_imports to authenticated;
revoke all on public.plan_imports from anon;
