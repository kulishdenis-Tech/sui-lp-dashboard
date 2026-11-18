-- Open-position history delta. Existing rows keep working: null last_event_ts means one full scan.
alter table public.lp_position_history
	add column if not exists last_event_ts bigint,
	add column if not exists last_cursor text,
	add column if not exists synced_at timestamptz;

-- last_cursor is stored only. Sync stops by last_event_ts, not by this cursor.
