-- Miles Apart, Still Us: persistent accounts, room membership, event history and photos.
-- Run once in Supabase SQL Editor as project owner.

create extension if not exists pgcrypto;

create table if not exists public.couple_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{4,24}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.couple_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.couple_rooms(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists room_events_room_id_id_idx on public.room_events(room_id, id);

create table if not exists public.scrapbook_photos (
  id text primary key,
  room_id uuid not null references public.couple_rooms(id) on delete cascade,
  storage_path text not null unique,
  caption text not null default '',
  date_label text not null default '',
  rotation double precision not null default 0,
  position jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists scrapbook_photos_room_id_created_at_idx on public.scrapbook_photos(room_id, created_at);

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create or replace function public.create_couple_room(p_code text, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare new_room_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if p_code !~ '^[A-Z0-9-]{4,24}$' then raise exception 'Room code must be 4–24 letters or numbers.'; end if;
  if length(trim(p_display_name)) not between 1 and 24 then raise exception 'Name must be 1–24 characters.'; end if;

  insert into public.couple_rooms(code, created_by)
  values (upper(p_code), auth.uid())
  returning id into new_room_id;

  insert into public.room_members(room_id, user_id, display_name)
  values (new_room_id, auth.uid(), trim(p_display_name));

  return new_room_id;
end;
$$;

create or replace function public.join_couple_room(p_code text, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare target_room_id uuid; member_count integer;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if length(trim(p_display_name)) not between 1 and 24 then raise exception 'Name must be 1–24 characters.'; end if;

  select id into target_room_id from public.couple_rooms where code = upper(trim(p_code));
  if target_room_id is null then raise exception 'Room not found. Check the invite code.'; end if;

  select count(*) into member_count from public.room_members where room_id = target_room_id;
  if not exists (
    select 1 from public.room_members where room_id = target_room_id and user_id = auth.uid()
  ) and member_count >= 2 then
    raise exception 'This room already has two members.';
  end if;

  insert into public.room_members(room_id, user_id, display_name)
  values (target_room_id, auth.uid(), trim(p_display_name))
  on conflict (room_id, user_id) do update set display_name = excluded.display_name;

  return target_room_id;
end;
$$;

revoke all on function public.create_couple_room(text,text) from public;
revoke all on function public.join_couple_room(text,text) from public;
grant execute on function public.create_couple_room(text,text) to authenticated;
grant execute on function public.join_couple_room(text,text) to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;

alter table public.couple_rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_events enable row level security;
alter table public.scrapbook_photos enable row level security;

drop policy if exists "members can view their rooms" on public.couple_rooms;
create policy "members can view their rooms" on public.couple_rooms
for select to authenticated using (public.is_room_member(id));

drop policy if exists "members can view room members" on public.room_members;
create policy "members can view room members" on public.room_members
for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "members can read room events" on public.room_events;
create policy "members can read room events" on public.room_events
for select to authenticated using (public.is_room_member(room_id));
drop policy if exists "members can add room events" on public.room_events;
create policy "members can add room events" on public.room_events
for insert to authenticated with check (public.is_room_member(room_id) and created_by = auth.uid());

drop policy if exists "members can read scrapbook photos" on public.scrapbook_photos;
create policy "members can read scrapbook photos" on public.scrapbook_photos
for select to authenticated using (public.is_room_member(room_id));
drop policy if exists "members can add scrapbook photos" on public.scrapbook_photos;
create policy "members can add scrapbook photos" on public.scrapbook_photos
for insert to authenticated with check (public.is_room_member(room_id) and created_by = auth.uid());
drop policy if exists "members can update scrapbook photos" on public.scrapbook_photos;
create policy "members can update scrapbook photos" on public.scrapbook_photos
for update to authenticated using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
drop policy if exists "members can delete scrapbook photos" on public.scrapbook_photos;
create policy "members can delete scrapbook photos" on public.scrapbook_photos
for delete to authenticated using (public.is_room_member(room_id));


-- Table privileges are required in addition to RLS policies.
grant select on public.couple_rooms to authenticated;
grant select on public.room_members to authenticated;
grant select, insert on public.room_events to authenticated;
grant select, insert, update, delete on public.scrapbook_photos to authenticated;
grant usage, select on sequence public.room_events_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ldr-memories', 'ldr-memories', false, 5242880, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "room members can read memory files" on storage.objects;
create policy "room members can read memory files" on storage.objects
for select to authenticated using (
  bucket_id = 'ldr-memories'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "room members can upload memory files" on storage.objects;
create policy "room members can upload memory files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'ldr-memories'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "room members can update memory files" on storage.objects;
create policy "room members can update memory files" on storage.objects
for update to authenticated using (
  bucket_id = 'ldr-memories'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
) with check (
  bucket_id = 'ldr-memories'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);
drop policy if exists "room members can delete memory files" on storage.objects;
create policy "room members can delete memory files" on storage.objects
for delete to authenticated using (
  bucket_id = 'ldr-memories'
  and public.is_room_member(((storage.foldername(name))[1])::uuid)
);
