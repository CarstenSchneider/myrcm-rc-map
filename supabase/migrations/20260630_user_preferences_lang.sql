alter table public.user_preferences
  add column if not exists lang text
    check (lang in ('de', 'en', 'fr', 'nl'));
