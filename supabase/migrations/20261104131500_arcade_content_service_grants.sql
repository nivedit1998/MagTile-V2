-- Hosted Supabase projects do not give the service role default privileges on newly created tables
-- (a local stack does), so the publish tool failed with "permission denied" on the first hosted run.
-- Grant exactly what the admin/publish tool needs, to the service role only. anon and authenticated
-- keep their read-only access from the previous migration and gain nothing here.

grant select, insert, update on public.content_items           to service_role;
grant select, insert, update on public.content_packs           to service_role;
grant select, update         on public.content_import_controls to service_role;
grant select, insert, update on public.content_import_cursors  to service_role;
grant select, insert, update on public.content_import_runs     to service_role;
grant usage, select on sequence public.content_import_runs_id_seq to service_role;
grant select on public.content_catalog to service_role;
-- Deliberately no DELETE on content_packs (rows are immutable; the guard trigger also forbids it).
