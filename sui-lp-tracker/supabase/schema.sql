-- Run in Supabase SQL Editor (Dashboard → SQL → New query).

create table if not exists public.watched_wallets (
	address text primary key,
	added_at timestamptz not null default now()
);

create table if not exists public.portfolio_snapshots (
	id text primary key,
	wallet_addr text not null references public.watched_wallets (address) on delete cascade,
	hour_bucket bigint not null,
	ts bigint not null,
	lp_usd double precision not null default 0,
	aftermath_usd double precision not null default 0,
	lending_net_usd double precision not null default 0,
	wallet_usd double precision not null default 0,
	total_usd double precision not null default 0,
	created_at timestamptz not null default now()
);

create index if not exists idx_portfolio_snapshots_wallet_ts
	on public.portfolio_snapshots (wallet_addr, ts desc);

create unique index if not exists idx_portfolio_snapshots_wallet_bucket
	on public.portfolio_snapshots (wallet_addr, hour_bucket);

-- Seed your watch wallets (normalized lowercase 0x…):
insert into public.watched_wallets (address) values
	('0xff8a51f37daceef95619a7d31915868375329964bacea6c72811175d6a458da6'),
	('0x925efc24d39e9a1726b22ff6a869ffe107820d036d91e5a1775353c38e0644b9')
on conflict (address) do nothing;

-- RLS: service role bypasses; anon read only for watched wallets via API (server-side).
alter table public.watched_wallets enable row level security;
alter table public.portfolio_snapshots enable row level security;
