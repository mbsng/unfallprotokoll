-- Organisation-scoped access for the fleet SaaS portal.
create or replace function public.current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_current_user_fleet_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('fleet_manager', 'admin')
      and org_id is not null
  );
$$;

create or replace function public.incident_belongs_to_current_org(target_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_current_user_fleet_manager() and exists (
    select 1
    from public.incident_parties ip
    join public.profiles p on p.id = ip.profile_id
    where ip.incident_id = target_incident_id
      and p.org_id = public.current_user_org_id()
  );
$$;

revoke all on function public.current_user_org_id() from public;
revoke all on function public.is_current_user_fleet_manager() from public;
revoke all on function public.incident_belongs_to_current_org(uuid) from public;
grant execute on function public.current_user_org_id() to authenticated;
grant execute on function public.is_current_user_fleet_manager() to authenticated;
grant execute on function public.incident_belongs_to_current_org(uuid) to authenticated;

create table if not exists public.organization_invitations (

  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);

alter table public.organization_invitations enable row level security;

-- A manager can see organisation metadata and members, but never another tenant.
drop policy if exists fleet_managers_read_own_organization on public.organizations;
create policy fleet_managers_read_own_organization on public.organizations
for select to authenticated
using (id = public.current_user_org_id());

drop policy if exists fleet_managers_read_org_profiles on public.profiles;
create policy fleet_managers_read_org_profiles on public.profiles
for select to authenticated
using (
  public.is_current_user_fleet_manager()
  and org_id = public.current_user_org_id()
);

drop policy if exists fleet_managers_read_org_incidents on public.incidents;
create policy fleet_managers_read_org_incidents on public.incidents
for select to authenticated
using (public.incident_belongs_to_current_org(id));

drop policy if exists fleet_managers_read_org_parties on public.incident_parties;
create policy fleet_managers_read_org_parties on public.incident_parties
for select to authenticated
using (public.incident_belongs_to_current_org(incident_id));

drop policy if exists fleet_managers_read_org_witnesses on public.incident_witnesses;
create policy fleet_managers_read_org_witnesses on public.incident_witnesses
for select to authenticated
using (public.incident_belongs_to_current_org(incident_id));

drop policy if exists fleet_managers_read_org_media on public.incident_media;
create policy fleet_managers_read_org_media on public.incident_media
for select to authenticated
using (public.incident_belongs_to_current_org(incident_id));

drop policy if exists fleet_managers_read_org_submissions on public.submissions;
create policy fleet_managers_read_org_submissions on public.submissions
for select to authenticated
using (public.incident_belongs_to_current_org(incident_id));

drop policy if exists fleet_managers_read_invitations on public.organization_invitations;
create policy fleet_managers_read_invitations on public.organization_invitations
for select to authenticated
using (
  public.is_current_user_fleet_manager()
  and org_id = public.current_user_org_id()
);

create index if not exists organization_invitations_org_id_idx on public.organization_invitations(org_id);
create index if not exists profiles_org_id_idx on public.profiles(org_id);
create index if not exists incident_parties_profile_id_idx on public.incident_parties(profile_id);
