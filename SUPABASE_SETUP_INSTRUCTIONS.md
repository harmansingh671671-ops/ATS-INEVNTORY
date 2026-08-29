# ATS Club Inventory Management System Setup & Instructions

## Architecture & Features

This full-stack ATS Club Inventory web app includes:
1. **Supabase Database Schema (`supabase/schema.sql`)**:
   - `profiles` table for member details & roles (`member` or `admin`).
   - `items` table for hardware/equipment catalog with total & available quantities.
   - `requests` table for tracking pending/approved/rejected borrow requests.
   - `loans` table for tracking active item checkouts, due dates, and return status.
   - `support_tickets` table for member inquiries.
   - RPC functions (`request_item`, `approve_request`, `reject_request`, `return_item`) for atomic inventory operations and security.
   - Row-Level Security (RLS) policies allowing members to access their data and admins to manage all inventory.

2. **Demo Data (`supabase/seed.sql`)**:
   - Equipment catalog (MacBook Pro, Sony A7IV Camera, Shure SM7B, Aputure Lights, C-Stands, Wacom Cintiq).
   - Sample borrow requests.

3. **Frontend App (`index.html` & `app.js`)**:
   - Single Page App using Tailwind CSS and Supabase JS v2 SDK.
   - **Role-Based Dynamic UIs**:
     - **Admin UI**: Left-sidebar layout featuring Admin Dashboard metrics (Total equipment, active checkouts, pending requests, overdue items), Inventory Management, Borrow Request Approval/Rejection, Member Management (promote/demote roles), and Settings.
     - **Member UI**: Top-navigation layout featuring Equipment Browser, Member Dashboard (active borrows & request history with Return button), Profile, and Support form.

---

## Step 1: Initialize Database in Supabase

1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Open your project.
3. Go to the **SQL Editor** tab (left sidebar).
4. Click **New query**.
5. Copy & paste the contents of `supabase/schema.sql` into the editor and click **Run**.
6. Create another **New query**, paste the contents of `supabase/seed.sql`, and click **Run**.

---

## Step 2: How to Set a User as an Admin

When a user signs up on the web app, they are assigned the `member` role by default.

To promote a user to an **Admin**:
1. Run the following SQL command in your Supabase SQL Editor (replace with the user's email):

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'admin@example.com';
```

Or toggle their role directly from the **Admin -> Member Management** portal in the web application!

---

## Step 3: Run the Web App Locally

Run a local HTTP server in `c:\Automation`:

```powershell
python -m http.server 8000
```

Then open your browser and navigate to:
[http://localhost:8000](http://localhost:8000)

---

## Summary of Completed Tasks

- Added role-based authorization: User signs in -> app fetches `profiles` table -> switches to either **Member UI** (top nav) or **Admin UI** (left sidebar).
- Admin role promotion via SQL command or Member Management screen.
- Integrated Supabase RPC actions (`request_item`, `approve_request`, `reject_request`, `return_item`).
- Provided `index.html`, `app.js`, `schema.sql`, `seed.sql`, and documentation.
