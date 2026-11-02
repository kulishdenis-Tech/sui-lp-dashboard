-- Authoritative series: partial loads are stored only if this column stays true,
-- and application code refuses to overwrite incomplete=false with a partial row.
alter table public.portfolio_snapshots
	add column if not exists incomplete boolean not null default false;
