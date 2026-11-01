-- service_role-only reader for portfolio snapshot cron/dispatch secrets in vault
create extension if not exists supabase_vault with schema vault;

create or replace function public.portfolio_runtime_secret(secret_name text)
returns text
language plpgsql
security definer
set search_path = vault, public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if secret_name not in (
    'portfolio_cron_secret',
    'github_dispatch_token',
    'github_dispatch_repo',
    'github_dispatch_workflow',
    'github_dispatch_ref',
    'portfolio_edge_url'
  ) then
    raise exception 'unknown secret';
  end if;
  return (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = secret_name
    limit 1
  );
end;
$$;

revoke all on function public.portfolio_runtime_secret(text) from public;
revoke all on function public.portfolio_runtime_secret(text) from anon;
revoke all on function public.portfolio_runtime_secret(text) from authenticated;
grant execute on function public.portfolio_runtime_secret(text) to service_role;

comment on function public.portfolio_runtime_secret(text) is
  'service_role-only reader for portfolio snapshot cron/dispatch secrets in vault';
