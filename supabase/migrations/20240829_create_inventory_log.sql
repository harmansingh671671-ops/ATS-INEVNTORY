-- ------------------------------------------------------------
-- 1️⃣  Create the inventory_log table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_log (
  id            UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id       UUID      NOT NULL REFERENCES public.items (id) ON DELETE CASCADE,
  admin_id      UUID      NOT NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  action        TEXT      NOT NULL,                     -- e.g. 'lend', 'return', 'Quantity Added', …
  change        INTEGER   NOT NULL,                     -- positive for additions, negative for removals
  notes         TEXT,                                 -- human‑readable description (the code builds this)
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 2️⃣  Enable Row‑Level Security (RLS) – required for all tables
-- ------------------------------------------------------------
ALTER TABLE public.inventory_log ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3️⃣  Default policies (you can tighten them later)
-- ------------------------------------------------------------
-- a) Anyone who is authenticated can read logs
CREATE POLICY "allow read for authenticated users"
  ON public.inventory_log
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- b) Only admins (or the admin who created the entry) can insert / update / delete
CREATE POLICY "allow write for admins"
  ON public.inventory_log
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "allow update/delete for admins"
  ON public.inventory_log
  FOR UPDATE, DELETE
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
