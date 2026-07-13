-- App visit log (any connected wallet). Run in Supabase SQL Editor.
-- Also appended in schema.sql for new projects.

create table if not exists public.app_visits (
	id bigint generated always as identity primary key,
	wallet_addr text not null,
	visited_at timestamptz not null default now(),
	user_agent text
);

create index if not exists idx_app_visits_visited_at
	on public.app_visits (visited_at desc);

create index if not exists idx_app_visits_wallet_visited
	on public.app_visits (wallet_addr, visited_at desc);

alter table public.app_visits enable row level security;
