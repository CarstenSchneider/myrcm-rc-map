-- venue_notifications: user opts into email alerts for a favorited host
create table if not exists public.venue_notifications (
  user_id  uuid references auth.users(id) on delete cascade not null,
  host_id  text not null,
  created_at timestamptz default now() not null,
  primary key (user_id, host_id)
);

alter table public.venue_notifications enable row level security;

create policy "Users manage own notification prefs"
  on public.venue_notifications
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- seen_race_notifications: tracks which races we already emailed per user
-- prevents duplicate emails when the cron runs daily
create table if not exists public.seen_race_notifications (
  user_id    uuid references auth.users(id) on delete cascade not null,
  race_id    text not null,
  notif_type text not null, -- 'new_race' | 'registration_open'
  sent_at    timestamptz default now() not null,
  primary key (user_id, race_id, notif_type)
);

alter table public.seen_race_notifications enable row level security;
-- No user-facing RLS needed; only the service role writes to this table.
