-- MagTile Arcade content (Phase 6).
--
-- Supabase is the canonical store for APPROVED Arcade content. Devices never read these tables
-- directly during play: they fetch one tiny manifest and a few immutable JSON packs from the public
-- Storage bucket `packs` (at most once per 24 h per device), then play entirely offline.
--
-- What is public (read only, anon):   published pack metadata, and objects in the `packs` bucket.
-- What is private (service role only): content items (including drafts and provenance), import runs,
--                                      import cursors and import controls.
-- Nothing here stores per-player data: no accounts, progress, scores, roles, boards or answers.
--
-- NOT applied to the hosted project by the agent that wrote it. Review and apply deliberately:
--   npx supabase db push --linked   (hosted)    |   npx supabase db reset   (local only)

-- ---------------------------------------------------------------------------------------------
-- Review status for content items.
create type public.content_review_status as enum ('draft', 'approved', 'retired');

-- ---------------------------------------------------------------------------------------------
-- Approved content items: stable id, pack, category, structured payload, provenance and licence.
create table public.content_items (
  id             text primary key check (id ~ '^[a-z0-9-]+:[a-z0-9-]+:[0-9]+$'),
  pack_key       text not null check (pack_key in ('trivia', 'words', 'charades')),
  category       text not null check (category ~ '^[a-z0-9-]{1,24}$'),
  language       text not null default 'en' check (length(language) between 2 and 8),
  difficulty     smallint check (difficulty between 1 and 5),
  payload        jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  -- Provenance and licence: required before an item can be approved.
  source         text not null,
  licence        text not null,
  attribution    text,
  source_url     text,
  review_status  public.content_review_status not null default 'draft',
  reviewed_by    text,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint approved_items_need_provenance
    check (review_status <> 'approved' or (length(source) > 0 and length(licence) > 0 and reviewed_at is not null))
);

create index content_items_pack_status_idx on public.content_items (pack_key, review_status);

-- ---------------------------------------------------------------------------------------------
-- Immutable published packs. A new publication is a new (pack_key, version) row; rows are never
-- edited or deleted. A faulty pack can only be withdrawn (status published -> withdrawn).
create table public.content_packs (
  pack_key         text    not null check (pack_key in ('trivia', 'words', 'charades')),
  -- Version 1 is the starter set bundled in the app, so published versions start at 2.
  version          integer not null check (version >= 2),
  schema_version   integer not null check (schema_version >= 1),
  item_count       integer not null check (item_count between 1 and 1000),
  -- Size of the file the device downloads. Budget: 512 KiB per pack.
  byte_size        integer not null check (byte_size between 1 and 524288),
  gzip_size        integer not null check (gzip_size between 1 and 524288),
  checksum_sha256  text    not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- Object path inside the `packs` bucket, e.g. 'trivia-v2.json'.
  artifact_path    text    not null check (artifact_path ~ '^[a-z0-9-]+-v[0-9]+\.json$'),
  -- Credits shown in the app's Credits view: [{source, licence, attribution, url}].
  credits          jsonb   not null default '[]'::jsonb check (jsonb_typeof(credits) = 'array'),
  status           text    not null default 'published' check (status in ('published', 'withdrawn')),
  published_at     timestamptz not null default now(),
  primary key (pack_key, version),
  unique (artifact_path)
);

create function public.content_packs_guard() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'content_packs rows are immutable and cannot be deleted';
  end if;
  -- Only a published pack may be withdrawn; every other column is frozen.
  if new.pack_key is distinct from old.pack_key
     or new.version is distinct from old.version
     or new.schema_version is distinct from old.schema_version
     or new.item_count is distinct from old.item_count
     or new.byte_size is distinct from old.byte_size
     or new.gzip_size is distinct from old.gzip_size
     or new.checksum_sha256 is distinct from old.checksum_sha256
     or new.artifact_path is distinct from old.artifact_path
     or new.credits is distinct from old.credits
     or new.published_at is distinct from old.published_at then
    raise exception 'content_packs rows are immutable (only status may change)';
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'a withdrawn pack cannot be re-published; publish a new version';
  end if;
  return new;
end;
$$;

create trigger content_packs_guard_trg
  before update or delete on public.content_packs
  for each row execute function public.content_packs_guard();

-- Public catalogue: only the newest published version of each pack. Never drafts or import data.
create view public.content_catalog
with (security_invoker = true) as
select distinct on (pack_key)
       pack_key, version, schema_version, item_count, byte_size, gzip_size, checksum_sha256, artifact_path, published_at
from public.content_packs
where status = 'published'
order by pack_key, version desc;

-- ---------------------------------------------------------------------------------------------
-- Server/admin-only import bookkeeping. No device ever touches these.
create table public.content_import_controls (
  -- Single row. Imports are OFF until an owner turns them on (fail closed).
  id                 boolean primary key default true check (id),
  imports_enabled    boolean not null default false,
  max_requests_run   integer not null default 50   check (max_requests_run   between 0 and 1000),
  max_records_run    integer not null default 500  check (max_records_run    between 0 and 10000),
  max_seconds_run    integer not null default 120  check (max_seconds_run    between 1 and 900),
  updated_at         timestamptz not null default now()
);
insert into public.content_import_controls (id) values (true) on conflict do nothing;

create table public.content_import_cursors (
  source      text primary key,
  cursor      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table public.content_import_runs (
  id             bigint generated always as identity primary key,
  source         text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  requests_made  integer not null default 0,
  records_seen   integer not null default 0,
  records_added  integer not null default 0,
  failure        text
);

-- ---------------------------------------------------------------------------------------------
-- Row level security. Default deny; the only anon/authenticated access is read-only published packs.
alter table public.content_items           enable row level security;
alter table public.content_packs           enable row level security;
alter table public.content_import_controls enable row level security;
alter table public.content_import_cursors  enable row level security;
alter table public.content_import_runs     enable row level security;

revoke all on public.content_items           from anon, authenticated;
revoke all on public.content_packs           from anon, authenticated;
revoke all on public.content_import_controls from anon, authenticated;
revoke all on public.content_import_cursors  from anon, authenticated;
revoke all on public.content_import_runs     from anon, authenticated;
revoke all on public.content_catalog         from anon, authenticated;

grant select on public.content_packs   to anon, authenticated;
grant select on public.content_catalog to anon, authenticated;

create policy content_packs_public_read
  on public.content_packs for select to anon, authenticated
  using (status = 'published');

-- No other policies exist: content_items, import controls, cursors and runs are readable and
-- writable only with the service role (which bypasses RLS). Pack rows are inserted only by the
-- publish tool with the service role.

-- ---------------------------------------------------------------------------------------------
-- Public Storage bucket for the manifest and the immutable pack files.
-- Read: anyone (public bucket). Write: service role only (no insert/update/delete policies).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('packs', 'packs', true, 524288, array['application/json'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "packs bucket public read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'packs');
