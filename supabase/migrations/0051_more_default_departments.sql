-- More default departments, added after 0050 had already been applied.
--
-- `on conflict do nothing` leaves any department the team has already added by
-- hand (in any letter case) as it is.

insert into public.departments (name)
values ('AI & Automation'), ('Product'), ('Finance'), ('People')
on conflict (lower(name)) do nothing;
