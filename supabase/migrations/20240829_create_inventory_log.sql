-- ------------------------------------------------------------
-- 1️⃣  Create the inventory_log table
-- ------------------------------------------------------------
create table if not exists public.inventory_log (
  id            uuid      primary key default uuid_generate_v4(),
  item_id       uuid      not null references public.items (id) on delete cascade,
  admin_id      uuid      not null references public.profiles (id) on delete set null,
  action        text      not null,                     -- e.g. 'lend', 'return', 'Quantity Added', …
  change        integer   not null,                     -- positive for additions, negative for removals
  notes         text,                                 -- human‑readable description (the code builds this)
  created_at    timestamp with time zone default now()
);

-- ------------------------------------------------------------
-- 2️⃣  Enable Row‑Level Security (RLS) – required for all tables
-- ------------------------------------------------------------
alter table public.inventory_log enable row level security;

-- ------------------------------------------------------------
-- 3️⃣  Default policies (you can tighten them later)
-- ------------------------------------------------------------
-- a) Anyone who is authenticated can read logs
create policy "allow read for authenticated users"
  on public.inventory_log
  for select
  using (auth.role() = 'authenticated');

-- b) Only admins (or the admin who created the entry) can insert / update / delete
create policy "allow write for admins"
  on public.inventory_log
  for insert with check (
    auth.role() = 'authenticated' and
    (select role from public.profiles where id = auth.uid()) = 'admin'
  );

create policy "allow update/delete for admins"
  on public.inventory_log
  for update, delete
  using ((select role from public.profiles where id = auth.uid()) = 'admin');
