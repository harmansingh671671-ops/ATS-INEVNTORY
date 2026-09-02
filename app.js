/* =====================================================================================
   ATS CLUB — INVENTORY MANAGEMENT SYSTEM (FULL STACK SUPABASE)
   ===================================================================================== */

let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';

async function loadEnvConfig() {
  // If we already have a client, skip re‑creating it – this stops the "Multiple GoTrueClient instances" warning.
  if (supabaseClient) return;

  let env = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };

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

  const runtimeEnv = window.ENV || {};
  SUPABASE_URL = runtimeEnv.SUPABASE_URL || env.SUPABASE_URL;
  SUPABASE_ANON_KEY = runtimeEnv.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

  if (!window.supabase) {
    console.error('Supabase JS SDK failed to load. Check the script include order.');
    return;
  }

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error('Supabase config is missing. Set window.ENV.SUPABASE_URL and window.ENV.SUPABASE_ANON_KEY before loading app.js.');
  }
}

let supabaseClient = null;
let deferredInstallPrompt = null;

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

const INVENTORY_IMAGE_BUCKET = 'inventory-images';
const INVENTORY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const INVENTORY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function inventoryImage(item, className = 'w-full h-full object-cover') {
  const fallbackIcon = h(item.icon_name || 'inventory_2');
  if (!item.image_url) {
    return `<div class="w-full h-full flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-3xl">${fallbackIcon}</span></div>`;
  }
  return `<img src="${h(item.image_url)}" alt="${h(item.name)}" class="${className}" loading="lazy" onerror="this.onerror=null; this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');"><div class="hidden w-full h-full items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-3xl">${fallbackIcon}</span></div>`;
}

async function uploadInventoryImage(file) {
  if (!file) return { publicUrl: null, storagePath: null };
  if (!INVENTORY_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Images must be JPEG, PNG, or WebP files.');
  }
  if (file.size > INVENTORY_IMAGE_MAX_BYTES) {
    throw new Error('Images must be 5 MB or smaller.');
  }
  if (!supabaseClient || !State.user) throw new Error('You must be signed in to upload an image.');

  const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  const storagePath = `${State.user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabaseClient.storage
    .from(INVENTORY_IMAGE_BUCKET)
    .upload(storagePath, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;

  const { data } = supabaseClient.storage.from(INVENTORY_IMAGE_BUCKET).getPublicUrl(storagePath);
  if (!data?.publicUrl) {
    await supabaseClient.storage.from(INVENTORY_IMAGE_BUCKET).remove([storagePath]);
    throw new Error('The image URL could not be generated.');
  }
  return { publicUrl: data.publicUrl, storagePath };
}

function isMobileLayout() {
  return window.innerWidth < 768;
}

function toast(msg, type = 'info') {
  const c = $('#toast-container');
  if (!c) return;

  // Extract message if msg is an error object
  let displayMsg = msg;
  if (typeof msg === 'object' && msg !== null) {
      displayMsg = msg.message || msg.error || JSON.stringify(msg);
  }

  const bg = type === 'error' ? 'bg-error text-on-error' : type === 'success' ? 'bg-emerald-600 text-white' : 'bg-primary-container text-on-primary-container';
  const div = document.createElement('div');
  div.className = `${bg} px-md py-sm rounded-lg shadow-lg text-sm font-medium transition-all duration-300 flex items-center justify-between min-w-[240px]`;
  div.innerHTML = `<span>${h(displayMsg)}</span><button onclick="this.parentElement.remove()" class="ml-sm font-bold">&times;</button>`;
  c.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// --- MODAL LOGIC ---
function openModal(contentHTML) {
  const modal = $('#modal-container');
  if (!modal) return;
  modal.innerHTML = `
    <div class="bg-surface-container-lowest p-lg rounded-xl w-full max-w-md relative">
      ${contentHTML}
      <button class="absolute top-2 right-2 text-xl text-on-surface-variant hover:text-primary" onclick="closeModal()">&times;</button>
    </div>
  `;
  modal.classList.remove('hidden');
}
function closeModal() {
  const modal = $('#modal-container');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.innerHTML = '';
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

    if (!supabaseClient) {
      alertEl.textContent = 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in the deployed app configuration.';
      alertEl.classList.remove('hidden');
      return;
    }

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
    $('#auth-view').classList.add('flex');
    toast('Logged out', 'info');
  }
};

// --- APP CORE ---
const App = {
  refreshTimer: null,
  realtimeChannel: null,

  initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      this.updateInstallBanner();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      this.dismissInstallBanner(true);
    });

    this.updateInstallBanner();
  },

  isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  },

  isIosBrowser() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !this.isRunningStandalone();
  },

  updateInstallBanner() {
    const banner = $('#install-banner');
    if (!banner || !State.user || !isMobileLayout() || this.isRunningStandalone()) return;
    if (localStorage.getItem('ats-install-banner-dismissed') === 'true') return;

    const message = $('#install-banner-message');
    const action = $('#install-banner-action');
    if (this.isIosBrowser()) {
      message.textContent = 'Tap Share, then Add to Home Screen to install the app.';
      action.textContent = 'Got it';
      action.onclick = () => this.dismissInstallBanner();
      banner.classList.remove('hidden');
      return;
    }

    if (deferredInstallPrompt) {
      message.textContent = 'Install the app for quicker access from your phone.';
      action.textContent = 'Install App';
      action.onclick = () => this.installApp();
      banner.classList.remove('hidden');
    }
  },

  async installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    this.dismissInstallBanner(true);
  },

  dismissInstallBanner(installed = false) {
    const banner = $('#install-banner');
    if (banner) banner.classList.add('hidden');
    if (!installed) localStorage.setItem('ats-install-banner-dismissed', 'true');
  },

  async init() {
    await loadEnvConfig();
    Auth.switchTab('login');

    if (!supabaseClient) {
      const alertEl = $('#auth-alert');
      if (alertEl) {
        alertEl.textContent = 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY before deployment.';
        alertEl.classList.remove('hidden');
      }
      $('#app-view').classList.add('hidden');
      $('#auth-view').classList.remove('hidden');
      $('#auth-view').classList.add('flex');
      return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      $('#app-view').classList.add('hidden');
      $('#auth-view').classList.remove('hidden');
      $('#auth-view').classList.add('flex');
      return;
    }

    State.user = session.user;

    // Fetch Profile
    let { data: profile } = await supabaseClient
      .from('profiles')
      .select('id,email,full_name,role')
      .eq('id', State.user.id)
      .single();
    if (!profile) {
      // Create default profile if not present
      const metaName = State.user.user_metadata?.full_name || State.user.email.split('@')[0];
      const { data: newProf } = await supabaseClient.from('profiles').insert([{ id: State.user.id, email: State.user.email, full_name: metaName, role: 'member' }]).select().single();
      profile = newProf || { id: State.user.id, email: State.user.email, full_name: metaName, role: 'member' };
    }

    State.profile = profile;

    $('#auth-view').classList.add('hidden');
    $('#auth-view').classList.remove('flex');
    $('#app-view').classList.remove('hidden');
    this.updateInstallBanner();

    if (State.profile.role === 'admin') {
      if (isMobileLayout()) {
        this.renderMobileAdminShell();
      } else {
        this.renderAdminWindow();
      }
      await this.loadAdminData();
      Router.go('admin-dashboard');
    } else {
      if (isMobileLayout()) {
        this.renderMobileMemberShell();
      } else {
        this.renderMemberWindow();
      }
      await this.loadMemberData();
      Router.go('member-browse');
    }

    this.startBackgroundSync();
  },

  async refreshCurrentView() {
    if (!State.user) return;

    try {
      if (State.profile?.role === 'admin') {
        await this.loadAdminData();
        if (!State.activeRoute || State.activeRoute.startsWith('admin')) {
          Router.go(State.activeRoute || 'admin-dashboard');
        }
      } else {
        await this.loadMemberData();
        if (!State.activeRoute || State.activeRoute.startsWith('member')) {
          Router.go(State.activeRoute || 'member-browse');
        }
      }
    } catch (err) {
      console.error('refreshCurrentView error:', err);
    }
  },

  startBackgroundSync() {
    if (this.realtimeChannel) return;

    this.realtimeChannel = supabaseClient.channel('inventory-live-updates');

    ['items', 'requests', 'loans', 'inventory_log', 'profiles'].forEach(table => {
      this.realtimeChannel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table
      }, () => {
        if (document.visibilityState === 'visible') {
          this.refreshCurrentView();
        }
      });
    });

    this.realtimeChannel.subscribe();

    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && State.user) {
        this.refreshCurrentView();
      }
    }, 10000);
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
              <span class="material-symbols-outlined">inventory_2</span> Inventory
            </button>
            <button onclick="Router.go('admin-requests')" data-nav="admin-requests" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm justify-between">
              <span class="flex items-center gap-md"><span class="material-symbols-outlined">sync_alt</span> Requests</span>
              <span id="pending-badge" class="bg-error text-on-error text-[10px] px-2 py-0.5 rounded-full font-bold hidden">0</span>
            </button>
            <button onclick="Router.go('admin-loans')" data-nav="admin-loans" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">assignment</span> Loans
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

  renderMobileAdminShell() {
    const app = $('#app-view');
    app.className = 'flex flex-col min-h-screen bg-surface';
    app.innerHTML = `
      <div id="mobile-drawer-backdrop" class="fixed inset-0 bg-black/30 z-30 hidden" onclick="App.closeMobileDrawer()"></div>

      <aside id="mobile-drawer" class="fixed inset-y-0 left-0 z-40 w-72 bg-surface-container-lowest border-r border-outline-variant shadow-xl transform -translate-x-full transition-transform duration-200 ease-in-out flex flex-col p-md">
        <div class="flex items-center gap-sm mb-lg">
          <div class="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container">
            <span class="material-symbols-outlined text-[24px]">inventory_2</span>
          </div>
          <div>
            <div class="font-display-md text-display-md text-primary font-bold">ATS CLUB</div>
            <div class="text-[10px] font-label-sm uppercase bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full inline-block">Admin Portal</div>
          </div>
        </div>

        <nav class="flex-1 flex flex-col gap-sm mt-md">
          <button data-nav="admin-dashboard" onclick="App.closeMobileDrawer(); Router.go('admin-dashboard')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">dashboard</span>
            <span>Dashboard</span>
          </button>
          <button data-nav="admin-inventory" onclick="App.closeMobileDrawer(); Router.go('admin-inventory')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">inventory_2</span>
            <span>Inventory</span>
          </button>
          <button data-nav="admin-requests" onclick="App.closeMobileDrawer(); Router.go('admin-requests')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">sync_alt</span>
            <span>Requests</span>
          </button>
          <button data-nav="admin-loans" onclick="App.closeMobileDrawer(); Router.go('admin-loans')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">assignment</span>
            <span>Loans</span>
          </button>
          <button data-nav="admin-members" onclick="App.closeMobileDrawer(); Router.go('admin-members')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">group</span>
            <span>Members</span>
          </button>
        </nav>

        <div class="border-t border-outline-variant pt-md mt-md flex items-center justify-between">
          <div class="min-w-0">
            <div class="font-bold text-sm truncate">${h(State.profile?.full_name || State.user?.email)}</div>
            <div class="text-[11px] text-on-surface-variant truncate">${h(State.user?.email)}</div>
          </div>
          <button class="rounded-full p-2 text-error" onclick="Auth.logout()" aria-label="Logout">
            <span class="material-symbols-outlined">logout</span>
          </button>
        </div>
      </aside>

      <header class="w-full bg-surface-container-lowest border-b border-outline-variant px-md py-sm flex items-center justify-between sticky top-0 z-20">
        <button class="p-2 rounded-full text-on-surface-variant" onclick="App.toggleMobileDrawer()" aria-label="Open navigation">
          <span class="material-symbols-outlined">menu</span>
        </button>
        <h1 class="font-display-md text-display-md text-primary font-bold">ATS CLUB</h1>
        <button class="rounded-full p-2 text-on-surface-variant" onclick="Auth.logout()" aria-label="Logout">
          <span class="material-symbols-outlined">logout</span>
        </button>
      </header>
      <main id="main-content" class="flex-1 pb-24 px-md pt-md"></main>
    `;
    App.syncMobileDrawerState();
  },

  renderMobileMemberShell() {
    const app = $('#app-view');
    app.className = 'flex flex-col min-h-screen bg-surface';
    app.innerHTML = `
      <div id="mobile-drawer-backdrop" class="fixed inset-0 bg-black/30 z-30 hidden" onclick="App.closeMobileDrawer()"></div>

      <aside id="mobile-drawer" class="fixed inset-y-0 left-0 z-40 w-72 bg-surface-container-lowest border-r border-outline-variant shadow-xl transform -translate-x-full transition-transform duration-200 ease-in-out flex flex-col p-md">
        <div class="flex items-center gap-sm mb-lg">
          <div class="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container">
            <span class="material-symbols-outlined text-[24px]">inventory_2</span>
          </div>
          <div>
            <div class="font-display-md text-display-md text-primary font-bold">ATS CLUB</div>
            <div class="text-[10px] font-label-sm uppercase bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full inline-block">Member Portal</div>
          </div>
        </div>

        <nav class="flex-1 flex flex-col gap-sm mt-md">
          <button data-nav="member-browse" onclick="App.closeMobileDrawer(); Router.go('member-browse')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">inventory_2</span>
            <span>Browse Inventory</span>
          </button>
          <button data-nav="member-dashboard" onclick="App.closeMobileDrawer(); Router.go('member-dashboard')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">dashboard</span>
            <span>Dashboard</span>
          </button>
          <button data-nav="member-activities" onclick="App.closeMobileDrawer(); Router.go('member-activities')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">history</span>
            <span>Activities</span>
          </button>
          <button data-nav="member-support" onclick="App.closeMobileDrawer(); Router.go('member-support')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">help</span>
            <span>Support</span>
          </button>
          <button data-nav="member-profile" onclick="App.closeMobileDrawer(); Router.go('member-profile')" class="nav-item flex items-center gap-md px-md py-sm rounded-lg text-left text-on-surface-variant text-base">
            <span class="material-symbols-outlined">person</span>
            <span>Profile</span>
          </button>
        </nav>

        <div class="border-t border-outline-variant pt-md mt-md flex items-center justify-between">
          <div class="min-w-0">
            <div class="font-bold text-sm truncate">${h(State.profile?.full_name || State.user?.email)}</div>
            <div class="text-[11px] text-on-surface-variant truncate">${h(State.user?.email)}</div>
          </div>
          <button class="rounded-full p-2 text-error" onclick="Auth.logout()" aria-label="Logout">
            <span class="material-symbols-outlined">logout</span>
          </button>
        </div>
      </aside>

      <header class="w-full bg-surface-container-lowest border-b border-outline-variant px-md py-sm flex items-center justify-between sticky top-0 z-20">
        <button class="p-2 rounded-full text-on-surface-variant" onclick="App.toggleMobileDrawer()" aria-label="Open navigation">
          <span class="material-symbols-outlined">menu</span>
        </button>
        <h1 class="font-display-md text-display-md text-primary font-bold">ATS CLUB</h1>
        <button class="rounded-full p-2 text-on-surface-variant" onclick="Auth.logout()" aria-label="Logout">
          <span class="material-symbols-outlined">logout</span>
        </button>
      </header>
      <main id="main-content" class="flex-1 pb-24 px-md pt-md"></main>
    `;
    App.syncMobileDrawerState();
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
            <button onclick="Router.go('member-activities')" data-nav="member-activities" class="nav-item flex items-center gap-md px-md py-sm rounded-lg font-medium text-on-surface-variant hover:bg-surface-container text-sm">
              <span class="material-symbols-outlined">history</span> Activities
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
        supabaseClient.from('inventory_log').select('*, profiles!admin_id(full_name, email)').order('created_at', { ascending: false })
      ]);

      console.log('loadAdminData - items:', State.items.length);
      console.log('loadAdminData - requests:', State.requests.length);

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
        supabaseClient.from('inventory_log').select('*, profiles!admin_id(full_name, email)').order('created_at', { ascending: false })
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
  },

  toggleMobileDrawer() {
    const drawer = document.getElementById('mobile-drawer');
    const backdrop = document.getElementById('mobile-drawer-backdrop');
    if (!drawer || !backdrop) return;

    const isOpen = drawer.classList.contains('translate-x-0');
    drawer.classList.toggle('-translate-x-full', isOpen);
    drawer.classList.toggle('translate-x-0', !isOpen);
    backdrop.classList.toggle('hidden', isOpen);
    backdrop.classList.toggle('block', !isOpen);
  },

  closeMobileDrawer() {
    const drawer = document.getElementById('mobile-drawer');
    const backdrop = document.getElementById('mobile-drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.classList.add('-translate-x-full');
    drawer.classList.remove('translate-x-0');
    backdrop.classList.add('hidden');
    backdrop.classList.remove('block');
  },

  syncMobileDrawerState() {
    const drawer = document.getElementById('mobile-drawer');
    const backdrop = document.getElementById('mobile-drawer-backdrop');
    if (!drawer || !backdrop) return;
    const isOpen = drawer.classList.contains('translate-x-0');
    drawer.classList.toggle('-translate-x-full', !isOpen);
    drawer.classList.toggle('translate-x-0', isOpen);
    backdrop.classList.toggle('hidden', !isOpen);
    backdrop.classList.toggle('block', isOpen);
  }
};

// --- ROUTER ---
const Router = {
  go(routeName) {
    State.activeRoute = routeName;

    const isMobile = isMobileLayout();
    const currentMain = $('#main-content');
    if (!currentMain) return;

    const activeNav = document.querySelectorAll('.nav-item');
    activeNav.forEach(el => {
      const matches = el.getAttribute('data-nav') === routeName;
      if (matches) {
        el.classList.add('bg-secondary', 'text-on-secondary', 'font-bold');
        el.classList.remove('text-on-surface-variant', 'hover:bg-surface-container');
      } else {
        el.classList.remove('bg-secondary', 'text-on-secondary', 'font-bold');
        el.classList.add('text-on-surface-variant', 'hover:bg-surface-container');
      }
    });

    if (isMobile) {
      App.closeMobileDrawer();
    }

    if (routeName.startsWith('admin-edit-item-')) {
      const itemId = routeName.replace('admin-edit-item-', '');
      currentMain.innerHTML = Views.adminEditItem(itemId);
      return;
    }

    if (isMobile && routeName === 'admin-dashboard') {
      currentMain.innerHTML = Views.mobileAdminDashboard();
      return;
    }

    if (isMobile && routeName === 'member-browse') {
      currentMain.innerHTML = Views.mobileMemberBrowse();
      return;
    }

    if (isMobile && routeName === 'member-dashboard') {
      currentMain.innerHTML = Views.mobileMemberDashboard();
      return;
    }

    if (isMobile && routeName === 'member-activities') {
      currentMain.innerHTML = Views.memberActivities();
      return;
    }

    if (isMobile && routeName === 'member-support') {
      currentMain.innerHTML = Views.mobileMemberSupport();
      return;
    }

    switch(routeName) {
      case 'admin-dashboard': currentMain.innerHTML = Views.adminDashboard(); break;
      case 'admin-inventory': currentMain.innerHTML = Views.adminInventory(); break;
      case 'admin-requests': currentMain.innerHTML = Views.adminRequests(); break;
      case 'admin-loans': currentMain.innerHTML = Views.adminLoans(); break;
      case 'admin-members': currentMain.innerHTML = Views.adminMembers(); break;
      case 'admin-profile': currentMain.innerHTML = Views.adminProfile(); break;
      case 'member-browse': currentMain.innerHTML = Views.memberBrowse(); break;
      case 'member-dashboard': currentMain.innerHTML = Views.memberDashboard(); break;
      case 'member-activities': currentMain.innerHTML = Views.memberActivities(); break;
      case 'member-profile': currentMain.innerHTML = Views.memberProfile(); break;
      case 'member-support': currentMain.innerHTML = Views.memberSupport(); break;
      default: currentMain.innerHTML = '<div class="p-lg">Page under construction</div>';
    }
  }
};

// --- VIEWS ---
const Views = {
  adminDashboardData() {
    const pendingRequests = State.requests.filter(request => String(request.status || '').toLowerCase() === 'pending');
    const pendingReturns = pendingRequests.filter(request => request.purpose === 'Return');
    const activeLoans = State.loans.filter(loan => loan.status === 'active');
    const overdueLoans = activeLoans.filter(loan => new Date(loan.due_date) < new Date());
    const dueSoonLoans = activeLoans.filter(loan => {
      const daysUntilDue = (new Date(loan.due_date) - new Date()) / 86400000;
      return daysUntilDue >= 0 && daysUntilDue <= 7;
    });
    const totalUnits = State.items.reduce((total, item) => total + (item.total_quantity ?? item.total_stock ?? 0), 0);
    const availableUnits = State.items.reduce((total, item) => total + (item.available_quantity ?? 0), 0);
    const lowStockItems = State.items.filter(item => (item.available_quantity ?? 0) <= 1);
    const recentActivity = [
      ...State.inventoryLogs.map(log => ({ date: log.created_at, icon: 'inventory_2', title: log.action || 'Inventory updated', detail: log.notes || 'Inventory activity' })),
      ...State.requests.map(request => ({ date: request.requested_at, icon: request.purpose === 'Return' ? 'assignment_return' : 'sync_alt', title: `${request.purpose === 'Return' ? 'Return' : 'Borrow'} request`, detail: `${request.items?.name || 'Equipment'} · ${request.status}` })),
      ...State.loans.map(loan => ({ date: loan.borrowed_at, icon: 'shopping_bag', title: loan.status === 'returned' ? 'Loan returned' : 'Loan started', detail: `${loan.items?.name || 'Equipment'} · ${loan.profiles?.full_name || 'Member'}` }))
    ].filter(activity => activity.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    return { pendingRequests, pendingReturns, activeLoans, overdueLoans, dueSoonLoans, totalUnits, availableUnits, lowStockItems, recentActivity };
  },

  mobileAdminDashboard() {
    const data = this.adminDashboardData();
    const requestCards = data.pendingRequests.slice(0, 3).map(request => {
      const isReturnRequest = request.purpose === 'Return';
      return `<div onclick="Router.go('admin-requests')" class="rounded-lg border border-outline-variant p-sm cursor-pointer hover:bg-surface-container-low"><div class="flex items-start justify-between gap-sm"><div class="min-w-0"><div class="font-bold text-sm truncate">${h(request.items?.name || 'Equipment')}</div><div class="text-xs text-on-surface-variant truncate">${h(request.profiles?.full_name || 'Member')} · ${request.quantity || 1} unit(s)</div></div><span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ${isReturnRequest ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'}">${isReturnRequest ? 'Return' : 'Borrow'}</span></div><div class="flex items-center justify-between gap-sm mt-sm"><span class="text-xs text-amber-700 font-bold">Pending review</span><div class="flex gap-xs"><button onclick="event.stopPropagation(); ${isReturnRequest ? `Actions.confirmReturn('${request.id}')` : `Actions.approveRequest('${request.id}')`}" class="bg-emerald-600 text-white px-2 py-1 rounded text-[10px] font-bold">${isReturnRequest ? 'Confirm' : 'Approve'}</button><button onclick="event.stopPropagation(); ${isReturnRequest ? `Actions.rejectReturn('${request.id}')` : `Actions.rejectRequest('${request.id}')`}" class="bg-error text-white px-2 py-1 rounded text-[10px] font-bold">Reject</button></div></div></div>`;
    }).join('');
    const borrowCards = data.activeLoans.slice(0, 3).map(loan => {
      const isOverdue = new Date(loan.due_date) < new Date();
      return `<div onclick="Router.go('admin-loans')" class="rounded-lg border border-outline-variant p-sm cursor-pointer hover:bg-surface-container-low"><div class="flex items-center justify-between gap-sm"><div class="min-w-0"><div class="font-bold text-sm truncate">${h(loan.items?.name || 'Equipment')}</div><div class="text-xs text-on-surface-variant truncate">${h(loan.profiles?.full_name || 'Member')} · ${loan.quantity || 1} unit(s)</div></div><span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase shrink-0 ${isOverdue ? 'bg-error-container text-error' : 'bg-emerald-100 text-emerald-800'}">${isOverdue ? 'Overdue' : 'Active'}</span></div><div class="flex justify-between items-center mt-sm text-xs text-on-surface-variant"><span>Due ${fmtDate(loan.due_date)}</span><span class="text-secondary font-bold">View details</span></div></div>`;
    }).join('');
    const recent = data.recentActivity.slice(0, 4).map(activity => `<div class="flex items-start gap-sm"><span class="material-symbols-outlined text-secondary">${activity.icon}</span><div><div class="font-medium text-sm">${h(activity.title)}</div><div class="text-xs text-on-surface-variant">${h(activity.detail)} · ${fmtDate(activity.date)}</div></div></div>`).join('');

    return `
      <div class="space-y-md">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">Admin Dashboard</h1>
          <p class="text-on-surface-variant text-sm">Monitor inventory, lending, requests, and members from one place.</p>
        </div>

        <div class="grid grid-cols-2 gap-md">
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="text-xs uppercase text-on-surface-variant">Available Units</div><div class="text-3xl font-bold text-primary mt-xs">${data.availableUnits}</div><div class="text-xs text-on-surface-variant">of ${data.totalUnits} total</div></div>
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="text-xs uppercase text-on-surface-variant">Active Loans</div><div class="text-3xl font-bold text-secondary mt-xs">${data.activeLoans.length}</div></div>
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="text-xs uppercase text-on-surface-variant">Requests</div><div class="text-3xl font-bold text-amber-600 mt-xs">${data.pendingRequests.length}</div></div>
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="text-xs uppercase text-on-surface-variant">Members</div><div class="text-3xl font-bold text-primary mt-xs">${State.members.length}</div></div>
        </div>
        <div class="grid grid-cols-1 gap-md"><section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="flex items-center justify-between mb-sm"><div><h2 class="font-bold text-lg text-primary">Requests</h2><p class="text-xs text-on-surface-variant">Approve or reject pending requests quickly.</p></div><span class="text-sm font-bold text-amber-600">${data.pendingRequests.length}</span></div><div class="space-y-sm">${requestCards || '<div class="text-sm text-on-surface-variant">No pending requests.</div>'}</div><button onclick="Router.go('admin-requests')" class="w-full mt-md pt-sm border-t border-outline-variant text-secondary text-xs font-bold">See full list</button></section><section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="flex items-center justify-between mb-sm"><div><h2 class="font-bold text-lg text-primary">Active Borrows</h2><p class="text-xs text-on-surface-variant">Monitor equipment currently checked out.</p></div><span class="text-sm font-bold text-secondary">${data.activeLoans.length}</span></div><div class="space-y-sm">${borrowCards || '<div class="text-sm text-on-surface-variant">No active borrows.</div>'}</div><button onclick="Router.go('admin-loans')" class="w-full mt-md pt-sm border-t border-outline-variant text-secondary text-xs font-bold">See full list</button></section></div>
        <section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="flex items-center justify-between mb-sm"><h2 class="font-bold text-lg text-primary">Recent Activity</h2><button onclick="Router.go('admin-inventory')" class="text-secondary text-xs font-bold">Open Inventory</button></div><div class="space-y-md">${recent || '<div class="text-sm text-on-surface-variant">No recent activity.</div>'}</div></section>
      </div>
    `;
  },

  mobileMemberBrowse() {
    const items = State.items;
    const cards = items.map((item, idx) => {
      const avail = item.available_quantity ?? item.total_stock ?? 1;
      const status = avail > 0 ? 'Available' : 'Unavailable';
      const statusClass = avail > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-container text-on-surface-variant';
      const description = item.description ? h(item.description) : 'No description added yet.';
      return `
        <article class="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm transition-all hover:shadow-md">
          <div class="relative h-44 bg-surface-container">
            <div class="absolute left-2 top-2 z-10 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">${h(item.category || 'Equipment')}</div>
            <div class="absolute right-2 top-2 z-10 rounded-full ${statusClass} px-2 py-1 text-[10px] font-bold uppercase">${status}: ${avail}</div>
            <div class="h-full w-full">${inventoryImage(item, 'h-full w-full object-cover')}</div>
          </div>
          <div class="space-y-sm p-md">
            <h3 class="text-lg font-bold text-primary">${h(item.name)}</h3>
            <p class="text-sm text-on-surface-variant line-clamp-2">${description}</p>
            <div class="flex items-center justify-between border-t border-outline-variant pt-sm">
              <span class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-on-surface-variant">
                <span class="material-symbols-outlined text-[12px]">tag</span>
                ${h(item.asset_tag || `Item ${String(item.id).slice(0, 6)}`)}
              </span>
              <button class="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-on-secondary" onclick="Actions.requestItemModal('${item.id}', '${h(item.name)}')">Request</button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    return `
      <div class="space-y-md">
        <div class="flex items-center justify-between">
          <h1 class="font-display-md text-display-md text-primary">Browse Inventory</h1>
          <button class="rounded-full bg-surface-container p-2 text-on-surface-variant">
            <span class="material-symbols-outlined">filter_list</span>
          </button>
        </div>
        <div class="relative">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
          <input type="text" placeholder="Search equipment..." class="w-full pl-10 pr-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm text-on-surface" />
        </div>
        <div class="flex gap-2 overflow-x-auto pb-1">
          <button class="rounded-full border border-secondary bg-secondary/10 text-secondary px-3 py-1 text-xs font-bold">All</button>
          <button class="rounded-full border border-outline-variant text-on-surface-variant px-3 py-1 text-xs">Laptops</button>
          <button class="rounded-full border border-outline-variant text-on-surface-variant px-3 py-1 text-xs">Cameras</button>
          <button class="rounded-full border border-outline-variant text-on-surface-variant px-3 py-1 text-xs">Audio</button>
        </div>
        <div class="space-y-md">${cards || '<div class="text-sm text-on-surface-variant">No items available.</div>'}</div>
      </div>
    `;
  },

  // --- ADMIN DASHBOARD ---
  adminDashboard() {
    const data = this.adminDashboardData();
    const utilization = data.totalUnits ? Math.round(((data.totalUnits - data.availableUnits) / data.totalUnits) * 100) : 0;
    const requestCards = data.pendingRequests.slice(0, 4).map(request => {
      const isReturnRequest = request.purpose === 'Return';
      return `<div class="flex items-center justify-between gap-md border-b border-outline-variant py-sm last:border-0 cursor-pointer hover:bg-surface-container-low" onclick="Router.go('admin-requests')"><div class="min-w-0"><div class="font-medium text-sm">${h(request.items?.name || 'Equipment')}</div><div class="text-xs text-on-surface-variant">${h(request.profiles?.full_name || 'Member')} · ${request.quantity || 1} unit(s) · ${fmtDate(request.requested_at)}</div></div><span class="px-2 py-1 rounded-full text-xs font-bold uppercase shrink-0 ${isReturnRequest ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'}">${isReturnRequest ? 'Return' : 'Borrow'}</span></div><div class="flex items-center justify-between px-sm pb-sm border-b border-outline-variant last:border-0"><span class="text-xs text-amber-700 font-bold">Pending review</span><div class="flex gap-sm"><button onclick="event.stopPropagation(); ${isReturnRequest ? `Actions.confirmReturn('${request.id}')` : `Actions.approveRequest('${request.id}')`}" class="bg-emerald-600 text-white px-sm py-xs rounded text-xs font-bold">${isReturnRequest ? 'Confirm Return' : 'Approve'}</button><button onclick="event.stopPropagation(); ${isReturnRequest ? `Actions.rejectReturn('${request.id}')` : `Actions.rejectRequest('${request.id}')`}" class="bg-error text-white px-sm py-xs rounded text-xs font-bold">Reject</button></div></div>`;
    }).join('');
    const borrowCards = data.activeLoans.slice(0, 4).map(loan => {
      const isOverdue = new Date(loan.due_date) < new Date();
      return `<div class="flex items-center justify-between gap-md border-b border-outline-variant py-sm last:border-0 cursor-pointer hover:bg-surface-container-low" onclick="Router.go('admin-loans')"><div class="min-w-0"><div class="font-medium text-sm">${h(loan.items?.name || 'Equipment')}</div><div class="text-xs text-on-surface-variant">${h(loan.profiles?.full_name || 'Member')} · ${loan.quantity || 1} unit(s)</div></div><span class="px-2 py-1 rounded-full text-xs font-bold uppercase shrink-0 ${isOverdue ? 'bg-error-container text-error' : 'bg-emerald-100 text-emerald-800'}">${isOverdue ? 'Overdue' : 'Active'}</span></div><div class="flex justify-between items-center px-sm pb-sm border-b border-outline-variant last:border-0 text-xs text-on-surface-variant"><span>Due ${fmtDate(loan.due_date)}</span><span class="text-secondary font-bold">View details</span></div>`;
    }).join('');
    const activity = data.recentActivity.map(item => `<div class="flex items-start gap-sm"><span class="material-symbols-outlined text-secondary shrink-0">${item.icon}</span><div class="min-w-0"><div class="font-medium text-sm">${h(item.title)}</div><div class="text-xs text-on-surface-variant break-words">${h(item.detail)} · ${fmtDate(item.date)}</div></div></div>`).join('');
    return `
      <div class="space-y-lg max-w-7xl">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-md">
          <div>
          <h1 class="font-display-lg text-display-lg text-primary">Admin Dashboard</h1>
          <p class="text-on-surface-variant text-sm">Monitor inventory health, lending activity, and requests that need review.</p>
          </div>
          <div class="text-xs text-on-surface-variant">Live operational overview</div>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-md">
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Catalog Items</div><div class="text-3xl font-bold text-primary mt-xs">${State.items.length}</div><div class="text-xs text-on-surface-variant">${data.totalUnits} total units</div></div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Available</div><div class="text-3xl font-bold text-secondary mt-xs">${data.availableUnits}</div><div class="text-xs text-on-surface-variant">${utilization}% utilization</div></div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Active Loans</div><div class="text-3xl font-bold text-primary mt-xs">${data.activeLoans.length}</div><div class="text-xs text-on-surface-variant">${data.dueSoonLoans.length} due soon</div></div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Requests</div><div class="text-3xl font-bold text-amber-600 mt-xs">${data.pendingRequests.length}</div><div class="text-xs text-on-surface-variant">${data.pendingReturns.length} returns</div></div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Members</div><div class="text-3xl font-bold text-primary mt-xs">${State.members.length}</div></div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-lg"><section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg"><div class="flex items-center justify-between mb-sm"><div><h2 class="font-bold text-lg text-primary">Requests</h2><p class="text-xs text-on-surface-variant">Approve or reject pending requests quickly.</p></div><span class="text-sm font-bold text-amber-600">${data.pendingRequests.length}</span></div><div class="space-y-sm">${requestCards || '<div class="text-sm text-on-surface-variant">No pending requests.</div>'}</div><button onclick="Router.go('admin-requests')" class="w-full mt-md pt-sm border-t border-outline-variant text-secondary text-xs font-bold">See full list</button></section><section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg"><div class="flex items-center justify-between mb-sm"><div><h2 class="font-bold text-lg text-primary">Active Borrows</h2><p class="text-xs text-on-surface-variant">Monitor equipment currently checked out.</p></div><span class="text-sm font-bold text-secondary">${data.activeLoans.length}</span></div><div class="space-y-sm">${borrowCards || '<div class="text-sm text-on-surface-variant">No active borrows.</div>'}</div><button onclick="Router.go('admin-loans')" class="w-full mt-md pt-sm border-t border-outline-variant text-secondary text-xs font-bold">See full list</button></section></div>
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
          <td class="px-md py-sm text-right">
            <button onclick="Router.go('admin-edit-item-${item.id}')" class="bg-secondary/10 text-secondary hover:bg-secondary/20 px-sm py-xs rounded text-xs font-bold transition-colors">
              Details & Logs
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
          <div class="overflow-x-auto">
            <table class="min-w-[820px] w-full text-left border-collapse">
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
            <!-- Red‑themed Delete Item button (admin only) -->
            <button type="button"
                    onclick="Actions.deleteItem('${item.id}')"
                    class="bg-error text-white px-md py-sm rounded-lg mt-md font-bold hover:bg-error/80">
              Delete Item
            </button>
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
    const rows = State.requests.map(req => {
      const statusKey = String(req.status || '').trim().toLowerCase();
      const isPending = statusKey === 'pending';
      const isApproved = statusKey === 'approved';
      const isRejected = statusKey === 'rejected';
      const isReturnRequest = req.purpose === 'Return';
      const requestType = isReturnRequest ? 'Return' : 'Borrow';
      const requestTypeClass = isReturnRequest ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800';
      const actionCell = isPending
        ? (req.purpose === 'Return'
            ? `
              <button onclick="Actions.confirmReturn('${req.id}')" class="bg-emerald-600 text-white px-xs py-1 rounded text-xs hover:bg-emerald-700">Confirm Return</button>
              <button onclick="Actions.rejectReturn('${req.id}')" class="bg-error text-white px-xs py-1 rounded text-xs hover:bg-error-container">Reject</button>
            `
            : `
              <button onclick="Actions.approveRequest('${req.id}')" class="bg-emerald-600 text-white px-xs py-1 rounded text-xs hover:bg-emerald-700">Approve</button>
              <button onclick="Actions.rejectRequest('${req.id}')" class="bg-error text-white px-xs py-1 rounded text-xs hover:bg-error-container">Reject</button>
            `)
        : `<span class="text-xs text-on-surface-variant">${isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Processed'}</span>`;

      return `
        <tr class="border-b border-surface-variant hover:bg-surface-container-low">
          <td class="px-md py-sm font-medium">${h(req.items?.name || 'Item')}</td>
          <td class="px-md py-sm text-on-surface-variant">
            <div class="font-medium">${h(req.profiles?.full_name || 'Member')}</div>
            <div class="text-xs text-on-surface-variant opacity-80">${h(req.profiles?.email || '')}</div>
          </td>
          <td class="px-md py-sm text-on-surface-variant">${req.quantity || 1}</td>
          <td class="px-md py-sm text-on-surface-variant">${req.duration_days || 7} Days</td>
          <td class="px-md py-sm text-on-surface-variant"><span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${requestTypeClass}">${requestType}</span><span class="block text-xs mt-1">${h(req.purpose || 'Standard Borrow')}</span></td>
          <td class="px-md py-sm">
            <span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${statusKey === 'pending' ? 'bg-amber-100 text-amber-800' : statusKey === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-error-container text-error'}">
              ${statusKey || 'pending'}
            </span>
          </td>
          <td class="px-md py-sm text-right space-x-xs">
            ${actionCell}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="space-y-md">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">Requests</h1>
          <p class="text-on-surface-variant text-sm">Review borrow and return requests from members.</p>
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
          <div class="overflow-x-auto">
            <table class="min-w-[820px] w-full text-left border-collapse">
              <thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant">
                <tr>
                  <th class="px-md py-sm whitespace-nowrap">Item</th>
                  <th class="px-md py-sm whitespace-nowrap">Member</th>
                  <th class="px-md py-sm whitespace-nowrap">Qty</th>
                  <th class="px-md py-sm whitespace-nowrap">Duration</th>
                  <th class="px-md py-sm whitespace-nowrap">Purpose</th>
                  <th class="px-md py-sm whitespace-nowrap">Status</th>
                  <th class="px-md py-sm text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody class="text-sm">
                ${rows || '<tr><td colspan="7" class="p-md text-center text-on-surface-variant">No borrow requests.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  // --- ADMIN LOANS ---
  adminLoans() {
    const rows = State.loans.map(loan => {
      const isOverdue = loan.status === 'active' && new Date(loan.due_date) < new Date();
      const statusLabel = loan.status === 'returned' ? 'Returned' : isOverdue ? 'Overdue' : 'Active';
      const statusClass = loan.status === 'returned' ? 'bg-surface-container text-on-surface-variant' : isOverdue ? 'bg-error-container text-error' : 'bg-emerald-100 text-emerald-800';
      return `<tr class="border-b border-surface-variant hover:bg-surface-container-low"><td class="px-md py-sm font-medium">${h(loan.items?.name || 'Item')}</td><td class="px-md py-sm text-on-surface-variant">${h(loan.profiles?.full_name || loan.profiles?.email || 'Member')}</td><td class="px-md py-sm">${loan.quantity || 1}</td><td class="px-md py-sm text-on-surface-variant">${fmtDate(loan.borrowed_at)}</td><td class="px-md py-sm text-on-surface-variant">${fmtDate(loan.due_date)}</td><td class="px-md py-sm"><span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${statusClass}">${statusLabel}</span></td><td class="px-md py-sm text-right">${loan.status === 'active' ? `<button onclick="Actions.returnItem('${loan.id}')" class="text-secondary text-xs font-bold hover:underline">Process Return</button>` : '<span class="text-xs text-on-surface-variant">Completed</span>'}</td></tr>`;
    }).join('');

    return `<div class="space-y-md"><div><h1 class="font-display-lg text-display-lg text-primary">Loans</h1><p class="text-on-surface-variant text-sm">Monitor every active and completed equipment loan.</p></div><div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden"><div class="overflow-x-auto"><table class="min-w-[900px] w-full text-left border-collapse"><thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant"><tr><th class="px-md py-sm">Item</th><th class="px-md py-sm">Borrowed By</th><th class="px-md py-sm">Qty</th><th class="px-md py-sm">Borrowed</th><th class="px-md py-sm">Due Date</th><th class="px-md py-sm">Status</th><th class="px-md py-sm text-right">Action</th></tr></thead><tbody class="text-sm">${rows || '<tr><td colspan="7" class="p-md text-center text-on-surface-variant">No loans found.</td></tr>'}</tbody></table></div></div></div>`;
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
          <div class="overflow-x-auto">
            <table class="min-w-[720px] w-full text-left border-collapse">
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
      </div>
    `;
  },

  // --- MEMBER BROWSE ---
  memberBrowse() {
    const cards = State.items.map(item => {
      const avail = item.available_quantity ?? item.total_stock ?? 1;
      const category = h(item.category || 'Equipment');
      const description = item.description ? h(item.description) : 'No description added yet.';
      return `
        <article class="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm transition-all hover:shadow-md">
          <div class="relative h-52 bg-surface-container">
            <div class="absolute left-2 top-2 z-10 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">${category}</div>
            <div class="absolute right-2 top-2 z-10 rounded-full ${avail > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-container text-on-surface-variant'} px-2 py-1 text-[10px] font-bold uppercase">${avail > 0 ? `${avail} Available` : 'Out of Stock'}</div>
            <div class="h-full w-full">${inventoryImage(item, 'h-full w-full object-cover')}</div>
          </div>
          <div class="space-y-sm p-md">
            <h3 class="text-xl font-bold text-primary">${h(item.name)}</h3>
            <p class="text-sm text-on-surface-variant line-clamp-2">${description}</p>
            <div class="flex items-center justify-between border-t border-outline-variant pt-sm">
              <span class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-on-surface-variant">
                <span class="material-symbols-outlined text-[12px]">tag</span>
                ${h(item.asset_tag || `Item ${String(item.id).slice(0, 6)}`)}
              </span>
              <button onclick="Actions.requestItemModal('${item.id}', '${h(item.name)}')" ${avail <= 0 ? 'disabled' : ''} class="rounded-lg bg-secondary px-md py-xs text-xs font-bold text-on-secondary hover:bg-on-secondary-fixed-variant disabled:opacity-50">
                Request Borrow
              </button>
            </div>
          </div>
        </article>
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

  mobileMemberDashboard() {
    const activeLoans = State.loans.filter(loan => loan.status === 'active');
    const pendingRequests = State.requests.filter(request => request.status === 'pending');
    const loanCards = activeLoans.slice(0, 2).map(loan => `
      <div class="flex items-center justify-between gap-sm border-b border-outline-variant pb-sm last:border-0 last:pb-0">
        <div class="min-w-0"><div class="font-bold text-sm truncate">${h(loan.items?.name || 'Item')}</div><div class="text-xs text-on-surface-variant">Due ${fmtDate(loan.due_date)}</div></div>
        <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${new Date(loan.due_date) < new Date() ? 'bg-error-container text-error' : 'bg-secondary/10 text-secondary'}">${new Date(loan.due_date) < new Date() ? 'Overdue' : 'Active'}</span>
      </div>
    `).join('');
    const requestCards = pendingRequests.slice(0, 2).map(request => `
      <div class="flex items-center justify-between gap-sm border-b border-outline-variant pb-sm last:border-0 last:pb-0">
        <div class="min-w-0"><div class="font-bold text-sm truncate">${h(request.items?.name || 'Item')}</div><div class="text-xs text-on-surface-variant">${request.quantity || 1} unit(s) requested</div></div>
        <span class="px-2 py-1 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800">Pending</span>
      </div>
    `).join('');

    return `
      <div class="space-y-md">
        <div><h1 class="font-display-md text-display-md text-primary">My Dashboard</h1><p class="text-sm text-on-surface-variant">A quick view of what you have borrowed and what is awaiting approval.</p></div>
        <div class="grid grid-cols-2 gap-sm">
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="text-xs uppercase text-on-surface-variant">Active Borrows</div><div class="text-3xl font-bold text-primary mt-xs">${activeLoans.length}</div></div>
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="text-xs uppercase text-on-surface-variant">Requests</div><div class="text-3xl font-bold text-secondary mt-xs">${pendingRequests.length}</div></div>
        </div>
        <section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="flex items-center justify-between mb-md"><div><h2 class="font-bold text-lg text-primary">Requests</h2><p class="text-xs text-on-surface-variant">Items waiting for a decision.</p></div><button onclick="Router.go('member-activities')" class="text-secondary text-xs font-bold">View history</button></div><div class="space-y-sm">${requestCards || '<div class="text-sm text-on-surface-variant">No pending requests.</div>'}</div></section>
        <section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md"><div class="flex items-center justify-between mb-md"><div><h2 class="font-bold text-lg text-primary">Active Borrows</h2><p class="text-xs text-on-surface-variant">Your equipment currently checked out.</p></div><button onclick="Router.go('member-activities')" class="text-secondary text-xs font-bold">View details</button></div><div class="space-y-sm">${loanCards || '<div class="text-sm text-on-surface-variant">No active borrows.</div>'}</div></section>
        <button onclick="Router.go('member-browse')" class="w-full bg-secondary text-on-secondary rounded-lg py-2 text-sm font-bold">Request Equipment</button>
      </div>
    `;
  },

  mobileMemberSupport() {
    return `
      <div class="space-y-md">
        <div class="flex items-center gap-sm">
          <button class="text-on-surface-variant" onclick="Router.go('member-dashboard')">
            <span class="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 class="font-display-md text-display-md text-primary">Support</h1>
        </div>

        <div class="rounded-2xl bg-gradient-to-r from-secondary/10 to-primary/10 p-md border border-secondary/20">
          <div class="text-xs uppercase tracking-[0.12em] text-on-surface-variant">Need help?</div>
          <div class="mt-1 font-bold text-primary">Ask the club support team</div>
        </div>

        <div class="grid grid-cols-2 gap-md">
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md text-center">
            <div class="mb-2 text-secondary"><span class="material-symbols-outlined text-[28px]">inventory_2</span></div>
            <div class="text-sm font-bold text-primary">Inventory</div>
          </div>
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md text-center">
            <div class="mb-2 text-secondary"><span class="material-symbols-outlined text-[28px]">sync_problem</span></div>
            <div class="text-sm font-bold text-primary">Sync</div>
          </div>
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md text-center">
            <div class="mb-2 text-secondary"><span class="material-symbols-outlined text-[28px]">group</span></div>
            <div class="text-sm font-bold text-primary">Members</div>
          </div>
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md text-center">
            <div class="mb-2 text-secondary"><span class="material-symbols-outlined text-[28px]">help_center</span></div>
            <div class="text-sm font-bold text-primary">General</div>
          </div>
        </div>

        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant p-md space-y-md">
          <div class="flex items-center gap-sm">
            <span class="material-symbols-outlined text-secondary">support_agent</span>
            <h2 class="font-display-md text-display-md text-primary">Submit a Ticket</h2>
          </div>
          <form class="space-y-md" onsubmit="event.preventDefault(); toast('Ticket submitted!', 'success');">
            <div>
              <label class="block text-[11px] uppercase tracking-[0.08em] text-on-surface-variant mb-1">Issue Type</label>
              <select class="w-full border border-outline-variant rounded-lg bg-surface-container py-2 px-3 text-sm text-on-surface focus:border-secondary focus:outline-none">
                <option>Select category...</option>
                <option>Inventory</option>
                <option>Equipment</option>
                <option>Account</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] uppercase tracking-[0.08em] text-on-surface-variant mb-1">Priority</label>
              <select class="w-full border border-outline-variant rounded-lg bg-surface-container py-2 px-3 text-sm text-on-surface focus:border-secondary focus:outline-none">
                <option>Low - General Question</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] uppercase tracking-[0.08em] text-on-surface-variant mb-1">Description</label>
              <textarea rows="4" class="w-full border border-outline-variant rounded-lg bg-surface-container py-2 px-3 text-sm text-on-surface focus:border-secondary focus:outline-none" placeholder="Please describe the issue in detail..."></textarea>
            </div>
            <button type="submit" class="w-full bg-secondary text-on-secondary rounded-lg py-3 text-sm font-bold">Submit Request</button>
          </form>
        </div>
      </div>
    `;
  },

  // --- MEMBER DASHBOARD ---
  memberDashboard() {
    const activeLoans = State.loans.filter(loan => loan.status === 'active');
    const overdueLoans = activeLoans.filter(loan => new Date(loan.due_date) < new Date());
    const pendingRequests = State.requests.filter(request => request.status === 'pending');
    const nextDue = [...activeLoans].sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
    const requestItems = State.requests.slice(0, 4).map(request => `<div class="flex items-center justify-between gap-md border-b border-outline-variant py-sm last:border-0"><div><div class="font-medium text-sm">${h(request.items?.name || 'Item')}</div><div class="text-xs text-on-surface-variant">${fmtDate(request.requested_at)} · ${request.quantity || 1} unit(s)</div></div><span class="px-2 py-1 rounded-full text-xs font-bold uppercase ${request.status === 'pending' ? 'bg-amber-100 text-amber-800' : request.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-error-container text-error'}">${h(request.status)}</span></div>`).join('');
    const loanItems = activeLoans.slice(0, 4).map(loan => `<div class="flex items-center justify-between gap-md border-b border-outline-variant py-sm last:border-0"><div><div class="font-medium text-sm">${h(loan.items?.name || 'Item')}</div><div class="text-xs text-on-surface-variant">Due ${fmtDate(loan.due_date)}</div></div><span class="px-2 py-1 rounded-full text-xs font-bold uppercase ${new Date(loan.due_date) < new Date() ? 'bg-error-container text-error' : 'bg-emerald-100 text-emerald-800'}">${new Date(loan.due_date) < new Date() ? 'Overdue' : 'Active'}</span></div>`).join('');

    return `
      <div class="space-y-lg max-w-6xl"><div class="flex flex-col md:flex-row md:items-end justify-between gap-md"><div><h1 class="font-display-lg text-display-lg text-primary">My Dashboard</h1><p class="text-on-surface-variant text-sm">Monitor your requests and current equipment without leaving the overview.</p></div><button onclick="Router.go('member-browse')" class="bg-secondary text-on-secondary px-md py-sm rounded-lg font-bold text-sm">Request Equipment</button></div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-md"><div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Active Borrows</div><div class="text-3xl font-bold text-secondary mt-xs">${activeLoans.length}</div></div><div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Pending Requests</div><div class="text-3xl font-bold text-amber-600 mt-xs">${pendingRequests.length}</div></div><div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Overdue</div><div class="text-3xl font-bold text-error mt-xs">${overdueLoans.length}</div></div><div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Next Due</div><div class="text-lg font-bold text-primary mt-sm">${nextDue ? fmtDate(nextDue.due_date) : 'None'}</div></div></div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-lg"><section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg"><div class="flex items-center justify-between mb-sm"><div><h2 class="font-bold text-lg text-primary">Requests</h2><p class="text-xs text-on-surface-variant">Recent request status at a glance.</p></div><button onclick="Router.go('member-activities')" class="text-secondary text-xs font-bold">View all</button></div><div>${requestItems || '<div class="py-md text-sm text-on-surface-variant">No requests submitted.</div>'}</div></section><section class="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg"><div class="flex items-center justify-between mb-sm"><div><h2 class="font-bold text-lg text-primary">Active Borrows</h2><p class="text-xs text-on-surface-variant">Current loans and due-date status.</p></div><button onclick="Router.go('member-activities')" class="text-secondary text-xs font-bold">View all</button></div><div>${loanItems || '<div class="py-md text-sm text-on-surface-variant">No active borrows.</div>'}</div></section></div>
      </div>
    `;
  },

  // --- PROFILE VIEW ---
  memberProfile() {
    return `
      <div class="space-y-lg max-w-3xl">
        <div>
          <h1 class="font-display-lg text-display-lg text-primary">My Profile</h1>
          <p class="text-on-surface-variant text-sm">View your account details and access your complete activity history.</p>
        </div>
        <div class="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant space-y-md">
          <h2 class="font-bold text-lg text-on-surface flex items-center gap-sm"><span class="material-symbols-outlined text-secondary">person</span> Account Profile</h2>
          <div class="space-y-md">
            <div>
              <label class="block text-xs font-label-sm uppercase text-on-surface-variant mb-xs">Full Name</label>
              <input type="text" disabled value="${h(State.profile?.full_name || '')}" class="w-full border border-outline-variant rounded px-md py-sm text-sm bg-surface-container text-on-surface-variant opacity-75">
            </div>
            <div>
              <label class="block text-xs font-label-sm uppercase text-on-surface-variant mb-xs">Email Address</label>
              <input type="email" disabled value="${h(State.user?.email || '')}" class="w-full border border-outline-variant rounded px-md py-sm text-sm bg-surface-container text-on-surface-variant opacity-75">
            </div>
            <div>
              <label class="block text-xs font-label-sm uppercase text-on-surface-variant mb-xs">Role</label>
              <span class="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-full text-xs font-bold uppercase inline-block">${h(State.profile?.role || 'member')}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // --- MEMBER ACTIVITIES ---
  memberActivities() {
    const activeLoans = State.loans.filter(l => l.status === 'active');
    const overdueLoans = activeLoans.filter(l => new Date(l.due_date) < new Date());
    const pendingRequests = State.requests.filter(r => r.status === 'pending');
    const returnedLoans = State.loans.filter(l => l.status === 'returned');
    const loanRows = State.loans.map(l => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(l.items?.name || 'Item')}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(l.borrowed_at)}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(l.due_date)}</td>
        <td class="px-md py-sm"><span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${l.status === 'returned' ? 'bg-surface-container text-on-surface-variant' : new Date(l.due_date) < new Date() ? 'bg-error-container text-error' : 'bg-emerald-100 text-emerald-800'}">${l.status === 'returned' ? 'Returned' : new Date(l.due_date) < new Date() ? 'Overdue' : 'Active'}</span></td>
        <td class="px-md py-sm text-right">${l.status === 'active' ? `<button onclick="Actions.requestReturn('${l.id}')" class="text-secondary font-bold text-xs hover:underline">Return Item</button>` : '<span class="text-xs text-on-surface-variant">Completed</span>'}</td>
      </tr>
    `).join('');
    const reqRows = State.requests.map(r => `
      <tr class="border-b border-surface-variant hover:bg-surface-container-low">
        <td class="px-md py-sm font-medium">${h(r.items?.name || 'Item')}</td>
        <td class="px-md py-sm text-on-surface-variant">${fmtDate(r.requested_at)}</td>
        <td class="px-md py-sm text-on-surface-variant">${r.duration_days || 7} Days</td>
        <td class="px-md py-sm"><span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase ${r.status === 'pending' ? 'bg-amber-100 text-amber-800' : r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-error-container text-error'}">${h(r.status)}</span></td>
      </tr>
    `).join('');
    const recent = [
      ...State.requests.map(r => ({ date: r.requested_at, icon: 'send', title: `Request for ${r.items?.name || 'equipment'}`, detail: `${r.quantity || 1} unit(s) · ${r.status}` })),
      ...State.loans.map(l => ({ date: l.borrowed_at, icon: l.status === 'returned' ? 'assignment_return' : 'shopping_bag', title: `${l.status === 'returned' ? 'Returned' : 'Borrowed'} ${l.items?.name || 'equipment'}`, detail: l.status === 'returned' ? 'Loan completed' : `Due ${fmtDate(l.due_date)}` }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5).map(activity => `
      <div class="flex items-start gap-sm">
        <div class="w-9 h-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[18px]">${activity.icon}</span></div>
        <div class="min-w-0"><div class="font-bold text-sm text-on-surface">${h(activity.title)}</div><div class="text-xs text-on-surface-variant">${h(activity.detail)} · ${fmtDate(activity.date)}</div></div>
      </div>
    `).join('');

    return `
      <div class="space-y-lg max-w-6xl">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-md">
          <div><h1 class="font-display-lg text-display-lg text-primary">My Activities</h1><p class="text-on-surface-variant text-sm">Track your equipment requests, active loans, and completed returns in one place.</p></div>
          <button onclick="Router.go('member-browse')" class="bg-secondary text-on-secondary px-md py-sm rounded-lg font-bold text-sm flex items-center gap-xs"><span class="material-symbols-outlined text-[18px]">add</span> Request Equipment</button>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-md">
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Active Loans</div><div class="text-3xl font-bold text-secondary mt-xs">${activeLoans.length}</div><div class="text-xs text-on-surface-variant mt-1">Currently borrowed</div></div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Pending Requests</div><div class="text-3xl font-bold text-amber-600 mt-xs">${pendingRequests.length}</div><div class="text-xs text-on-surface-variant mt-1">Awaiting review</div></div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Due Attention</div><div class="text-3xl font-bold text-error mt-xs">${overdueLoans.length}</div><div class="text-xs text-on-surface-variant mt-1">Overdue items</div></div>
          <div class="bg-surface-container-lowest p-md rounded-xl border border-outline-variant"><div class="text-xs uppercase text-on-surface-variant">Completed Loans</div><div class="text-3xl font-bold text-primary mt-xs">${returnedLoans.length}</div><div class="text-xs text-on-surface-variant mt-1">Returned items</div></div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-lg">
          <div class="lg:col-span-1 bg-surface-container-lowest border border-outline-variant rounded-xl p-lg"><div class="flex items-center gap-sm mb-md text-primary"><span class="material-symbols-outlined text-secondary">timeline</span><h2 class="font-bold text-lg">Recent Activity</h2></div><div class="space-y-md">${recent || '<div class="text-sm text-on-surface-variant">No activity yet. Browse inventory to get started.</div>'}</div></div>
          <div class="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant p-lg"><div class="flex items-center justify-between mb-md"><div><h2 class="font-bold text-lg text-primary">Your Lending Snapshot</h2><p class="text-xs text-on-surface-variant mt-1">Keep an eye on due dates and open requests.</p></div><span class="material-symbols-outlined text-secondary">insights</span></div><div class="space-y-sm"><div class="flex justify-between text-sm"><span>Loans currently active</span><strong>${activeLoans.length}</strong></div><div class="h-2 bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-secondary rounded-full" style="width: ${activeLoans.length ? '100' : '0'}%"></div></div><div class="flex justify-between text-sm pt-sm"><span>Requests awaiting approval</span><strong>${pendingRequests.length}</strong></div><div class="h-2 bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-amber-500 rounded-full" style="width: ${pendingRequests.length ? '100' : '0'}%"></div></div></div></div>
        </div>
        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden"><div class="p-md border-b border-outline-variant"><h2 class="font-bold text-on-surface">Borrowing & Loan History</h2><p class="text-xs text-on-surface-variant mt-1">All active and completed equipment loans.</p></div><div class="overflow-x-auto"><table class="min-w-[700px] w-full text-left border-collapse"><thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant"><tr><th class="px-md py-sm">Item</th><th class="px-md py-sm">Borrowed</th><th class="px-md py-sm">Due Date</th><th class="px-md py-sm">Status</th><th class="px-md py-sm text-right">Action</th></tr></thead><tbody class="text-sm">${loanRows || '<tr><td colspan="5" class="p-md text-center text-on-surface-variant">No borrowing history found.</td></tr>'}</tbody></table></div></div>
        <div class="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden"><div class="p-md border-b border-outline-variant"><h2 class="font-bold text-on-surface">Request History</h2><p class="text-xs text-on-surface-variant mt-1">Every equipment request and its current status.</p></div><div class="overflow-x-auto"><table class="min-w-[620px] w-full text-left border-collapse"><thead class="bg-surface-container-low text-xs font-label-sm uppercase text-on-surface-variant"><tr><th class="px-md py-sm">Item</th><th class="px-md py-sm">Requested</th><th class="px-md py-sm">Duration</th><th class="px-md py-sm">Status</th></tr></thead><tbody class="text-sm">${reqRows || '<tr><td colspan="4" class="p-md text-center text-on-surface-variant">No requests submitted.</td></tr>'}</tbody></table></div></div>
      </div>
    `;
  },
  adminProfile() { return this.memberProfile(); },

  // --- MEMBER SUPPORT ---
  memberSupport() {
    return `
      <div class="max-w-5xl space-y-lg">
        <div class="rounded-2xl bg-gradient-to-r from-secondary/10 via-primary/5 to-transparent border border-secondary/20 p-lg">
          <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-md">
            <div>
              <p class="text-xs uppercase tracking-[0.12em] text-on-surface-variant">Support centre</p>
              <h1 class="font-display-lg text-display-lg text-primary mt-xs">Support & Help</h1>
            </div>
            <div class="rounded-full bg-white/70 px-md py-xs text-xs font-bold uppercase tracking-[0.08em] text-secondary ring-1 ring-secondary/20">Response within 24h</div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-md">
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
            <div class="mb-sm text-secondary"><span class="material-symbols-outlined text-[28px]">inventory_2</span></div>
            <div class="font-bold text-primary">Inventory</div>
            <div class="text-xs text-on-surface-variant mt-1">Stock and equipment queries</div>
          </div>
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
            <div class="mb-sm text-secondary"><span class="material-symbols-outlined text-[28px]">sync_problem</span></div>
            <div class="font-bold text-primary">Sync</div>
            <div class="text-xs text-on-surface-variant mt-1">Access and data issues</div>
          </div>
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
            <div class="mb-sm text-secondary"><span class="material-symbols-outlined text-[28px]">group</span></div>
            <div class="font-bold text-primary">Members</div>
            <div class="text-xs text-on-surface-variant mt-1">Account and permissions</div>
          </div>
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
            <div class="mb-sm text-secondary"><span class="material-symbols-outlined text-[28px]">help_center</span></div>
            <div class="font-bold text-primary">General</div>
            <div class="text-xs text-on-surface-variant mt-1">Booking and system help</div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-lg">
          <div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
            <div class="flex items-center gap-sm">
              <span class="material-symbols-outlined text-secondary">support_agent</span>
              <h2 class="font-bold text-lg text-primary">Quick contact</h2>
            </div>
            <div class="space-y-sm text-sm text-on-surface-variant">
              <div class="rounded-lg bg-surface-container px-md py-sm">ATS Club Operations</div>
              <div class="rounded-lg bg-surface-container px-md py-sm">support@atsclub.example</div>
              <div class="rounded-lg bg-surface-container px-md py-sm">Mon–Fri · 9:00 AM – 5:00 PM</div>
            </div>
          </div>

          <div class="rounded-xl border border-outline-variant bg-surface-container-