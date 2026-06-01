create table if not exists public.recommendation_votes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null,
  team_key text not null,
  candidate_id text not null,
  value smallint not null check (value in (-1, 1)),
  vote_day date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tier, team_key, candidate_id, vote_day)
);

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
