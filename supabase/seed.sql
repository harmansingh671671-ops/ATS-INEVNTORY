-- =====================================================================================
--  ATS CLUB — DEMO DATA & INITIAL SETUP
-- =====================================================================================
--  Run this script in your Supabase SQL Editor AFTER schema.sql
-- =====================================================================================

-- 1. Insert Initial Equipment Inventory
insert into public.items (id, name, sku, asset_tag, category, description, icon_name, total_quantity, available_quantity, notes)
values
  ('11111111-1111-1111-1111-111111111111', 'MacBook Pro 16"', 'SKU-MBP-16', 'AST-1042', 'Electronics', 'Apple M2 Max, 32GB RAM, 1TB SSD for heavy design & video workloads', 'laptop_mac', 10, 8, 'Includes charger & sleeve'),
  ('22222222-2222-2222-2222-222222222222', 'Sony A7IV Camera Kit', 'SKU-CAM-A74', 'AST-2099', 'Cameras', 'Full-frame mirrorless camera with 24-70mm f/2.8 GM lens & 2 batteries', 'videocam', 5, 3, 'In heavy demand by media team'),
  ('33333333-3333-3333-3333-333333333333', 'Shure SM7B Microphone', 'SKU-MIC-SM7B', 'AST-0841', 'Audio', 'Cardioid dynamic vocal microphone with Cloudlifter CL-1', 'headset_mic', 8, 4, 'Podcast studio item'),
  ('44444444-4444-4444-4444-444444444444', 'Aputure LS C300d II', 'SKU-LGT-300D', 'LT-5501', 'Lighting', 'Daylight balanced LED video light with softbox and C-stand', 'light', 4, 1, 'Check wireless remote before handover'),
  ('55555555-5555-5555-5555-555555555555', 'Avenger C-Stand 40"', 'SKU-ACC-CST', 'AST-0001', 'Accessories', 'Heavy-duty 40" turtle base C-stand with grip head and arm', 'precision_manufacturing', 20, 18, 'Stored in Locker B'),
  ('66666666-6666-6666-6666-666666666666', 'Wacom Cintiq Pro 24', 'SKU-WAC-C24', 'WAC-002', 'Design', '24-inch 4K pen display with Pro Pen 2', 'draw', 3, 2, 'Requires USB-C / DisplayPort input')
on conflict (id) do update set
  total_quantity = excluded.total_quantity,
  available_quantity = excluded.available_quantity;

-- 2. Demo Users (seeded into auth.users & public.profiles)
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
)
values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'member.demo@atsclub.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"full_name": "Demo Member"}'::jsonb,
    now(),
    now(),
    '',
    ''
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin.demo@atsclub.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"full_name": "Demo Admin"}'::jsonb,
    now(),
    now(),
    '',
    ''
  )
on conflict (id) do nothing;

insert into public.profiles (id, full_name, email, role)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Demo Member', 'member.demo@atsclub.com', 'member'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Demo Admin', 'admin.demo@atsclub.com', 'admin')
on conflict (id) do update set role = excluded.role;

-- 3. Sample Requests (for testing borrow requests UI)
insert into public.requests (id, item_id, user_id, quantity, duration_days, status, purpose, requested_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 7, 'pending', 'Video editing for club promo', now() - interval '2 hours'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 3, 'pending', 'Photoshoot for annual report', now() - interval '1 day')
on conflict (id) do nothing;

