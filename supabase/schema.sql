create table if not exists public.recommendation_votes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null,
  team_key text not null,
  candidate_id text not null,
  value smallint not null check (value in (-1, 1)),
  vote_day date not null default current_date,
  vote_bucket text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tier, team_key, candidate_id, vote_bucket)
);

alter table public.recommendation_votes
  add column if not exists vote_bucket text;

update public.recommendation_votes
set vote_bucket = to_char(date_trunc('day', vote_day::timestamptz), 'YYYY-MM-DD"T"HH24')
where vote_bucket is null;

alter table public.recommendation_votes
  alter column vote_bucket set not null;

alter table public.recommendation_votes
  drop constraint if exists recommendation_votes_user_id_tier_team_key_candidate_id_vote_day_key;

create unique index if not exists recommendation_votes_vote_bucket_unique_idx
  on public.recommendation_votes (user_id, tier, team_key, candidate_id, vote_bucket);

create index if not exists recommendation_votes_lookup_idx
  on public.recommendation_votes (tier, team_key, candidate_id);

alter table public.recommendation_votes enable row level security;

create policy "Users can insert their own recommendation votes"
  on public.recommendation_votes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own recommendation votes"
  on public.recommendation_votes
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can read their own recommendation votes"
  on public.recommendation_votes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace view public.recommendation_feedback_summary as
select
  tier,
  team_key,
  candidate_id,
  count(*) filter (where value = 1)::integer as likes,
  count(*) filter (where value = -1)::integer as dislikes,
  count(*)::integer as total,
  max(updated_at) as updated_at
from public.recommendation_votes
group by tier, team_key, candidate_id;

grant select on public.recommendation_feedback_summary to anon, authenticated;
grant select, insert, update on public.recommendation_votes to authenticated;

create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reply_to text,
  message text not null check (char_length(message) between 1 and 1200),
  app_version text,
  user_agent text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

create policy "Users can create contact messages"
  on public.contact_messages
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant insert on public.contact_messages to authenticated;

-- ── Diagnostic vote event log ─────────────────────────────────────────────────
-- Append-only: every vote attempt is stored here, including ones that the
-- recommendation_votes unique index collapses into an UPDATE (was_duplicate=true).
-- Lets us verify that id gaps in recommendation_votes are normal dedup behaviour.
-- Purged after 30 days (see pg_cron block below) to bound storage.
create table if not exists public.recommendation_vote_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null,
  team_key text not null,
  candidate_id text not null,
  value smallint not null check (value in (-1, 1)),
  vote_bucket text not null,
  was_duplicate boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists recommendation_vote_events_created_at_idx
  on public.recommendation_vote_events (created_at desc);

create index if not exists recommendation_vote_events_dedup_idx
  on public.recommendation_vote_events (user_id, tier, team_key, candidate_id, vote_bucket);

alter table public.recommendation_vote_events enable row level security;

drop policy if exists "Users can insert their own vote events" on public.recommendation_vote_events;
create policy "Users can insert their own vote events"
  on public.recommendation_vote_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own vote events" on public.recommendation_vote_events;
create policy "Users can read their own vote events"
  on public.recommendation_vote_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert on public.recommendation_vote_events to authenticated;

-- ── 30-day TTL purge for the diagnostic event log ─────────────────────────────
-- Requires the pg_cron extension. Enable it once in Supabase:
--   Dashboard → Database → Extensions → pg_cron (toggle on).
-- If pg_cron is not enabled the table still works; it just won't auto-purge.
-- Manual purge equivalent:
--   delete from public.recommendation_vote_events where created_at < now() - interval '30 days';
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-recommendation-vote-events') then
      perform cron.unschedule('purge-recommendation-vote-events');
    end if;
    perform cron.schedule(
      'purge-recommendation-vote-events',
      '0 18 * * *',  -- daily at 18:00 UTC = 03:00 KST
      $purge$delete from public.recommendation_vote_events where created_at < now() - interval '30 days'$purge$
    );
  end if;
end
$$;

notify pgrst, 'reload schema';
