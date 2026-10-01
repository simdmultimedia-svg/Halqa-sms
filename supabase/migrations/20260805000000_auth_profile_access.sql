-- Allow every authenticated account to resolve only its own profile and role.
-- This is required immediately after Supabase Auth sign-in.
alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.roles enable row level security;

drop policy if exists "user_read_own_profile" on public.users;
create policy "user_read_own_profile" on public.users
  for select to authenticated
  using (auth_id = auth.uid());

drop policy if exists "user_read_own_role_links" on public.user_roles;
create policy "user_read_own_role_links" on public.user_roles
  for select to authenticated
  using (user_id in (select id from public.users where auth_id = auth.uid()));

drop policy if exists "authenticated_read_roles" on public.roles;
create policy "authenticated_read_roles" on public.roles
  for select to authenticated
  using (true);
