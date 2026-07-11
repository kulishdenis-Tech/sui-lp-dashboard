-- Append to existing analytics schema (Dashboard → SQL → New query).
-- Requires public.watched_wallets from schema.sql.

create table if not exists public.lp_position_history (
	id text primary key,
	wallet_addr text not null references public.watched_wallets (address) on delete cascade,
	position_id text not null,
	protocol text not null,
	status text not null check (status in ('open', 'closed')),
	pair text not null default '',
	events jsonb not null default '[]'::jsonb,
	position jsonb not null default '{}'::jsonb,
	scan_partial boolean not null default false,
	opened_at bigint,
	closed_at bigint,
	updated_at timestamptz not null default now()
);

create index if not exists idx_lp_position_history_wallet_status
	on public.lp_position_history (wallet_addr, status, closed_at desc nulls last);

create unique index if not exists idx_lp_position_history_wallet_pos
	on public.lp_position_history (wallet_addr, position_id);

alter table public.lp_position_history enable row level security;
