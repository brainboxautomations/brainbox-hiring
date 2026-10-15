-- Departments become a list the team manages instead of a constant in the app.
--
-- A position still stores its department as plain text (positions.department),
-- so the careers page, filters and reports keep working unchanged, and deleting
-- a department from this list never touches a position that already uses it.
-- The list only decides what the position form offers.

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint departments_name_trimmed check (name = btrim(name)),
  constraint departments_name_length check (char_length(name) between 1 and 60)
);

-- "Sales" and "sales" are the same department.
create unique index departments_name_unique on public.departments (lower(name));

alter table public.departments enable row level security;

create policy departments_authenticated_all on public.departments
  for all to authenticated using (true) with check (true);

-- Explicit, as in 0047: the careers site never reads this table.
revoke all on table public.departments from anon;
grant select, insert, update, delete on table public.departments to authenticated;
grant select, insert, update, delete on table public.departments to service_role;

-- The defaults, plus any other department a position already carries, so
-- nothing in use disappears from the dropdown. ("Success", which the form used
-- to offer, is not a department here; it only comes back if a position uses it.)
insert into public.departments (name)
select name
from (
  values ('Engineering'), ('Sales'), ('Design'), ('Marketing'), ('Operations')
) as defaults(name)
union
select distinct btrim(department)
from public.positions
where department is not null
  and char_length(btrim(department)) between 1 and 60
on conflict (lower(name)) do nothing;
