-- =====================================================================================
--  ATS CLUB — INVENTORY SYSTEM · SUPABASE SCHEMA
-- =====================================================================================
--  HOW TO USE
--    1. Go to https://supabase.com/dashboard  →  select your project
--    2. Open the "SQL Editor" tab (left sidebar)  →  "New query"
--    3. Paste the whole content of this file and click "Run"
--    4. Then also run `seed.sql` (this folder) to load demo data + demo accounts
--
--  This file creates:  tables, row-level-security policies, a signup trigger,
--  and the RPC functions used by the website (atomic borrow / return actions).
-- =====================================================================================


-- =====================================================================================
-- 0. EXTENSIONS
-- =====================================================================================
create extension if not exists pgcrypto;          -- used by seed.sql for passwords
create extension if not exists "uuid-ossp";


-- =====================================================================================
-- 1. PROFILES  (extra info for every auth user)
-- =====================================================================================
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    full_name   text not null default '',
    email       text,
    role        text not null default 'member' check (role in ('member', 'admin')),
    joined_at   timestamptz default now(),
    status      text not null default 'active' check (status in ('active', 'banned')),
    prefs       jsonb not null default '{"reminders":true,"weekly":false}'::jsonb,
    created_at  timestamptz default now()
);

comment on table public.profiles is 'Extra information that mirrors every auth.users row. A trigger keeps this table in sync on signup.';

-- Auto-create or update a profile the moment someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name, email, role)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
        new.email,
        'member'
    )
    on conflict (id) do update set
        full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
        email = excluded.email;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- =====================================================================================
-- 2. ITEMS  (the inventory catalogue)
-- =====================================================================================
create table if not exists public.items (
    id                  uuid primary key default gen_random_uuid(),
    name                text not null,
    sku                 text unique,
    asset_tag           text,
    category            text not null default 'Electronics',
    description         text,
    image_url           text,
    icon_name           text default 'inventory_2',
    total_quantity      integer not null default 1 check (total_quantity >= 0),
    available_quantity  integer not null default 1 check (available_quantity >= 0),
    notes               text,
    created_at          timestamptz default now()
);


-- =====================================================================================
-- 3. REQUESTS  (a member asks to borrow an item; admin approves/rejects)
-- =====================================================================================
create table if not exists public.requests (
    id             uuid primary key default gen_random_uuid(),
    item_id        uuid not null references public.items (id) on delete cascade,
    user_id        uuid not null references public.profiles (id) on delete cascade,
    quantity       integer not null default 1 check (quantity > 0),
    duration_days  integer not null default 7 check (duration_days > 0),
    status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    purpose        text,
    requested_at   timestamptz default now(),
    reviewed_by    uuid references public.profiles (id),
    reviewed_at    timestamptz
);

-- =====================================================================================
-- 4. LOANS  (items actually handed to a member — the "who has what" ledger)
-- =====================================================================================
create table if not exists public.loans (
    id            uuid primary key default gen_random_uuid(),
    request_id    uuid references public.requests (id) on delete set null,
    item_id       uuid not null references public.items (id) on delete cascade,
    user_id       uuid not null references public.profiles (id) on delete cascade,
    quantity      integer not null default 1 check (quantity > 0),
    borrowed_at   timestamptz not null default now(),
    due_date      timestamptz not null,
    returned_at   timestamptz,
    status        text not null default 'active' check (status in ('active', 'returned')),
    notes         text
);

create index if not exists idx_loans_user    on public.loans (user_id);
create index if not exists idx_loans_status  on public.loans (status);
create index if not exists idx_requests_user on public.requests (user_id);

-- =====================================================================================

-- =====================================================================================
-- 4.5. INVENTORY LOG (tracking item quantity changes, damages, etc.)
-- =====================================================================================
create table if not exists public.inventory_log (
    id            uuid primary key default gen_random_uuid(),
    item_id       uuid not null references public.items (id) on delete cascade,
    admin_id      uuid references public.profiles (id),
    action        text not null, -- e.g., 'quantity_change', 'damage_report'
    change        integer, -- positive/negative quantity change
    notes         text,
    created_at    timestamptz default now()
);

create index if not exists idx_inventory_log_item on public.inventory_log (item_id);
alter table public.inventory_log enable row level security;

-- 5. SUPPORT TICKETS
-- =====================================================================================
create table if not exists public.support_tickets (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.profiles (id) on delete cascade,
    issue_type  text not null,
    subject     text not null,
    description text,
    urgency     text not null default 'Low' check (urgency in ('Low', 'High')),
    status      text not null default 'open' check (status in ('open', 'closed')),
    created_at  timestamptz default now()
);
-- =====================================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================================================
alter table public.profiles        enable row level security;
alter table public.items           enable row level security;
alter table public.requests        enable row level security;
alter table public.loans           enable row level security;
alter table public.support_tickets enable row level security;
alter table public.inventory_log     enable row level security;


-- Helper function: check if currently authenticated user is admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin' and status = 'active'
    );
$$;

-- ----- PROFILES -------------------------------------------------------------
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
    on public.profiles for select using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
    on public.profiles for insert
    with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all"
    on public.profiles for all
    using (public.is_admin());

-- ----- ITEMS ----------------------------------------------------------------
drop policy if exists "items_select_all" on public.items;
create policy "items_select_all"
    on public.items for select using (true);

drop policy if exists "items_admin_write" on public.items;
create policy "items_admin_write"
    on public.items for all
    using (public.is_admin());

-- ----- REQUESTS -------------------------------------------------------------
drop policy if exists "requests_select" on public.requests;
create policy "requests_select"
    on public.requests for select
    using (user_id = auth.uid() or public.is_admin());

drop policy if exists "requests_insert_own" on public.requests;
create policy "requests_insert_own"
    on public.requests for insert
    with check (user_id = auth.uid());

drop policy if exists "requests_update" on public.requests;
create policy "requests_update"
    on public.requests for update
    using (user_id = auth.uid() or public.is_admin());
-- ----- LOANS ----------------------------------------------------------------
drop policy if exists "loans_select" on public.loans;
create policy "loans_select"
    on public.loans for select
    using (user_id = auth.uid() or public.is_admin());

drop policy if exists "loans_admin_all" on public.loans;
create policy "loans_admin_all"
    on public.loans for all
    using (public.is_admin());

-- ----- SUPPORT TICKETS ------------------------------------------------------
drop policy if exists "tickets_select" on public.support_tickets;
create policy "tickets_select"
    on public.support_tickets for select
    using (user_id = auth.uid() or public.is_admin());

drop policy if exists "tickets_insert" on public.support_tickets;
create policy "tickets_insert"
    on public.support_tickets for insert
    with check (user_id = auth.uid());

drop policy if exists "tickets_admin_update" on public.support_tickets;
create policy "tickets_admin_update"
    on public.support_tickets for update
    using (public.is_admin());

-- ----- INVENTORY LOG --------------------------------------------------------
drop policy if exists "inventory_log_select" on public.inventory_log;
create policy "inventory_log_select"
    on public.inventory_log for select
    using (true);

drop policy if exists "inventory_log_insert" on public.inventory_log;
create policy "inventory_log_insert"
    on public.inventory_log for insert
    with check (public.is_admin());


-- =====================================================================================
-- 8. RPC FUNCTIONS (atomic operations called from the website)
-- =====================================================================================

-- request_item – member submits a borrow request (keeps stock untouched until approved)
create or replace function public.request_item(
    p_item_id uuid,
    p_quantity integer default 1,
    p_duration_days integer default 7,
    p_purpose text default ''
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_avail integer;
    v_new_req_id uuid;
begin
    if auth.uid() is null then
        return json_build_object('ok', false, 'error', 'not_authenticated');
    end if;

    select available_quantity into v_avail from public.items where id = p_item_id;
    if not found then
        return json_build_object('ok', false, 'error', 'item_not_found');
    end if;
    if v_avail < p_quantity then
        return json_build_object('ok', false, 'error', 'insufficient_stock');
    end if;

    insert into public.requests (item_id, user_id, quantity, duration_days, status, purpose)
    values (p_item_id, auth.uid(), p_quantity, p_duration_days, 'pending', p_purpose)
    returning id into v_new_req_id;

    return json_build_object('ok', true, 'request_id', v_new_req_id);
end;
$$;

-- approve_request – admin turns a pending request into an active loan + decrement stock
create or replace function public.approve_request(p_request_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_req record;
    v_avail integer;
    v_loan_id uuid;
begin
    if not public.is_admin() then
        return json_build_object('ok', false, 'error', 'not_admin');
    end if;

    select * into v_req from public.requests where id = p_request_id for update;
    if not found then
        return json_build_object('ok', false, 'error', 'request_not_found');
    end if;
    if v_req.status != 'pending' then
        return json_build_object('ok', false, 'error', 'not_pending');
    end if;

    select available_quantity into v_avail from public.items where id = v_req.item_id for update;
    if v_avail < v_req.quantity then
        return json_build_object('ok', false, 'error', 'insufficient_stock');
    end if;

    update public.items
    set available_quantity = available_quantity - v_req.quantity
    where id = v_req.item_id;

    update public.requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_request_id;

    insert into public.loans (request_id, item_id, user_id, quantity, borrowed_at, due_date, status)
    values (p_request_id, v_req.item_id, v_req.user_id, v_req.quantity, now(),
            now() + (v_req.duration_days || ' days')::interval, 'active')
    returning id into v_loan_id;

    return json_build_object('ok', true, 'loan_id', v_loan_id);
end;
$$;

-- reject_request – admin declines a pending request
create or replace function public.reject_request(p_request_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        return json_build_object('ok', false, 'error', 'not_admin');
    end if;

    update public.requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_request_id and status = 'pending';

    return json_build_object('ok', true);
end;
$$;

-- return_item – closes an active loan and increments stock back
create or replace function public.return_item(p_loan_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_loan record;
begin
    select * into v_loan from public.loans where id = p_loan_id for update;
    if not found then
        return json_build_object('ok', false, 'error', 'loan_not_found');
    end if;
    if v_loan.status = 'returned' then
        return json_build_object('ok', false, 'error', 'already_returned');
    end if;
    if v_loan.user_id != auth.uid() and not public.is_admin() then
        return json_build_object('ok', false, 'error', 'not_owner');
    end if;

    update public.loans set status = 'returned', returned_at = now() where id = p_loan_id;
    update public.items set available_quantity = available_quantity + v_loan.quantity where id = v_loan.item_id;

    return json_build_object('ok', true);
end;
$$;
