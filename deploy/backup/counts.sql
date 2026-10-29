-- Record counts of every table, as JSON. The Backup stores them next to the dump; the
-- restore test compares them with the restored database. spatial_ref_sys belongs to PostGIS.
select coalesce(json_object_agg(table_name, n order by table_name), '{}'::json)
from (
  select table_name,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::bigint as n
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'spatial_ref_sys'
) t;
