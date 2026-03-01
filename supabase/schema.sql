-- Sticker voter schema for Supabase
-- Implements:
-- - Admin-created polls with sticker designs
-- - Up to N votes per user per poll (default 8)
-- - Manual close and time-window close

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'user')) default 'user',
  created_at timestamptz not null default now()
);

comment on table public.user_roles is 'App-level roles for authorization.';

-- Helper: checks if current auth user is admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Polls and options
-- ---------------------------------------------------------------------------
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null check (status in ('draft', 'open', 'closed')) default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  max_votes_per_user integer not null default 8 check (max_votes_per_user > 0 and max_votes_per_user <= 100),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);

comment on table public.polls is 'Voting polls. status can close manually; starts_at/ends_at close by time.';

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  title text,
  image_path text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_poll_options_poll_id on public.poll_options (poll_id);

comment on table public.poll_options is 'Sticker design choices for each poll.';

-- ---------------------------------------------------------------------------
-- Votes
-- ---------------------------------------------------------------------------
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_id uuid not null references public.poll_options (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (poll_id, option_id, user_id)
);

create index if not exists idx_votes_poll_user on public.votes (poll_id, user_id);
create index if not exists idx_votes_poll_option on public.votes (poll_id, option_id);

comment on table public.votes is 'One row per user selection. Up to max_votes_per_user per poll.';

-- Keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_polls_updated_at on public.polls;
create trigger trg_polls_updated_at
before update on public.polls
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Poll state helpers
-- ---------------------------------------------------------------------------
create or replace function public.poll_is_open(p public.polls)
returns boolean
language sql
stable
as $$
  select
    p.status = 'open'
    and (p.starts_at is null or now() >= p.starts_at)
    and (p.ends_at is null or now() < p.ends_at);
$$;

-- ---------------------------------------------------------------------------
-- RPC: atomically set a user's selected options for a poll
-- Rules enforced:
-- - Auth required
-- - Poll must be open and in time window
-- - Each option must belong to poll
-- - Up to poll.max_votes_per_user selections
-- - Replaces previous selections atomically
-- ---------------------------------------------------------------------------
create or replace function public.set_poll_votes(
  p_poll_id uuid,
  p_option_ids uuid[]
)
returns table (saved_votes integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_poll public.polls%rowtype;
  v_requested_count integer;
  v_distinct_count integer;
  v_valid_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_poll
  from public.polls
  where id = p_poll_id;

  if not found then
    raise exception 'Poll not found';
  end if;

  if not public.poll_is_open(v_poll) then
    raise exception 'Poll is not open';
  end if;

  if p_option_ids is null then
    p_option_ids := '{}';
  end if;

  v_requested_count := coalesce(array_length(p_option_ids, 1), 0);

  if v_requested_count = 0 then
    -- Allow clearing votes while poll is open.
    delete from public.votes
    where poll_id = p_poll_id
      and user_id = v_user_id;

    return query select 0;
    return;
  end if;

  -- De-dup client array and validate maximum.
  select count(*) into v_distinct_count
  from (
    select distinct unnest(p_option_ids)
  ) d;

  if v_distinct_count > v_poll.max_votes_per_user then
    raise exception 'Maximum % votes allowed for this poll', v_poll.max_votes_per_user;
  end if;

  -- Validate that all options belong to this poll.
  select count(*) into v_valid_count
  from public.poll_options o
  join (
    select distinct unnest(p_option_ids) as option_id
  ) ids on ids.option_id = o.id
  where o.poll_id = p_poll_id;

  if v_valid_count <> v_distinct_count then
    raise exception 'One or more selected options are invalid for this poll';
  end if;

  -- Replace user selections atomically.
  delete from public.votes
  where poll_id = p_poll_id
    and user_id = v_user_id;

  insert into public.votes (poll_id, option_id, user_id)
  select p_poll_id, ids.option_id, v_user_id
  from (
    select distinct unnest(p_option_ids) as option_id
  ) ids;

  return query select v_distinct_count;
end;
$$;

revoke all on function public.set_poll_votes(uuid, uuid[]) from public;
grant execute on function public.set_poll_votes(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.user_roles enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.votes enable row level security;

-- user_roles
-- Only admins manage roles. Users can read their own role row.
drop policy if exists user_roles_select_self on public.user_roles;
create policy user_roles_select_self
on public.user_roles
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists user_roles_admin_manage on public.user_roles;
create policy user_roles_admin_manage
on public.user_roles
for all
using (public.is_admin())
with check (public.is_admin());

-- polls
-- Anyone can read open polls in window; admins can read all and manage.
drop policy if exists polls_select_public_or_admin on public.polls;
create policy polls_select_public_or_admin
on public.polls
for select
using (
  public.is_admin()
  or public.poll_is_open(polls)
);

drop policy if exists polls_admin_manage on public.polls;
create policy polls_admin_manage
on public.polls
for all
using (public.is_admin())
with check (public.is_admin());

-- poll_options
-- Public read options for readable polls; admin manage all.
drop policy if exists poll_options_select_public_or_admin on public.poll_options;
create policy poll_options_select_public_or_admin
on public.poll_options
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.polls p
    where p.id = poll_options.poll_id
      and public.poll_is_open(p)
  )
);

drop policy if exists poll_options_admin_manage on public.poll_options;
create policy poll_options_admin_manage
on public.poll_options
for all
using (public.is_admin())
with check (public.is_admin());

-- votes
-- Public can read votes for polls they can read (for result display).
-- Authenticated users cannot write directly; they must use RPC.
drop policy if exists votes_select_public_or_admin on public.votes;
create policy votes_select_public_or_admin
on public.votes
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.polls p
    where p.id = votes.poll_id
      and (public.poll_is_open(p) or p.status = 'closed')
  )
);

-- Optional: allow users to see their own rows even on draft polls.
drop policy if exists votes_select_own on public.votes;
create policy votes_select_own
on public.votes
for select
using (user_id = auth.uid());

-- Deny direct insert/update/delete via RLS by omitting those policies.

-- ---------------------------------------------------------------------------
-- Storage (option-images bucket)
-- Run this section in Supabase SQL editor once storage is enabled.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('option-images', 'option-images', true)
on conflict (id) do nothing;

-- Public read images
drop policy if exists option_images_public_read on storage.objects;
create policy option_images_public_read
on storage.objects
for select
using (bucket_id = 'option-images');

-- Admin upload/update/delete images
drop policy if exists option_images_admin_insert on storage.objects;
create policy option_images_admin_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'option-images' and public.is_admin());

drop policy if exists option_images_admin_update on storage.objects;
create policy option_images_admin_update
on storage.objects
for update
to authenticated
using (bucket_id = 'option-images' and public.is_admin())
with check (bucket_id = 'option-images' and public.is_admin());

drop policy if exists option_images_admin_delete on storage.objects;
create policy option_images_admin_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'option-images' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Useful view for results
-- ---------------------------------------------------------------------------
create or replace view public.poll_option_results as
select
  o.poll_id,
  o.id as option_id,
  o.title,
  o.image_path,
  o.display_order,
  count(v.id)::int as vote_count
from public.poll_options o
left join public.votes v
  on v.option_id = o.id
group by o.poll_id, o.id, o.title, o.image_path, o.display_order;

grant select on public.poll_option_results to anon, authenticated;

