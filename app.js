/* =====================================================================================
   ATS CLUB — INVENTORY MANAGEMENT SYSTEM (FULL STACK SUPABASE)
   ===================================================================================== */

let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';

async function loadEnvConfig() {
  let env = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: ''
  };

  try {
    const response = await fetch('.env');
    if (response.ok) {
      const text = await response.text();
      text.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx !== -1) {
            const key = trimmed.slice(0, idx).trim();
            let val = trimmed.slice(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            env[key] = val;
          }
        }
      });
    }
  } catch (err) {
    console.error('Error loading .env file', err);
  }

  SUPABASE_URL = window.ENV?.SUPABASE_URL || env.SUPABASE_URL;
  SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

  if (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

let supabaseClient = null;

const State = {
  user: null,
  profile: null,
  items: [],
  requests: [],
  loans: [],
  members: [],
  inventoryLogs: [],
  activeRoute: ''
};

// --- HELPERS ---
function $(sel) { return document.querySelector(sel); }
function h(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toast(msg, type = 'info') {
  const c = $('#toast-container');
  if (!c) return;
  const div = document.createElement('div');
  const bg = type === 'error' ? 'bg-error text-on-error' : type === 'success' ? 'bg-emerald-600 text-white' : 'bg-primary-container text-on-primary-container';
  div.className = `${bg} px-md py-sm rounded-lg shadow-lg text-sm font-medium transition-all duration-300 flex items-center justify-between min-w-[240px]`;
  div.innerHTML = `<span>${h(msg)}</span><button onclick="this.parentElement.remove()" class="ml-sm font-bold">&times;</button>`;
  c.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// --- AUTH ---
const Auth = {
  mode: 'login',
  switchTab(m) {
    this.mode = m;
    const lTab = $('#auth-tab-login'), sTab = $('#auth-tab-signup'), nFiled = $('#auth-name-field');
    if (m === 'login') {
      lTab.className = 'flex-1 py-sm rounded-full font-label-sm bg-secondary text-on-secondary text-sm';
      sTab.className = 'flex-1 py-sm rounded-full font-label-sm text-sm text-on-surface-variant';
      nFiled.classList.add('hidden');
      $('#auth-submit-btn').innerHTML = '<span class="material-symbols-outlined text-[18px]">login</span><span>Sign In</span>';
    } else {
      sTab.className = 'flex-1 py-sm rounded-full font-label-sm bg-secondary text-on-secondary text-sm';
      lTab.className = 'flex-1 py-sm rounded-full font-label-sm text-sm text-on-surface-variant';
      nFiled.classList.remove('hidden');
      $('#auth-submit-btn').innerHTML = '<span class="material-symbols-outlined text-[18px]">person_add</span><span>Sign Up</span>';
    }
  },
  async handleSubmit(e) {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const name = $('#auth-name').value.trim();
    const alertEl = $('#auth-alert');
    alertEl.classList.add('hidden');

    try {
      if (this.mode === 'login') {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient.auth.signUp({
          email, password,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        if (!data.session) {
          alertEl.textContent = 'Sign up successful! Please log in with your credentials.';
          alertEl.classList.remove('hidden');
          this.switchTab('login');
          return;
        }
      }
      App.init();
    } catch (err) {
      alertEl.textContent = err.message || 'Authentication failed';
      alertEl.classList.remove('hidden');
    }
  },
  async logout() {
    await supabaseClient.auth.signOut();
    State.user = null;
    State.profile = null;
    $('#app-view').classList.add('hidden');
    $('#auth-view').classList.remove('hidden');
    toast('Logged out', 'info');
  }
};

// --- APP CORE ---
const App = {
  async init() {
    await loadEnvConfig();
    Auth.switchTab('login');

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      $('#app-view').classList.add('hidden');
      $('#auth-view').classList.remove('hidden');
      return;
    }

    State.user = session.user;

    // Fetch Profile
    let { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', State.user.id).single();
    if (!profile) {
      // Create default profile if not present
      const metaName = State.user.user_metadata?.full_name || State.user.email.split('@')[0];
      const { data: newProf } = await supabaseClient.from('profiles').insert([{ id: State.user.id, email: State.user.email, full_name: metaName, role: 'member' }]).select().single();
      profile = newProf || { id: State.user.id, email: State.user.email, full_name: metaName, role: 'member' };
    }

    State.profile = profile;

    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');

    if (State.profile.role === 'admin') {
      this.renderAdminWindow();
      this.loadAdminData();
      Router.go('admin-dashboard');
    } else {
      this.renderMemberWindow();
      this.loadMemberData();
      Router.go('member-browse');
    }
  },

  // --- RENDER ADMIN WINDOW ---
  renderAdminWindow() {
    const app = $('#app-view');
    app.className = "flex h-screen bg-surface overflow-hidden";
    app.innerHTML = `
      <!-- Admin Sidebar -->
      <aside class="w-64 bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between p-md shrink-0">
        <div>
          <!-- Brand -->
          <div class="flex items-center gap-sm mb-lg px-xs">
            <div class="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container font-bold">
              <span class="material-symbols-outlined text-[24px]">inventory_2</span>
            </div>
            <div>
              <h1 class="font-display-md text-display-md text-primary">ATS CLUB</h1>
              <span class="text-[10px] font-label-sm uppercase bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full font-bold">Admin Portal</span>
            </div>
          </div>

          <!-- Nav Menu -->
          <nav class="flex flex-col gap-xs">
            <button onclick="Router.go('admin-dashboard')" data-nav="admin-dashboard" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">dashboard</span> Dashboard
            </button>
            <button onclick="Router.go('admin-inventory')" data-nav="admin-inventory" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">inventory_2</span> Inventory Mgmt
            </button>
            <button onclick="Router.go('admin-requests')" data-nav="admin-requests" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm justify-between">
              <span class="flex items-center gap-md"><span class="material-symbols-outlined">sync_alt</span> Borrow Requests</span>
              <span id="pending-badge" class="bg-error text-on-error text-[10px] px-2 py-0.5 rounded-full font-bold hidden">0</span>
            </button>
            <button onclick="Router.go('admin-members')" data-nav="admin-members" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">group</span> Members
            </button>
          </nav>
        </div>

        <!-- Footer Profile -->
        <div class="border-t border-outline-variant pt-md flex items-center justify-between">
          <div onclick="Router.go('admin-profile')" class="truncate cursor-pointer hover:opacity-80 transition-opacity flex-1 mr-2" title="View & Edit Profile">
            <div class="font-bold text-sm truncate">${h(State.profile?.full_name || State.user?.email)}</div>
            <div class="text-[11px] text-on-surface-variant truncate">${h(State.user?.email)}</div>
          </div>
          <button onclick="Auth.logout()" title="Logout" class="p-xs text-error hover:bg-error-container/20 rounded-full shrink-0">
            <span class="material-symbols-outlined">logout</span>
          </button>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main id="main-content" class="flex-1 overflow-y-auto p-lg bg-surface">
      </main>
    `;
  },

  // --- RENDER MEMBER WINDOW ---
  renderMemberWindow() {
    const app = $('#app-view');
    app.className = "flex h-screen bg-surface overflow-hidden";
    app.innerHTML = `
      <!-- Member Sidebar Nav -->
      <aside class="w-64 bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between p-md shrink-0">
        <div>
          <!-- Brand -->
          <div class="flex items-center gap-sm mb-lg px-xs">
            <div class="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container font-bold">
              <span class="material-symbols-outlined text-[24px]">inventory_2</span>
            </div>
            <div>
              <h1 class="font-display-md text-display-md text-primary">ATS CLUB</h1>
              <span class="text-[10px] font-label-sm uppercase bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full font-bold">Member Portal</span>
            </div>
          </div>

          <!-- Nav Menu -->
          <nav class="flex flex-col gap-xs">
            <button onclick="Router.go('member-browse')" data-nav="member-browse" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">grid_view</span> Browse Inventory
            </button>
            <button onclick="Router.go('member-dashboard')" data-nav="member-dashboard" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">dashboard</span> My Dashboard
            </button>
            <button onclick="Router.go('member-support')" data-nav="member-support" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">help_outline</span> Support
            </button>
          </nav>
        </div>

        <!-- Footer Profile -->
        <div class="border-t border-outline-variant pt-md flex items-center justify-between">
          <div onclick="Router.go('member-profile')" class="truncate cursor-pointer hover:opacity-80 transition-opacity flex-1 mr-2" title="View & Edit Profile">
            <div class="font-bold text-sm truncate">${h(State.profile?.full_name || State.user?.email)}</div>
            <div class="text-[11px] text-on-surface-variant truncate">${h(State.user?.email)}</div>
          </div>
          <button onclick="Auth.logout()" title="Logout" class="p-xs text-error hover:bg-error-container/20 rounded-full shrink-0">
            <span class="material-symbols-outlined">logout</span>
          </button>
        </div>
      </aside>

      <!-- Main Content Container -->
      <main id="main-content" class="flex-1 overflow-y-auto p-lg bg-surface">
      </main>
    `;
  },

  async loadAdminData() {
    try {
      const [itemsRes, reqsRes, loansRes, memsRes, logsRes] = await Promise.all([
        supabaseClient.from('items').select('*').order('name'),
        supabaseClient.from('requests').select('*, items(name, asset_tag), profiles!user_id(full_name, email)').order('requested_at', { ascending: false }),
        supabaseClient.from('loans').select('*, items(name, asset_tag), profiles!user_id(full_name, email)').order('borrowed_at', { ascending: false }),
        supabaseClient.from('profiles').select('*').order('joined_at', { ascending: false }),
        supabaseClient.from('inventory_logs').select('*, profiles!admin_id(full_name, email)').order('created_at', { ascending: false })
      ]);

      if (reqsRes.error) console.error('Error fetching requests:', reqsRes.error);
      if (loansRes.error) console.error('Error fetching loans:', loansRes.error);
      if (itemsRes.error) console.error('Error fetching items:', itemsRes.error);
      if (logsRes.error) console.error('Error fetching logs:', logsRes.error);

      State.items = itemsRes.data || [];
      State.requests = reqsRes.data || [];
      State.loans = loansRes.data || [];
      State.members = memsRes.data || [];
      State.inventoryLogs = logsRes.data || [];

      const pBadge = $('#pending-badge');
      const pCount = State.requests.filter(r => r.status === 'pending').length;
      if (pBadge) {
        if (pCount > 0) { pBadge.textContent = pCount; pBadge.classList.remove('hidden'); }
        else { pBadge.classList.add('hidden'); }
      }
    } catch (err) {
      console.error('loadAdminData exception:', err);
    }
  },

  async loadMemberData() {
    try {
      const [itemsRes, reqsRes, loansRes, logsRes] = await Promise.all([
        supabaseClient.from('items').select('*').order('name'),
        supabaseClient.from('requests').select('*, items(name, asset_tag, icon_name)').eq('user_id', State.user.id).order('requested_at', { ascending: false }),
        supabaseClient.from('loans').select('*, items(name, asset_tag, icon_name)').eq('user_id', State.user.id).order('borrowed_at', { ascending: false }),
        supabaseClient.from('inventory_logs').select('*, profiles!admin_id(full_name, email)').order('created_at', { ascending: false })
      ]);

      if (reqsRes.error) console.error('Error fetching member requests:', reqsRes.error);
      if (loansRes.error) console.error('Error fetching member loans:', loansRes.error);

      State.items = itemsRes.data || [];
      State.requests = reqsRes.data || [];
      State.loans = loansRes.data || [];
      State.inventoryLogs = logsRes.data || [];
    } catch (err) {
      console.error('loadMemberData exception:', err);
    }
  }
};

// --- ROUTER ---
const Router = {
  go(routeName) {
    State.activeRoute = routeName;

    // Active state highlighting
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.getAttribute('data-nav') === routeName) {
        el.classList.add('bg-secondary', 'text-on-secondary', 'font-bold');
        el.classList.remove('text-on-surface-variant', 'hover:bg-surface-container');
      } else {
        el.classList.remove('bg-secondary', 'text-on-secondary', 'font-bold');
        el.classList.add('text-on-surface-variant', 'hover:bg-surface-container');
      }
    });

    const main = $('#main-content');
    if (!main) return;

    if (routeName.startsWith('admin-edit-item-')) {
      const itemId = routeName.replace('admin-edit-item-', '');
      main.innerHTML = Views.adminEditItem(itemId);
      return;
    }

    switch(routeName) {
      case 'admin-dashboard': main.innerHTML = Views.adminDashboard(); break;
      case 'admin-inventory': main.innerHTML = Views.adminInventory(); break;
      case 'admin-requests': main.innerHTML = Views.adminRequests(); break;
      case 'admin-members': main.innerHTML = Views.adminMembers(); break;
      case 'admin-profile': main.innerHTML = Views.adminProfile(); break;
      case 'member-browse': main.innerHTML = Views.memberBrowse(); break;
      case 'member-dashboard': main.innerHTML = Views.memberDashboard(); break;
      case 'member-profile': main.innerHTML = Views.memberProfile(); break;
      case 'member-support': main.innerHTML = Views.memberSupport(); break;
      default: main.innerHTML = '<div class="p-lg">Page under construction</div>';
    }
  }
};

// --- VIEWS ---
const Views = {
  // --- ADMIN DASHBOARD ---
  adminDashboard() {
    const totalItems = State.items.reduce((acc, i) => acc + (i.total_quantity || i.total_stock || 1), 0);
    const activeLoans = State.loans.filter(l => l.status === 'active').length;
    const pendingList = State.requests.filter(r => r.status === 'pending');
    const pendingReqs = pendingList.length;
    const overdueCount = State.loans.filter(l => l.status === 'active' && new Date(l.due_date) < new Date()).length;

    const pendingRows = pendingList.map(req => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(req.items?.name || 'Equipment')}</td>
        <td class="px-md py-sm text-on-surface-variant">${h(req.profiles?.full_name || req.profiles?.email || 'Member')}</td>
        <td class="px-md py-sm text-on-surface-variant text-xs font-bold">${req.quantity || 1}</td>
        <td class="px-md py-sm text-on-surface-variant text-xs">${req.duration_days || 7} Days</td>
        <td class="px-md py-sm text-on-surface-variant text-xs">${h(req.purpose || 'Standard Borrow')}</td>
        <td class="px-md py-sm text-right space-x-xs">
          <button onclick="Actions.approveRequest('${req.id}')" class="bg-emerald-700 text-white px-sm py-xs rounded text-xs font-bold hover:bg-emerald-800">Approve</button>
          <button onclick="Actions.rejectRequest('${req.id}')" class="bg-error text-white px-sm py-xs rounded text-xs font-bold hover:bg-error/80">Reject</button>
        </td>
      </tr>
    `).join('');

    const alertRows = State.loans.filter(l => l.status === 'active').map(l => {
      const isOverdue = new Date(l.due_date) < new Date();
      const statusBadge = isOverdue 
        ? '<span class="px-2 py-1 bg-error-container text-error rounded-full text-xs font-bold uppercase">Overdue</span>'
        : '<span class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold uppercase">Active Loan</span>';
      return `
        <tr class="border-b border-surface-variant hover:bg-surface-container-low transition-colors">
          <td class="px-md py-sm font-medium">${h(l.items?.name || 'Item')}</td>
          <td class="px-md py-sm text-on-surface-variant">${h(l.profiles?.full_name || l.profiles?.email || 'Member')}</td>
          <td class="px-md py-sm text-on-surface-variant">${fmtDate(l.due_date)}</td>
          <td class="px-md py-sm">${statusBadge}</td>
          <td class="px-md py-sm text-right">
            <button onclick="Actions.returnItem('${l.id}')" class="text-secondary hover:underline text-xs font-bold">Process Return</button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="space-y-lg">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">Admin Dashboard</h1>
          <p class="text-on-surface-variant text-sm">System statistics and active item ledger.</p>
        </div>

        <!-- Metric Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md">
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant">
            <div class="text-on-surface-variant text-xs uppercase font-label-sm">Total Equipment Units</div>
            <div class="font-display-lg text-display-lg text-primary mt-xs">${totalItems}</div>
          </div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant">
            <div class="text-on-surface-variant text-xs uppercase font-label-sm">Active Borrows</div>
            <div class="font-display-lg text-display-lg text-secondary mt-xs">${activeLoans}</div>
          </div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant">
            <div class="text-on-surface-variant text-xs uppercase font-label-sm">Pending Requests</div>
            <div class="font-display-lg text-display-lg text-amber-600 mt-xs">${pendingReqs}</div>
          </div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant">
            <div class="text-on-surface-variant text-xs uppercase font-label-sm">Overdue Items</div>
            <div class="font-display-lg text-display-lg text-error mt-xs">${overdueCount}</div>
          </div>
        </div>

        <!-- Pending Requests Section -->
        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div class="p-md border-b border-outline-variant flex items-center justify-between bg-amber-50/50">
            <h2 class="font-bold text-on-surface text-sm">Pending Borrow Requests (${pendingReqs})</h2>
            <button onclick="Router.go('admin-requests')" class="text-secondary text-xs hover:underline font-bold">View All Requests</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
                <tr>
                  <th class="px-md py-sm">Equipment Item</th>
                  <th class="px-md py-sm">Requested By</th>
                  <th class="px-md py-sm">Qty</th>
                  <th class="px-md py-sm">Duration</th>
                  <th class="px-md py-sm">Purpose</th>
                  <th class="px-md py-sm text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${pendingRows || '<tr><td colspan="6" class="p-md text-center text-on-surface-variant">No pending borrow requests at this time.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Active Borrows Ledger Table -->
        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div class="p-md border-b border-outline-variant flex items-center justify-between">
            <h2 class="font-bold text-on-surface">Active Borrows Ledger</h2>
            <button onclick="Router.go('admin-requests')" class="text-secondary text-xs hover:underline font-bold">View Pending Requests</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
                <tr>
                  <th class="px-md py-sm">Equipment</th>
                  <th class="px-md py-sm">Borrowed By</th>
                  <th class="px-md py-sm">Due Date</th>
                  <th class="px-md py-sm">Status</th>
                  <th class="px-md py-sm text-right">Action</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${alertRows || '<tr><td colspan="5" class="p-md text-center text-on-surface-variant">No active loans found.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  // --- ADMIN INVENTORY ---
  adminInventory() {
    const searchVal = ($('#inventory-search')?.value || '').toLowerCase();
    const filteredItems = State.items.filter(item => {
      const name = (item.name || '').toLowerCase();
      const tag = (item.asset_tag || '').toLowerCase();
      const cat = (item.category || '').toLowerCase();
      return name.includes(searchVal) || tag.includes(searchVal) || cat.includes(searchVal);
    });

    const rows = filteredItems.map(item => {
      const avail = item.available_quantity ?? 0;
      const total = item.total_quantity ?? 0;
      const lended = Math.max(0, total - avail);
      const isLow = avail === 0;

      return `
        <tr class="border-b border-surface-variant hover:bg-surface-container-low transition-colors">
          <td class="px-md py-sm font-medium">
            <button onclick="Router.go('admin-edit-item-${item.id}')" class="font-bold text-secondary hover:underline flex items-center gap-xs">
              <span class="material-symbols-outlined text-[18px] text-primary">inventory_2</span>
              ${h(item.name)}
            </button>
          </td>
          <td class="px-md py-sm text-on-surface-variant font-mono text-xs">${h(item.asset_tag || 'N/A')}</td>
          <td class="px-md py-sm text-on-surface-variant">
            <span class="px-xs py-[2px] bg-surface-container-high rounded text-xs">${h(item.category || 'General')}</span>
          </td>
          <td class="px-md py-sm">
            <span class="font-bold ${isLow ? 'text-error' : 'text-emerald-700'}">${avail}</span>
            <span class="text-on-surface-variant text-xs">/ ${total} available</span>
          </td>
          <td class="px-md py-sm text-on-surface-variant text-xs">
            ${lended > 0 ? `<span class="px-xs py-[2px] bg-amber-100 text-amber-900 rounded font-bold">${lended} lended out</span>` : '<span class="text-on-surface-variant opacity-70">In stock</span>'}
          </td>
          <td class="px-md py-sm text-right space-x-sm">
            <button onclick="Router.go('admin-edit-item-${item.id}')" class="bg-secondary/10 text-secondary hover:bg-secondary/20 px-sm py-xs rounded text-xs font-bold transition-colors">
              Details & Logs
            </button>
            <button onclick="Actions.deleteItem('${item.id}')" class="text-error hover:underline text-xs font-bold">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="space-y-md">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-md">
          <div>
            <h1 class="font-display-lg text-display-lg text-primary">Inventory Management</h1>
            <p class="text-on-surface-variant text-sm">View equipment status, manage stock, edit quantities, and track item log books.</p>
          </div>
          <button onclick="Actions.showAddItemModal()" class="bg-secondary text-on-secondary px-md py-sm rounded-lg font-label-sm text-sm hover:bg-on-secondary-fixed-variant flex items-center gap-xs shadow-xs">
            <span class="material-symbols-outlined text-[18px]">add</span> Add New Equipment
          </button>
        </div>

        <div class="flex items-center gap-md bg-surface-container-lowest p-sm rounded-xl border border-outline-variant">
          <span class="material-symbols-outlined text-on-surface-variant pl-xs">search</span>
          <input type="text" id="inventory-search" oninput="Router.go('admin-inventory')" placeholder="Search items by name, asset tag, or category..." class="w-full bg-transparent border-none text-sm outline-none">
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-xs">
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
              <tr>
                <th class="px-md py-sm">Item Name</th>
                <th class="px-md py-sm">Asset Tag</th>
                <th class="px-md py-sm">Category</th>
                <th class="px-md py-sm">Stock (Avail / Total)</th>
                <th class="px-md py-sm">Lended Status</th>
                <th class="px-md py-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${rows || '<tr><td colspan="6" class="p-md text-center text-on-surface-variant">No inventory items matching criteria.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },
  adminEditItem(itemId) {
    const item = State.items.find(i => i.id === itemId);
    if (!item) return `<div class="p-lg">Item not found</div>`;

    const logs = State.inventoryLogs.filter(l => l.item_id === itemId);
    const activeLoans = State.loans.filter(l => l.item_id === itemId && l.status === 'active');

    const logRows = logs.map(l => `
      <tr class="border-b border-surface-variant">
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(l.created_at)}</td>
        <td class="px-md py-sm font-medium">${h(l.action)}</td>
        <td class="px-md py-sm">${l.change > 0 ? `+${l.change}` : (l.change || '-')}</td>
        <td class="px-md py-sm text-on-surface-variant">${h(l.notes || '')}</td>
      </tr>
    `).join('');

    const loanRows = activeLoans.map(l => `
      <tr class="border-b border-surface-variant">
        <td class="px-md py-sm font-medium">${h(l.profiles?.full_name || l.profiles?.email || 'Member')}</td>
        <td class="px-md py-sm">${l.quantity}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(l.due_date)}</td>
      </tr>
    `).join('');

    return `
      <div class="space-y-lg">
        <button onclick="Router.go('admin-inventory')" class="text-secondary font-bold text-sm flex items-center gap-xs hover:underline"><span class="material-symbols-outlined">arrow_back</span> Back to Inventory</button>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-lg">
          <div class="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant space-y-md">
            <h1 class="font-display-md text-display-md text-primary">${h(item.name)}</h1>
            <p class="text-on-surface-variant text-sm">Asset Tag: <span class="font-mono font-bold">${h(item.asset_tag || 'N/A')}</span> | Category: <span class="font-bold">${h(item.category || 'General')}</span></p>
            <div class="flex gap-lg border-t border-b border-outline-variant py-md">
              <div><span class="block text-xs uppercase font-bold text-on-surface-variant">Available</span><span class="text-2xl font-bold text-emerald-600">${item.available_quantity ?? 0}</span></div>
              <div><span class="block text-xs uppercase font-bold text-on-surface-variant">Total Stock</span><span class="text-2xl font-bold text-primary">${item.total_quantity ?? 0}</span></div>
            </div>
            
            <form onsubmit="Actions.updateInventoryQuantity(event, '${item.id}')" class="space-y-md pt-xs">
              <h3 class="font-bold text-on-surface text-sm">Update Inventory Stock</h3>
              <div>
                <label class="block text-xs uppercase font-label-sm mb-xs text-on-surface-variant">Quantity Change (+ or -)</label>
                <input type="number" id="qty-change" placeholder="e.g. 5 or -2" class="w-full border border-outline-variant rounded px-md py-sm text-sm" required>
              </div>
              <div>
                <label class="block text-xs uppercase font-label-sm mb-xs text-on-surface-variant">Reason for Change</label>
                <input type="text" id="qty-reason" placeholder="e.g. Damaged cable, New stock batch" class="w-full border border-outline-variant rounded px-md py-sm text-sm" required>
              </div>
              <button type="submit" class="bg-secondary text-on-secondary px-md py-sm rounded-lg font-label-sm text-xs hover:bg-on-secondary-fixed-variant flex items-center gap-xs">
                <span class="material-symbols-outlined text-[16px]">edit_note</span> Apply Stock Update
              </button>
            </form>
          </div>
          
          <div class="space-y-lg">
            <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
              <div class="p-md border-b border-outline-variant font-bold text-on-surface text-sm">Active Loans</div>
              <table class="w-full text-left border-collapse">
                <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
                  <tr><th class="px-md py-sm">Borrower</th><th class="px-md py-sm">Qty</th><th class="px-md py-sm">Due Date</th></tr>
                </thead>
                <tbody class="text-sm">${loanRows || '<tr><td colspan="3" class="p-md text-center text-on-surface-variant">No active loans for this item.</td></tr>'}</tbody>
              </table>
            </div>
            <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
              <div class="p-md border-b border-outline-variant font-bold text-on-surface text-sm">Inventory Log Book</div>
              <table class="w-full text-left border-collapse">
                <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
                  <tr><th class="px-md py-sm">Date</th><th class="px-md py-sm">Action</th><th class="px-md py-sm">Change</th><th class="px-md py-sm">Notes</th></tr>
                </thead>
                <tbody class="text-sm">${logRows || '<tr><td colspan="4" class="p-md text-center text-on-surface-variant">No inventory logs recorded.</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // --- ADMIN REQUESTS ---
  adminRequests() {
    const rows = State.requests.map(req => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(req.items?.name || 'Item')}</td>
        <td class="px-md py-sm text-on-surface-variant">${h(req.profiles?.full_name || req.profiles?.email || 'Member')}</td>
        <td class="px-md py-sm text-on-surface-variant">${req.quantity || 1}</td>
        <td class="px-md py-sm text-on-surface-variant">${req.duration_days || 7} Days</td>
        <td class="px-md py-sm text-on-surface-variant">${h(req.purpose || 'Standard Borrow')}</td>
        <td class="px-md py-sm">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${req.status === 'pending' ? 'bg-amber-100 text-amber-800' : req.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-error-container text-error'}">
            ${req.status}
          </span>
        </td>
        <td class="px-md py-sm text-right space-x-xs">
          ${req.status === 'pending' ? `
            <button onclick="Actions.approveRequest('${req.id}')" class="bg-emerald-600 text-white px-xs py-1 rounded text-xs hover:bg-emerald-700">Approve</button>
            <button onclick="Actions.rejectRequest('${req.id}')" class="bg-error text-white px-xs py-1 rounded text-xs hover:bg-error-container">Reject</button>
          ` : '<span class="text-xs text-on-surface-variant">Processed</span>'}
        </td>
      </tr>
    `).join('');

    return `
      <div class="space-y-md">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">Borrow Requests</h1>
          <p class="text-on-surface-variant text-sm">Review member borrowing applications.</p>
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
              <tr>
                <th class="px-md py-sm">Item</th>
                <th class="px-md py-sm">Member</th>
                <th class="px-md py-sm">Qty</th>
                <th class="px-md py-sm">Duration</th>
                <th class="px-md py-sm">Purpose</th>
                <th class="px-md py-sm">Status</th>
                <th class="px-md py-sm text-right">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${rows || '<tr><td colspan="7" class="p-md text-center text-on-surface-variant">No borrow requests.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // --- ADMIN MEMBERS ---
  adminMembers() {
    const rows = State.members.map(m => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(m.full_name || 'Member')}</td>
        <td class="px-md py-sm text-on-surface-variant">${h(m.email)}</td>
        <td class="px-md py-sm">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${m.role === 'admin' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}">
            ${m.role || 'member'}
          </span>
        </td>
        <td class="px-md py-sm text-right">
          <button onclick="Actions.toggleMemberRole('${m.id}', '${m.role === 'admin' ? 'member' : 'admin'}')" class="text-secondary hover:underline text-xs font-bold">
            Make ${m.role === 'admin' ? 'Member' : 'Admin'}
          </button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="space-y-md">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">Member Management</h1>
          <p class="text-on-surface-variant text-sm">View registered members and assign admin privileges.</p>
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
              <tr>
                <th class="px-md py-sm">Full Name</th>
                <th class="px-md py-sm">Email</th>
                <th class="px-md py-sm">Role</th>
                <th class="px-md py-sm text-right">Toggle Role</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${rows || '<tr><td colspan="4" class="p-md text-center text-on-surface-variant">No members found.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // --- MEMBER BROWSE ---
  memberBrowse() {
    const cards = State.items.map(item => {
      const avail = item.available_quantity ?? item.total_stock ?? 1;
      return `
        <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant flex flex-col justify-between space-y-md hover:shadow-md transition-shadow">
          <div class="space-y-xs">
            <div class="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-on-surface mb-sm">
              <span class="material-symbols-outlined">${h(item.icon_name || 'inventory_2')}</span>
            </div>
            <h3 class="font-bold text-on-surface text-base">${h(item.name)}</h3>
            <p class="text-xs text-on-surface-variant line-clamp-2">${h(item.description || 'Club equipment available for borrowing.')}</p>
          </div>
          <div class="flex items-center justify-between pt-sm border-t border-outline-variant">
            <span class="text-xs font-label-sm ${avail > 0 ? 'text-emerald-700 font-bold' : 'text-error font-bold'}">
              ${avail > 0 ? `${avail} Available` : 'Out of Stock'}
            </span>
            <button onclick="Actions.requestItemModal('${item.id}', '${h(item.name)}')" ${avail <= 0 ? 'disabled' : ''} class="bg-secondary text-on-secondary px-md py-xs rounded-lg text-xs font-label-sm hover:bg-on-secondary-fixed-variant disabled:opacity-50">
              Request Borrow
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="space-y-md">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">Browse Equipment Inventory</h1>
          <p class="text-on-surface-variant text-sm">Select items to submit borrow requests.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-md">
          ${cards || '<div class="col-span-full p-md text-center text-on-surface-variant">No items available to browse.</div>'}
        </div>
      </div>
    `;
  },

  // --- MEMBER DASHBOARD ---
  memberDashboard() {
    const loanRows = State.loans.map(loan => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(loan.items?.name || 'Item')}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(loan.borrowed_at)}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(loan.due_date)}</td>
        <td class="px-md py-sm">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${loan.status === 'returned' ? 'bg-surface-container text-on-surface-variant' : new Date(loan.due_date) < new Date() ? 'bg-error-container text-error' : 'bg-emerald-100 text-emerald-800'}">
            ${loan.status === 'returned' ? 'Returned' : new Date(loan.due_date) < new Date() ? 'Overdue' : 'Active'}
          </span>
        </td>
        <td class="px-md py-sm text-right">
          ${loan.status === 'active' ? `
            <button onclick="Actions.returnItem('${loan.id}')" class="text-secondary font-bold text-xs hover:underline">Return Item</button>
          ` : '<span class="text-xs text-on-surface-variant">Returned</span>'}
        </td>
      </tr>
    `).join('');

    const reqRows = State.requests.map(req => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(req.items?.name || 'Item')}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(req.requested_at)}</td>
        <td class="px-md py-sm">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${req.status === 'pending' ? 'bg-amber-100 text-amber-800' : req.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-error-container text-error'}">
            ${req.status}
          </span>
        </td>
      </tr>
    `).join('');

    return `
      <div class="space-y-lg">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">My Dashboard</h1>
          <p class="text-on-surface-variant text-sm">View your active borrowed items and status of your requests.</p>
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div class="p-md border-b border-outline-variant font-bold text-on-surface">My Active & Past Loans</div>
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
              <tr>
                <th class="px-md py-sm">Item</th>
                <th class="px-md py-sm">Borrowed On</th>
                <th class="px-md py-sm">Due Date</th>
                <th class="px-md py-sm">Status</th>
                <th class="px-md py-sm text-right">Action</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${loanRows || '<tr><td colspan="5" class="p-md text-center text-on-surface-variant">You have no active or past loans.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div class="p-md border-b border-outline-variant font-bold text-on-surface">My Borrow Requests</div>
          <table class="w-full text-left border-collapse">
            <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
              <tr>
                <th class="px-md py-sm">Item</th>
                <th class="px-md py-sm">Requested Date</th>
                <th class="px-md py-sm">Status</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              ${reqRows || '<tr><td colspan="3" class="p-md text-center text-on-surface-variant">No requests submitted.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // --- PROFILE VIEW ---
  memberProfile() {
    const myLoans = State.loans.filter(l => l.user_id === State.user.id);
    const loanRows = myLoans.map(l => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(l.items?.name || 'Item')}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(l.borrowed_at)}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(l.due_date)}</td>
        <td class="px-md py-sm"><span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${l.status === 'returned' ? 'bg-surface-container text-on-surface-variant' : new Date(l.due_date) < new Date() ? 'bg-error-container text-error' : 'bg-emerald-100 text-emerald-800'}">${l.status === 'returned' ? 'Returned' : new Date(l.due_date) < new Date() ? 'Overdue' : 'Active'}</span></td>
        <td class="px-md py-sm text-right">${l.status === 'active' ? `<button onclick="Actions.returnItem('${l.id}')" class="text-secondary font-bold text-xs hover:underline">Return</button>` : '<span class="text-xs text-on-surface-variant">Returned</span>'}</td>
      </tr>
    `).join('');

    const myRequests = State.requests.filter(r => r.user_id === State.user.id);
    const reqRows = myRequests.map(r => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(r.items?.name || 'Item')}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(r.requested_at)}</td>
        <td class="px-md py-sm text-on-surface-variant">${r.duration_days || 7} Days</td>
        <td class="px-md py-sm"><span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${r.status === 'pending' ? 'bg-amber-100 text-amber-800' : r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-error-container text-error'}">${r.status}</span></td>
      </tr>
    `).join('');

    return `
      <div class="space-y-lg max-w-5xl">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">My Profile & Lending History</h1>
          <p class="text-on-surface-variant text-sm">Manage profile details and view borrowing history.</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-lg">
          <div class="md:col-span-1 bg-surface-container-lowest p-lg rounded-xl border border-outline-variant space-y-md h-fit">
            <h2 class="font-bold text-lg text-on-surface flex items-center gap-sm"><span class="material-symbols-outlined text-secondary">person</span> Account Profile</h2>
            <form onsubmit="Actions.updateProfile(event)" class="space-y-md">
              <div>
                <label class="block text-xs font-label-sm uppercase text-on-surface-variant mb-xs">Full Name</label>
                <input id="profile-name-input" type="text" required value="${h(State.profile?.full_name || '')}" class="w-full border border-outline-variant rounded px-md py-sm text-sm">
              </div>
              <div>
                <label class="block text-xs font-label-sm uppercase text-on-surface-variant mb-xs">Email Address</label>
                <input type="email" disabled value="${h(State.user?.email || '')}" class="w-full border border-outline-variant rounded px-md py-sm text-sm bg-surface-container text-on-surface-variant opacity-75">
              </div>
              <div>
                <label class="block text-xs font-label-sm uppercase text-on-surface-variant mb-xs">Role</label>
                <span class="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-full text-xs font-bold uppercase inline-block">${h(State.profile?.role || 'member')}</span>
              </div>
              <button type="submit" class="w-full bg-secondary text-on-secondary py-sm rounded-lg text-xs font-label-sm hover:bg-on-secondary-fixed-variant transition-colors flex items-center justify-center gap-xs"><span class="material-symbols-outlined text-[16px]">save</span> Save Profile</button>
            </form>
          </div>
          <div class="md:col-span-2 space-y-lg">
            <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
              <div class="p-md border-b border-outline-variant font-bold text-on-surface text-sm">Borrowing & Loan History</div>
              <table class="w-full text-left border-collapse">
                <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
                  <tr><th class="px-md py-sm">Item</th><th class="px-md py-sm">Borrowed</th><th class="px-md py-sm">Due Date</th><th class="px-md py-sm">Status</th><th class="px-md py-sm text-right">Action</th></tr>
                </thead>
                <tbody class="text-sm">${loanRows || '<tr><td colspan="5" class="p-md text-center text-on-surface-variant">No borrowing history found.</td></tr>'}</tbody>
              </table>
            </div>
            <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
              <div class="p-md border-b border-outline-variant font-bold text-on-surface text-sm">Request History</div>
              <table class="w-full text-left border-collapse">
                <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
                  <tr><th class="px-md py-sm">Item</th><th class="px-md py-sm">Date</th><th class="px-md py-sm">Duration</th><th class="px-md py-sm">Status</th></tr>
                </thead>
                <tbody class="text-sm">${reqRows || '<tr><td colspan="4" class="p-md text-center text-on-surface-variant">No requests submitted.</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  },
  adminProfile() { return this.memberProfile(); },

  // --- MEMBER SUPPORT ---
  memberSupport() {
    return `
      <div class="max-w-md bg-surface-container-lowest p-lg rounded-xl border border-outline-variant space-y-md">
        <h1 class="font-display-md text-display-md text-primary">Support & Help</h1>
        <p class="text-sm text-on-surface-variant">Need assistance with equipment? Contact ATS Club management.</p>
        <form onsubmit="event.preventDefault(); toast('Ticket submitted!', 'success');" class="space-y-md">
          <div>
            <label class="block text-xs uppercase font-label-sm mb-xs">Issue Subject</label>
            <input required type="text" class="w-full border border-outline-variant rounded p-sm text-sm" placeholder="Damaged cables, missing kit...">
          </div>
          <div>
            <label class="block text-xs uppercase font-label-sm mb-xs">Description</label>
            <textarea required class="w-full border border-outline-variant rounded p-sm text-sm" rows="3" placeholder="Provide details..."></textarea>
          </div>
          <button type="submit" class="bg-secondary text-on-secondary px-md py-sm rounded text-xs font-label-sm">Submit Ticket</button>
        </form>
      </div>
    `;
  }
};

// --- ACTIONS ---
const Actions = {
  async approveRequest(reqId) {
    try {
      const req = State.requests.find(r => r.id === reqId);
      const res = await supabaseClient.rpc('approve_request', { p_request_id: reqId });
      if (res.error) throw new Error(res.error);

      if (req) {
        const qty = req.quantity || 1;
        const itemName = req.items?.name || 'Equipment';
        const memberName = req.profiles?.full_name || req.profiles?.email || 'Member';
        const noteText = `${qty} ${itemName} is lended to ${memberName}`;

        // Ensure inventory log is recorded if RPC did not log it
        await supabaseClient.from('inventory_logs').insert([{
          item_id: req.item_id,
          admin_id: State.user.id,
          action: 'lend',
          change: -qty,
          notes: noteText
        }]).catch(() => {});
      }

      toast('Request approved and item checked out!', 'success');
      await App.loadAdminData();
      Router.go('admin-requests');
    } catch (err) {
      toast(err.message || 'Error approving request', 'error');
    }
  },

  async rejectRequest(reqId) {
    try {
      const res = await supabaseClient.rpc('reject_request', { p_request_id: reqId });
      if (res.error) throw new Error(res.error);
      toast('Request rejected', 'info');
      await App.loadAdminData();
      Router.go('admin-requests');
    } catch (err) {
      toast(err.message || 'Error rejecting request', 'error');
    }
  },

  async returnItem(loanId) {
    try {
      const loan = State.loans.find(l => l.id === loanId);
      const res = await supabaseClient.rpc('return_item', { p_loan_id: loanId });
      if (res.error) throw new Error(res.error);

      if (loan) {
        const qty = loan.quantity || 1;
        const itemName = loan.items?.name || 'Equipment';
        const memberName = loan.profiles?.full_name || loan.profiles?.email || 'Member';
        const noteText = `${qty} of ${itemName} is returned by ${memberName}`;

        await supabaseClient.from('inventory_logs').insert([{
          item_id: loan.item_id,
          admin_id: State.user?.id || null,
          action: 'return',
          change: qty,
          notes: noteText
        }]).catch(() => {});
      }

      toast('Item returned successfully!', 'success');
      if (State.profile?.role === 'admin') {
        await App.loadAdminData();
        Router.go('admin-dashboard');
      } else {
        await App.loadMemberData();
        Router.go('member-dashboard');
      }
    } catch (err) {
      toast(err.message || 'Error returning item', 'error');
    }
  },

  async updateProfile(e) {
    e.preventDefault();
    const name = $('#profile-name-input').value.trim();
    if (!name) return toast('Name cannot be empty', 'error');
    try {
      const { error } = await supabaseClient.from('profiles').update({ full_name: name }).eq('id', State.user.id);
      if (error) throw error;
      State.profile.full_name = name;
      toast('Profile updated successfully!', 'success');
      App.init(); // Refresh UI to update header
      Router.go(State.activeRoute);
    } catch (err) {
      toast(err.message || 'Error updating profile', 'error');
    }
  },

  async toggleMemberRole(memberId, newRole) {
    try {
      const { error } = await supabaseClient.from('profiles').update({ role: newRole }).eq('id', memberId);
      if (error) throw error;
      toast(`Role updated to ${newRole}`, 'success');
      await App.loadAdminData();
      Router.go('admin-members');
    } catch (err) {
      toast(err.message || 'Error updating role', 'error');
    }
  },

  requestItemModal(itemId, itemName) {
    const qty = prompt(`Request quantity for "${itemName}":`, "1");
    if (!qty) return;
    const days = prompt(`Request borrow duration for "${itemName}" (in days):`, "7");
    if (!days) return;
    const purpose = prompt(`Purpose for borrowing "${itemName}":`, "Standard Borrow");
    if (!purpose) return;

    this.submitBorrowRequest(itemId, parseInt(qty, 10), parseInt(days, 10), purpose);
  },

  async submitBorrowRequest(itemId, qty, durationDays, purpose) {
    try {
      const res = await supabaseClient.rpc('request_item', {
        p_item_id: itemId,
        p_quantity: qty,
        p_duration_days: durationDays,
        p_purpose: purpose
      });
      if (res.error) throw new Error(res.error);
      toast('Borrow request submitted!', 'success');
      await App.loadMemberData();
      Router.go('member-dashboard');
    } catch (err) {
      toast(err.message || 'Error submitting request', 'error');
    }
  },

  showAddItemModal() {
    const name = prompt("Item Name:");
    if (!name) return;
    const tag = prompt("Asset Tag (e.g. AST-1001):", "AST-" + Math.floor(1000 + Math.random()*9000));
    const cat = prompt("Category (Electronics, Cameras, Audio, Accessories):", "Electronics");
    const stock = prompt("Total Quantity Stock:", "5");

    this.addItem({ name, asset_tag: tag, category: cat, total_quantity: parseInt(stock, 10) || 1, available_quantity: parseInt(stock, 10) || 1 });
  },

  async addItem(itemData) {
    try {
      const { data, error } = await supabaseClient.from('items').insert([itemData]).select().single();
      if (error) throw error;

      if (data && data.id) {
        await supabaseClient.from('inventory_logs').insert([{
          item_id: data.id,
          admin_id: State.user.id,
          action: 'Item Added',
          change: itemData.total_quantity || 1,
          notes: 'Initial inventory addition'
        }]);
      }

      toast('New item added to inventory!', 'success');
      await App.loadAdminData();
      Router.go('admin-inventory');
    } catch (err) {
      toast(err.message || 'Error adding item', 'error');
    }
  },

  async deleteItem(itemId) {
    if (!confirm('Are you sure you want to delete this equipment item from inventory?')) return;
    try {
      const { error } = await supabaseClient.from('items').delete().eq('id', itemId);
      if (error) throw error;
      toast('Item deleted', 'info');
      await App.loadAdminData();
      Router.go('admin-inventory');
    } catch (err) {
      toast(err.message || 'Error deleting item', 'error');
    }
  },

  async updateInventoryQuantity(e, itemId) {
    e.preventDefault();
    const changeInput = $('#qty-change');
    const reasonInput = $('#qty-reason');
    const change = parseInt(changeInput.value, 10);
    const reason = reasonInput.value ? reasonInput.value.trim() : '';

    if (isNaN(change) || change === 0) return toast('Invalid quantity change', 'error');
    if (!reason) return toast('Please provide a reason for the change', 'error');

    const item = State.items.find(i => i.id === itemId);
    if (!item) return toast('Item not found', 'error');

    const newTotal = item.total_quantity + change;
    const newAvail = item.available_quantity + change;

    if (newTotal < 0 || newAvail < 0) return toast('Quantity cannot be negative', 'error');

    try {
      const { error: itemErr } = await supabaseClient.from('items').update({
        total_quantity: newTotal,
        available_quantity: newAvail
      }).eq('id', itemId);

      if (itemErr) throw itemErr;

      const { error: logErr } = await supabaseClient.from('inventory_logs').insert([{
        item_id: itemId,
        admin_id: State.user.id,
        action: change < 0 ? 'Quantity Reduced' : 'Quantity Added',
        change: change,
        notes: reason
      }]);

      if (logErr) throw logErr;

      toast('Inventory updated!', 'success');
      await App.loadAdminData();
      Router.go(`admin-edit-item-${itemId}`);
    } catch (err) {
      toast(err.message || 'Error updating inventory', 'error');
    }
  }

};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => App.init());

