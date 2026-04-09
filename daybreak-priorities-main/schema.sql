-- Run this entire file in your Supabase SQL Editor

create table if not exists initiatives (
  key text primary key,
  title text not null,
  phase text not null,
  requestor text not null,
  effort int not null default 3,
  value int not null default 3,
  importance int not null default 3,
  urgency int not null default 3,
  score numeric not null default 0,
  revenue int not null default 0,
  notes text default '',
  is_new boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists votes (
  initiative_key text references initiatives(key) on delete cascade,
  user_name text not null,
  value int not null check (value in (-1, 0, 1)),
  updated_at timestamptz default now(),
  primary key (initiative_key, user_name)
);

create table if not exists comments (
  id bigserial primary key,
  initiative_key text references initiatives(key) on delete cascade,
  author text not null,
  text text not null,
  parent_id bigint references comments(id) on delete cascade,
  created_at timestamptz default now()
);

-- Enable realtime on all tables
alter publication supabase_realtime add table initiatives;
alter publication supabase_realtime add table votes;
alter publication supabase_realtime add table comments;

-- Open read/write access (for internal team tool — no auth needed)
alter table initiatives enable row level security;
alter table votes enable row level security;
alter table comments enable row level security;

create policy "public read initiatives" on initiatives for select using (true);
create policy "public write initiatives" on initiatives for insert with check (true);
create policy "public update initiatives" on initiatives for update using (true);
create policy "public delete initiatives" on initiatives for delete using (true);

create policy "public read votes" on votes for select using (true);
create policy "public write votes" on votes for insert with check (true);
create policy "public update votes" on votes for update using (true);
create policy "public delete votes" on votes for delete using (true);

create policy "public read comments" on comments for select using (true);
create policy "public write comments" on comments for insert with check (true);
create policy "public delete comments" on comments for delete using (true);
