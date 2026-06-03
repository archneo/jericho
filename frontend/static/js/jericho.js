const PREFIX = location.pathname.startsWith('/jericho/') ? '/jericho' : '';
const API_BASE = PREFIX + '/api/web';
const MONITOR_BASE = PREFIX + '/api/system';
const AGENTS_BASE = PREFIX + '/api/agents';
const SHELL_BASE = PREFIX + '/api/shell';
const CB = '?v=' + BUILD_ID;
let accessToken = null;
let currentNote = null;
let sessionCheckInterval = null;
let capabilities = {};
let debugLines = [];

// ─── Sudo State ──────────────────────────────────────────────────────────────
let sudoTicket = null;
let sudoExpiry = null;
let sudoTimer = null;

function isSudoActive() {
  return sudoTicket && Date.now() < sudoExpiry;
}

function clearSudo() {
  sudoTicket = null;
  sudoExpiry = null;
  clearInterval(sudoTimer);
  sudoTimer = null;
  updateSudoUI();
}

function updateSudoUI() {
  const btn = document.getElementById('sudo-toggle');
  const countdown = document.getElementById('sudo-countdown');
  if (!btn || !countdown) return;
  if (isSudoActive()) {
    btn.classList.add('active');
    const secs = Math.max(0, Math.floor((sudoExpiry - Date.now()) / 1000));
    countdown.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  } else {
    btn.classList.remove('active');
    countdown.textContent = '';
  }
}

function startSudoTimer() {
  clearInterval(sudoTimer);
  sudoTimer = setInterval(() => {
    if (!isSudoActive()) {
      clearSudo();
      showToast('Sudo mode expired', true);
    } else {
      updateSudoUI();
    }
  }, 1000);
  updateSudoUI();
}

function showSudoAuthModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('sudo-modal');
    const passphraseInput = document.getElementById('sudo-passphrase');
    const totpInput = document.getElementById('sudo-totp');
    const errorDiv = document.getElementById('sudo-error');
    const confirmBtn = document.getElementById('sudo-confirm');
    const cancelBtn = document.getElementById('sudo-cancel');

    if (!modal) { resolve(false); return; }

    passphraseInput.value = '';
    totpInput.value = '';
    errorDiv.style.display = 'none';
    errorDiv.textContent = '';
    modal.classList.add('show');
    passphraseInput.focus();

    const cleanup = () => {
      modal.classList.remove('show');
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    cancelBtn.onclick = () => { cleanup(); resolve(false); };
    confirmBtn.onclick = async () => {
      const passphrase = passphraseInput.value.trim();
      const totp = totpInput.value.trim();
      if (!passphrase || !totp || totp.length !== 6) {
        errorDiv.textContent = 'Enter passphrase and 6-digit TOTP code';
        errorDiv.style.display = 'block';
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Activating...';
      try {
        const res = await fetch(API_BASE + '/tickets/sudo', {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ passphrase, totp }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorDiv.textContent = data.detail || 'Authentication failed';
          errorDiv.style.display = 'block';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Activate';
          return;
        }
        sudoTicket = data.ticket;
        sudoExpiry = Date.now() + (data.expires_in_seconds * 1000);
        startSudoTimer();
        cleanup();
        showToast('Sudo mode activated — 2 minutes');
        resolve(true);
      } catch (e) {
        errorDiv.textContent = 'Network error: ' + e.message;
        errorDiv.style.display = 'block';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Activate';
      }
    };
  });
}

async function executeSudoCommand(command, description) {
  if (!isSudoActive()) {
    const ok = await showSudoAuthModal();
    if (!ok) return;
  }
  const confirmed = confirm(`Execute with sudo:\n${description || command}`);
  if (!confirmed) return;
  try {
    const res = await fetch(API_BASE + '/sudo/exec', {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
        'X-Sudo-Ticket': sudoTicket,
      },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast('Sudo failed: ' + (data.detail || 'Unknown error'), true);
      return;
    }
    const exitCode = data.exit_code ?? 0;
    const output = data.output || '';
    if (exitCode !== 0) {
      showToast(`Exit code ${exitCode}`, true);
    } else {
      showToast('Command executed successfully');
    }
    // Show output in a simple alert/modal for now
    if (output.length > 200) {
      debugLog('[sudo] ' + command + '\n' + output.slice(0, 500));
      showToast('Output logged to debug panel');
    }
    return data;
  } catch (e) {
    showToast('Sudo execution error: ' + e.message, true);
  }
}

function initSudoUI() {
  // Shield button is now an <a> tag with target="_blank" in index.html
  // No JS listener needed — native link handles navigation
  return;
}

// ─── Theme Engine ────────────────────────────────────────────────────────────
const MINIMAL_THEMES = [
  {
    id: 'paper', name: 'Paper Desktop', category: 'preset',
    description: 'Warm beige canvas. Clean, focused, human.',
    tokens: {
      bg: '#e8e0d4', surface: '#f5f5f0', 'surface-2': '#e8e8e0',
      accent: '#f5a623', 'accent-2': '#e09400', text: '#2d2d2d',
      'text-dim': '#6b6b6b', danger: '#ff5f57', warn: '#ffbd2e',
      border: '#d0d0d0', radius: '8px', shadow: '0 8px 32px rgba(0,0,0,0.15)'
    },
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    effects: { textShadow: 'none', scanlineOpacity: '0', glowIntensity: '0' }
  },
  {
    id: 'slate', name: 'Slate Dark', category: 'preset',
    description: 'Dark mode with warm accents.',
    tokens: {
      bg: '#1a1a2e', surface: '#252535', 'surface-2': '#2a2a3a',
      accent: '#f5a623', 'accent-2': '#e09400', text: '#e8e8e8',
      'text-dim': '#a0a0b0', danger: '#ff5f57', warn: '#ffbd2e',
      border: '#3a3a4a', radius: '8px', shadow: '0 8px 32px rgba(0,0,0,0.4)'
    },
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    effects: { textShadow: 'none', scanlineOpacity: '0', glowIntensity: '0' }
  },
  {
    id: 'construct', name: 'The Construct', category: 'preset',
    description: 'Wake up, Neo... Green phosphor on black CRT.',
    tokens: {
      bg: '#0d0208', surface: '#001100', 'surface-2': '#003300',
      accent: '#00ff41', 'accent-2': '#4db87a', text: '#e8f0ec',
      'text-dim': '#8fa89a', danger: '#ff3333', warn: '#ffaa00',
      border: '#1f3329', radius: '2px', shadow: '0 0 10px rgba(0,255,65,0.08)'
    },
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    effects: { textShadow: '0 0 5px rgba(0,255,65,0.3)', scanlineOpacity: '0.4', glowIntensity: '0.3' }
  }
];

// ─── Desktop Window Manager ──────────────────────────────────────────────────
let desktopMode = false;
let _windowZ = 10;
const WINDOW_DEFAULTS = {
  'projects': { title: '📁 File Browser', x: 84, y: 20, w: 520, h: 420, icon: '📁' },
  'system': { title: '📊 System', x: 624, y: 20, w: 520, h: 420, icon: '📊' },
  'agents': { title: '⚡ Quick Actions', x: 84, y: 460, w: 520, h: 320, icon: '⚡' },
  'platforms': { title: '🤖 Platforms', x: 624, y: 460, w: 520, h: 320, icon: '🤖' },
  'services': { title: '🌐 Services', x: 84, y: 20, w: 600, h: 450, icon: '🌐' },
  'kimi': { title: '🧠 Kimi', x: 704, y: 20, w: 520, h: 420, icon: '🧠' },
  'terminal': { title: '💻 Terminal', x: 84, y: 460, w: 720, h: 420, icon: '💻' },
  'code': { title: '📝 Code', x: 824, y: 460, w: 520, h: 420, icon: '📝' },
  'notes': { title: '📋 Notes', x: 84, y: 20, w: 520, h: 450, icon: '📋' },
  'capture': { title: '📸 Capture', x: 624, y: 20, w: 520, h: 420, icon: '📸' },
};

function bringToFront(winEl) {
  _windowZ += 1;
  winEl.style.zIndex = _windowZ;
  document.querySelectorAll('.app-window').forEach(w => {
    w.classList.remove('active');
    w.classList.add('inactive');
  });
  winEl.classList.remove('inactive');
  winEl.classList.add('active');
  syncSidebarDock();
}

function makeDraggable(winEl, titlebar) {
  let isDragging = false;
  let startX = 0, startY = 0, initialX = 0, initialY = 0;
  let rafId = null;
  let pendingX = 0, pendingY = 0;

  function flushTransform() {
    rafId = null;
    winEl.style.transform = `translate3d(${pendingX}px, ${pendingY}px, 0)`;
    winEl.dataset.posX = String(pendingX);
    winEl.dataset.posY = String(pendingY);
  }

  titlebar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.win-btn')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialX = parseFloat(winEl.dataset.posX || '0');
    initialY = parseFloat(winEl.dataset.posY || '0');
    titlebar.setPointerCapture(e.pointerId);
    bringToFront(winEl);
    winEl.classList.add('dragging');
  });

  titlebar.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    let nx = initialX + e.clientX - startX;
    let ny = initialY + e.clientY - startY;
    const maxX = window.innerWidth - winEl.offsetWidth;
    const maxY = window.innerHeight - winEl.offsetHeight - 48;
    nx = Math.max(0, Math.min(nx, maxX));
    ny = Math.max(0, Math.min(ny, maxY));
    pendingX = nx;
    pendingY = ny;
    if (!rafId) {
      rafId = requestAnimationFrame(flushTransform);
    }
  });

  titlebar.addEventListener('pointerup', () => {
    isDragging = false;
    winEl.classList.remove('dragging');
    if (rafId) {
      cancelAnimationFrame(rafId);
      flushTransform();
    }
  });
}

function syncTaskbar() {
  const taskbar = document.getElementById('taskbar');
  if (!taskbar) return;
  const items = [];
  document.querySelectorAll('.app-window').forEach(win => {
    const tab = win.dataset.tab;
    const title = win.dataset.title || tab;
    const minimized = win.classList.contains('minimized');
    const active = win.classList.contains('active');
    items.push(`<div class="taskbar-item ${active ? 'active' : ''} ${minimized ? 'minimized' : ''}" data-taskbar="${tab}">${title}</div>`);
  });
  taskbar.innerHTML = items.join('');
}

function createSidebarDock() {
  let dock = document.getElementById('sidebar-dock');
  if (dock) return dock;
  dock = document.createElement('div');
  dock.id = 'sidebar-dock';
  dock.className = 'sidebar-dock';
  Object.keys(WINDOW_DEFAULTS).forEach(tabId => {
    const def = WINDOW_DEFAULTS[tabId];
    const item = document.createElement('div');
    item.className = 'sidebar-dock__item';
    item.dataset.dockTab = tabId;
    item.innerHTML = `
      <span class="sidebar-dock__icon">${def.icon}</span>
      <span class="sidebar-dock__label">${def.title.replace(/^[^\s]+\s/, '')}</span>
    `;
    dock.appendChild(item);
  });
  document.getElementById('app').appendChild(dock);
  return dock;
}

function syncSidebarDock() {
  document.querySelectorAll('.sidebar-dock__item').forEach(item => {
    const tabId = item.dataset.dockTab;
    const win = document.querySelector(`.app-window[data-tab="${tabId}"]`);
    item.classList.toggle('active', win && win.classList.contains('active') && !win.classList.contains('minimized') && win.style.display !== 'none');
  });
}

function initDesktopMode() {
  const main = document.querySelector('.main-content');
  if (!main) return;
  // Prevent double-init
  if (main.querySelector('.app-window')) return;

  createSidebarDock();

  const panels = main.querySelectorAll('.tab-panel');
  panels.forEach(panel => {
    const tabId = panel.id.replace('tab-', '');
    const def = WINDOW_DEFAULTS[tabId];
    if (!def) return;

    const win = document.createElement('div');
    win.className = 'app-window';
    win.dataset.tab = tabId;
    win.dataset.title = def.title;
    win.style.left = '0px';
    win.style.top = '0px';
    win.style.transform = `translate3d(${def.x}px, ${def.y}px, 0)`;
    win.dataset.posX = String(def.x);
    win.dataset.posY = String(def.y);
    win.style.width = def.w + 'px';
    win.style.height = def.h + 'px';
    win.style.zIndex = _windowZ++;

    const titlebar = document.createElement('div');
    titlebar.className = 'window-titlebar';
    titlebar.innerHTML = `
      <span class="window-title">${def.title}</span>
      <div class="window-controls">
        <button class="win-btn minimize" data-win="${tabId}" title="Minimize"></button>
        <button class="win-btn maximize" data-win="${tabId}" title="Maximize"></button>
        <button class="win-btn close" data-win="${tabId}" title="Close"></button>
      </div>
    `;

    const content = document.createElement('div');
    content.className = 'window-content';
    // Move panel's children into window content
    while (panel.firstChild) {
      content.appendChild(panel.firstChild);
    }

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'window-resize-handle';

    win.appendChild(titlebar);
    win.appendChild(content);
    win.appendChild(resizeHandle);
    main.appendChild(win);
    makeDraggable(win, titlebar);
  });

  syncTaskbar();
  syncSidebarDock();

  // Eagerly load all tab scripts so windows populate with data
  document.querySelectorAll('.app-window').forEach(win => {
    const tabId = win.dataset.tab;
    if (tabId) ensureTabScripts('tab-' + tabId);
  });
}

function destroyDesktopMode() {
  const main = document.querySelector('.main-content');
  if (!main) return;
  document.querySelectorAll('.app-window').forEach(win => {
    const tabId = win.dataset.tab;
    const panel = document.getElementById('tab-' + tabId);
    const content = win.querySelector('.window-content');
    if (panel && content) {
      while (content.firstChild) {
        panel.appendChild(content.firstChild);
      }
    }
    win.remove();
  });
}

function toggleDesktopMode(enabled) {
  desktopMode = enabled;
  const main = document.querySelector('.main-content');
  const desktopBg = document.getElementById('desktop-bg');
  const taskbar = document.getElementById('taskbar');
  const checkbox = document.getElementById('window-mode-check');
  if (checkbox) checkbox.checked = enabled;

  if (enabled) {
    if (main) main.classList.add('desktop-mode');
    if (desktopBg) desktopBg.style.display = 'block';
    initDesktopMode();
    syncSidebarDock();
    if (taskbar) taskbar.classList.add('open');
    // Focus first window
    const firstWin = document.querySelector('.app-window');
    if (firstWin) bringToFront(firstWin);
  } else {
    if (main) main.classList.remove('desktop-mode');
    if (desktopBg) desktopBg.style.display = 'none';
    if (taskbar) taskbar.classList.remove('open');
    const dock = document.getElementById('sidebar-dock');
    if (dock) dock.remove();
    destroyDesktopMode();
    // Restore default tab
    const defaultTab = document.querySelector('.nav-tab.active');
    if (defaultTab) {
      const tab = defaultTab.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('tab-' + tab);
      if (panel) panel.classList.add('active');
    }
  }
}

// Window control event delegation
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.win-btn');
  if (!btn) return;
  const tabId = btn.dataset.win;
  const win = document.querySelector(`.app-window[data-tab="${tabId}"]`);
  if (!win) return;

  if (btn.classList.contains('minimize')) {
    if (win.classList.contains('minimized')) {
      win.classList.remove('minimized');
      win.style.opacity = '';
      win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0)`;
    } else {
      win.style.opacity = '0';
      win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0) scale(0.9)`;
      setTimeout(() => { win.classList.add('minimized'); }, 320);
    }
    syncTaskbar();
  } else if (btn.classList.contains('maximize')) {
    const wasMax = win.classList.contains('maximized');
    if (!wasMax) {
      win.dataset.preMaxPosX = win.dataset.posX || '0';
      win.dataset.preMaxPosY = win.dataset.posY || '0';
      win.dataset.preMaxW = win.style.width;
      win.dataset.preMaxH = win.style.height;
      win.classList.add('maximized');
      win.style.transform = 'translate3d(0, 0, 0)';
    } else {
      win.classList.remove('maximized');
      win.style.width = win.dataset.preMaxW || '520px';
      win.style.height = win.dataset.preMaxH || '420px';
      win.style.transform = `translate3d(${win.dataset.preMaxPosX || 0}px, ${win.dataset.preMaxPosY || 0}px, 0)`;
    }
  } else if (btn.classList.contains('close')) {
    win.style.opacity = '0';
    win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0) scale(0.8)`;
    setTimeout(() => { win.style.display = 'none'; syncTaskbar(); syncSidebarDock(); }, 320);
  }
});

// Focus on window click
document.addEventListener('click', (e) => {
  const win = e.target.closest('.app-window');
  if (win) bringToFront(win);
});

// Taskbar click to restore/focus
document.addEventListener('click', (e) => {
  const item = e.target.closest('.taskbar-item');
  if (!item) return;
  const tabId = item.dataset.taskbar;
  const win = document.querySelector(`.app-window[data-tab="${tabId}"]`);
  if (!win) return;
  const winContent = win.querySelector('.window-content');
  if (winContent && winContent.children.length === 0) {
    ensureTabScripts('tab-' + tabId);
  }
  if (win.style.display === 'none') {
    win.style.display = '';
    win.style.opacity = '0';
    win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0) scale(0.8)`;
    requestAnimationFrame(() => {
      win.style.opacity = '';
      win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0)`;
    });
  }
  if (win.classList.contains('minimized')) {
    win.classList.remove('minimized');
    win.style.opacity = '';
    win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0)`;
  }
  bringToFront(win);
  syncTaskbar();
  syncSidebarDock();
});

// Sidebar dock click to open/focus
document.addEventListener('click', (e) => {
  const item = e.target.closest('.sidebar-dock__item');
  if (!item) return;
  const tabId = item.dataset.dockTab;
  const win = document.querySelector(`.app-window[data-tab="${tabId}"]`);
  if (!win) return;
  if (win.style.display === 'none') {
    win.style.display = '';
    win.style.opacity = '0';
    win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0) scale(0.8)`;
    requestAnimationFrame(() => {
      win.style.opacity = '';
      win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0)`;
    });
  }
  if (win.classList.contains('minimized')) {
    win.classList.remove('minimized');
    win.style.opacity = '';
    win.style.transform = `translate3d(${win.dataset.posX || 0}px, ${win.dataset.posY || 0}px, 0)`;
  }
  bringToFront(win);
  syncTaskbar();
  syncSidebarDock();
});

function setTheme(theme) {
  if (!theme || !theme.tokens) return;
  const root = document.documentElement;
  const t = theme.tokens;
  root.style.setProperty('--bg', t.bg || '#000');
  root.style.setProperty('--surface', t.surface || '#111');
  root.style.setProperty('--surface-2', t['surface-2'] || '#222');
  root.style.setProperty('--accent', t.accent || '#0f0');
  root.style.setProperty('--accent-2', t['accent-2'] || '#0a0');
  root.style.setProperty('--text', t.text || '#e8f0ec');
  root.style.setProperty('--text-dim', t['text-dim'] || '#8fa89a');
  root.style.setProperty('--danger', t.danger || '#ff3333');
  root.style.setProperty('--warn', t.warn || '#ffaa00');
  root.style.setProperty('--border', t.border || '#1f3329');
  root.style.setProperty('--radius', t.radius || '4px');
  root.style.setProperty('--shadow', t.shadow || 'none');
  const fx = theme.effects || {};
  root.style.setProperty('--text-shadow', fx.textShadow || 'none');
  root.style.setProperty('--scanline-opacity', fx.scanlineOpacity || '0');
  if (theme.fontFamily) {
    document.body.style.fontFamily = theme.fontFamily;
  }
  localStorage.setItem('jericho_theme_id', theme.id);
}

function getSavedTheme() {
  const id = localStorage.getItem('jericho_theme_id');
  if (!id) return MINIMAL_THEMES[0];
  const preset = MINIMAL_THEMES.find(t => t.id === id);
  if (preset) return preset;
  return MINIMAL_THEMES[0];
}

function loadSavedTheme() {
  try {
    const theme = getSavedTheme();
    setTheme(theme);
  } catch (e) {
    console.error('Failed to load saved theme:', e);
  }
}

function renderSwatches(tokens) {
  const colors = [tokens.accent, tokens.bg, tokens.surface, tokens.text];
  return colors.map(c => `<div class="theme-swatch" style="background:${c}"></div>`).join('');
}

function renderThemeLists() {
  const presetGrid = document.getElementById('theme-presets');
  let savedId = 'paper';
  try { savedId = localStorage.getItem('jericho_theme_id') || 'paper'; } catch (e) {}
  try {
    if (presetGrid) {
      presetGrid.innerHTML = MINIMAL_THEMES.map(t => `
        <div class="theme-card ${t.id === savedId ? 'active' : ''}" data-theme-id="${t.id}" data-category="preset">
          <div class="theme-card-name">${escapeHtml(t.name)}</div>
          <div class="theme-swatches">${renderSwatches(t.tokens)}</div>
        </div>
      `).join('');
    }
    const customGrid = document.getElementById('theme-custom');
    if (customGrid) customGrid.innerHTML = '';
  } catch (e) {
    debugLog('[themes] render error: ' + e.message);
    if (presetGrid) presetGrid.innerHTML = '<div style="color:var(--danger);padding:8px;">Themes unavailable</div>';
  }
}

function setupThemePanel() {
  const navOverlay = document.getElementById('nav-overlay');
  const themeOverlay = document.getElementById('theme-overlay');
  const themeBtn = document.getElementById('nav-theme-btn');
  const themeClose = document.getElementById('theme-overlay-close');

  if (!themeBtn || !themeOverlay) return;

  // Render presets immediately so themes are visible even before API call
  renderThemeLists();

  themeBtn.addEventListener('click', () => {
    navOverlay.classList.remove('open');
    navOverlay.setAttribute('aria-hidden', 'true');
    themeOverlay.classList.add('open');
    themeOverlay.setAttribute('aria-hidden', 'false');
  });

  themeClose.addEventListener('click', () => {
    themeOverlay.classList.remove('open');
    themeOverlay.setAttribute('aria-hidden', 'true');
  });

  themeOverlay.addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    const id = card.dataset.themeId;
    let theme = MINIMAL_THEMES.find(t => t.id === id);
    if (theme) {
      setTheme(theme);
      renderThemeLists();
    }
  });

  // Theme overlay outside-click is handled by unified handleOutsideTap listener below
}

// ─── Lazy Tab Script Loading ─────────────────────────────────────────────────
const TAB_SCRIPTS = {
  'tab-system': ['https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js', 'static/js/system.js?v=' + BUILD_ID],
  'tab-agents': ['static/js/agents.js?v=' + BUILD_ID],
  'tab-terminal': ['static/js/agent-state.js?v=' + BUILD_ID, 'static/js/terminal.js?v=' + BUILD_ID, 'static/js/command-assistant.js?v=' + BUILD_ID],
  'tab-code': [],
  'tab-notes': [],
  'tab-capture': [],
  'tab-projects': [],
  'tab-platforms': [],
  'tab-services': [],
  'tab-kimi': [],
};
const TAB_INIT_FNS = {
  'tab-system': () => { if (typeof initSystemTab === 'function') initSystemTab(); },
  'tab-agents': () => { if (typeof initAgentsTab === 'function') initAgentsTab(); },
  'tab-terminal': () => { if (typeof initTerminal === 'function') initTerminal(); },
  'tab-code': () => {},
  'tab-notes': () => { if (typeof loadNotesList === 'function') loadNotesList(); },
  'tab-capture': () => {},
  'tab-projects': () => { if (typeof loadFileBrowser === 'function') loadFileBrowser(currentBrowsePath); setupFileBrowserScroll(); },
  'tab-platforms': () => { if (typeof loadPlatforms === 'function') loadPlatforms(); },
  'tab-services': () => { if (typeof loadServicesLocal === 'function') loadServicesLocal(); },
  'tab-kimi': () => { if (typeof loadKimiSessions === 'function') loadKimiSessions(); },
};

function ensureTabScripts(tabId) {
  const scripts = TAB_SCRIPTS[tabId];
  if (!scripts) return;
  if (scripts._loaded) {
    if (desktopMode) {
      bridgeInitToWindow(tabId);
      return;
    }
    TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
    return;
  }
  scripts._loaded = true;
  let pending = scripts.length;
  if (!pending) {
    if (desktopMode) {
      bridgeInitToWindow(tabId);
      return;
    }
    TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
    return;
  }
  scripts.forEach(src => {
    const fullSrc = src.startsWith('http') ? src : (PREFIX ? PREFIX + '/' + src : src);
    if (document.querySelector('script[src="' + fullSrc + '"]')) {
      if (--pending === 0) {
        if (desktopMode) bridgeInitToWindow(tabId);
        else TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
      }
      return;
    }
    const s = document.createElement('script');
    s.src = fullSrc;
    s.onload = () => {
      if (--pending === 0) {
        if (desktopMode) bridgeInitToWindow(tabId);
        else TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
      }
    };
    s.onerror = () => {
      debugLog('[lazy] failed to load ' + fullSrc);
      if (--pending === 0) {
        if (desktopMode) bridgeInitToWindow(tabId);
        else TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
      }
    };
    document.head.appendChild(s);
  });
}

function bridgeInitToWindow(tabId) {
  const tab = document.getElementById(tabId);
  const win = document.querySelector('.app-window[data-tab="' + tabId.replace('tab-', '') + '"]');
  const winContent = win ? win.querySelector('.window-content') : null;
  if (tab && winContent) {
    // Temporarily move window content back to hidden panel so init can populate it
    while (winContent.firstChild) {
      tab.appendChild(winContent.firstChild);
    }
    // Call init (it populates the panel)
    TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
    // Move populated content back to the visible window
    while (tab.firstChild) {
      winContent.appendChild(tab.firstChild);
    }
  } else {
    TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
  }
}

// ─── Debug Overlay ───────────────────────────────────────────────────────────
function debugLog(msg) {
  const line = new Date().toLocaleTimeString() + ' ' + msg;
  debugLines.push(line);
  if (debugLines.length > 50) debugLines.shift();
  const el = document.getElementById('debug-panel');
  if (el) el.textContent = debugLines.join('\n');
  console.log(msg);
}

function debugShow() {
  const panel = document.getElementById('debug-wrap');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken && accessToken !== 'dev-bypass') {
    headers['Authorization'] = 'Bearer ' + accessToken;
  }
  return headers;
}

let _toastTimer = null;
function showToast(message, type = 'info', duration = 3000) {
  let el = document.getElementById('jericho-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jericho-toast';
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10001;padding:10px 18px;border-radius:var(--radius);font-size:13px;font-weight:500;pointer-events:none;opacity:0;transition:opacity 0.2s;max-width:90vw;word-break:break-word;';
    document.body.appendChild(el);
  }
  const colors = {
    info:    'background:var(--accent);color:#000;',
    warn:    'background:var(--warn);color:#000;',
    error:   'background:var(--danger);color:#000;',
    rate:    'background:var(--warn);color:#000;',
  };
  el.style.cssText += (colors[type] || colors.info);
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

async function handleResponse(res, retryFn) {
  debugLog('[fetch] status ' + res.status);
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (!refreshed) {
      debugLog('[fetch] refresh failed, throwing 401');
      showToast('Session expired. Please log in again.', 'error', 5000);
      throw new Error('Unauthorized');
    }
    debugLog('[fetch] retrying with new token');
    return retryFn();
  }
  if (res.status === 429) {
    let data = {};
    try { data = await res.json(); } catch (e) {}
    const retryAfter = data?.parameters?.retry_after || data?.retry_after || 5;
    showToast(`Rate limited. Retry in ${retryAfter}s`, 'rate', 3000);
    throw new Error(`Rate limited: retry after ${retryAfter}s`);
  }
  if (res.status >= 500) {
    let detail = '';
    try { const d = await res.json(); detail = d.detail || ''; } catch (e) {}
    showToast('Server error: ' + (detail || 'Please retry.'), 'error', 4000);
    throw new Error(`HTTP ${res.status}` + (detail ? ` — ${detail}` : ''));
  }
  if (!res.ok) {
    showToast(`Request failed (${res.status})`, 'error', 4000);
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

async function apiGet(url) {
  debugLog('[fetch] GET ' + API_BASE + url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(API_BASE + url, {
      credentials: 'same-origin',
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await handleResponse(res, () => apiGet(url));
    if (result !== res) return result;
    return res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  }
}

async function apiPost(url, body) {
  debugLog('[fetch] POST ' + API_BASE + url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const res = await fetch(API_BASE + url, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  const result = await handleResponse(res, () => apiPost(url, body));
  if (result !== res) return result;
  return res.json();
}

async function apiPostForm(url, formData) {
  const headers = {};
  if (accessToken) {
    headers['Authorization'] = 'Bearer ' + accessToken;
  }
  debugLog('[fetch] POST(form) ' + API_BASE + url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(API_BASE + url, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await handleResponse(res, () => apiPostForm(url, formData));
    if (result !== res) return result;
    return res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  }
}

async function tryRefresh() {
  try {
    debugLog('[refresh] trying cookie refresh...');
    const res = await fetch(PREFIX + '/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) { debugLog('[refresh] server returned ' + res.status); return false; }
    const data = await res.json();
    if (data.access_token) {
      accessToken = data.access_token;
      debugLog('[refresh] got new access token');
      return true;
    }
  } catch (e) {
    debugLog('[refresh] error: ' + e.message);
  }
  return false;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
async function checkSession() {
  debugLog('[checkSession] checking session...');
  // Try refreshing the token first
  const refreshed = await tryRefresh();
  if (refreshed) {
    debugLog('[checkSession] session refreshed, loading dashboard');
    capabilities = {
      terminal: true, agent_control: true, file_browser: true,
      push_notifications: false, offline_queue: false,
      biometric_unlock: false, team_sharing: false, audit_logs: false
    };
    updateCapabilityBadge('free');
    showDashboard();
    return;
  }
  debugLog('[checkSession] no valid session, showing login');
  showLogin();
}

async function login() {
  const passphrase = document.getElementById('login-passphrase')?.value || '';
  const totp = document.getElementById('login-totp')?.value || '';
  const errorEl = document.getElementById('login-error');

  if (!passphrase) {
    if (errorEl) { errorEl.textContent = 'Passphrase required'; errorEl.style.display = 'block'; }
    else { alert('Passphrase required'); }
    return;
  }

  debugLog('[login] authenticating to ' + (PREFIX + '/api/auth/login'));
  try {
    const res = await fetch(PREFIX + '/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, totp }),
    });

    debugLog('[login] response status: ' + res.status);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.detail || 'Authentication failed (' + res.status + ')';
      debugLog('[login] auth failed: ' + msg);
      if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
      else { alert(msg); }
      return;
    }

    const data = await res.json();
    accessToken = data.access_token;
    debugLog('[login] authenticated successfully');

    // Clear inputs
    const ppInput = document.getElementById('login-passphrase');
    const totpInput = document.getElementById('login-totp');
    if (ppInput) ppInput.value = '';
    if (totpInput) totpInput.value = '';
    if (errorEl) errorEl.style.display = 'none';

    capabilities = {
      terminal: true, agent_control: true, file_browser: true,
      push_notifications: false, offline_queue: false,
      biometric_unlock: false, team_sharing: false, audit_logs: false
    };
    updateCapabilityBadge('free');
    showDashboard();
  } catch (e) {
    debugLog('[login] network/syntax error: ' + e.message);
    if (errorEl) { errorEl.textContent = 'Network error: ' + e.message; errorEl.style.display = 'block'; }
    else { alert('Network error: ' + e.message); }
  }
}

async function logout() {
  try {
    await fetch(PREFIX + '/api/auth/logout', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'same-origin',
    });
  } catch {}
  accessToken = null;
  sessionStorage.removeItem('access_token');
  showLogin();
  if (sessionCheckInterval) clearInterval(sessionCheckInterval);
  if (window.terminalManager) window.terminalManager.disconnect();
}

function showGatekeeper() {
  const g = document.getElementById('login-screen');
  const d = document.getElementById('dashboard');
  if (g) {
    g.classList.add('active');
    g.style.display = 'flex';
  }
  if (d) {
    d.classList.remove('active');
    d.style.display = 'none';
  }
}

function showLogin() {
  debugLog('[showLogin] showing login screen');
  const loginScreen = document.getElementById('login-screen');
  const dashboard = document.getElementById('dashboard');
  if (loginScreen) {
    loginScreen.classList.add('active');
    loginScreen.style.display = 'flex';
  }
  if (dashboard) {
    dashboard.classList.remove('active');
    dashboard.style.display = 'none';
  }
  accessToken = null;
}

function showDashboard() {
  try {
    debugLog('[showDashboard] switching to dashboard');
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) {
      debugLog('[showDashboard] CRITICAL: missing dashboard element');
      return;
    }
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      loginScreen.classList.remove('active');
      loginScreen.style.display = 'none';
    }
    dashboard.classList.add('active');
    dashboard.style.display = 'flex';
    closeNavOverlay();
    initSudoUI();
    // Iframes self-init their own content; parent only handles global pulses
    loadDockerPulse().catch(e => debugLog('[dashboard] docker error: ' + e.message));
    loadTailscalePulse().catch(e => debugLog('[dashboard] tailscale error: ' + e.message));
    loadFileBrowser(currentBrowsePath).catch(e => debugLog('[dashboard] filebrowser error: ' + e.message));
    if (sessionCheckInterval) clearInterval(sessionCheckInterval);
    sessionCheckInterval = setInterval(() => {
      apiGet('/me').catch(e => debugLog('[sessionCheck] ' + e.message));
    }, 60000);
  } catch (e) {
    debugLog('[showDashboard] CRITICAL ERROR: ' + e.message);
  }
}

function updateCapabilityBadge(tier) {
  const badge = document.getElementById('capability-badge');
  badge.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
  badge.className = 'cap-badge ' + tier;
}

// ─── Version Changelog ───────────────────────────────────────────────────────
const JERICHO_CHANGELOG = [
  {
    version: 'Build 34', tag: '0.10.0', date: '2026-05-22',
    changes: [
      'Build 34: Changelog versioning fix — each build now shows unique Build N title',
    ]
  },
  {
    version: 'Build 33', tag: '0.10.0', date: '2026-05-22',
    changes: [
      'Build 33: Menu overlay polish — renamed Projects to File Browser',
      'Build 33: Inline changelog renderer — works even if cached JS is stale',
      'Build 33: Tap-outside-to-close menu overlay with touchstart support',
    ]
  },
  {
    version: 'Build 32', tag: '0.10.0', date: '2026-05-22',
    changes: [
      'Build 32: Mermaid diagram support in markdown file previews',
      'Build 32: Lazy CDN load with graceful fallback to raw source',
    ]
  },
  {
    version: 'Build 31', tag: '0.10.0', date: '2026-05-22',
    changes: [
      'Build 31: Rich file preview — markdown, syntax highlighting, CSV, logs, JSON',
      'Build 31: Inline zero-dependency renderers in HTML head',
      'Build 31: Mobile-friendly preview modal with 44px touch targets',
    ]
  },
  {
    version: 'Build 30', tag: '0.10.0', date: '2026-05-21',
    changes: [
      'Build 30: File preview on mobile — Preview & Download buttons on inline cards',
      'Build 30: Inline preview handler bypassing cached JS',
    ]
  },
  {
    version: 'Build 29', tag: '0.10.0', date: '2026-05-21',
    changes: [
      'Build 29: Strategic SW + inline fetch — network-only service worker registers first',
      'Build 29: Inline critical CSS and diagnostic fetch script',
      'Build 29: Manifest start_url tied to build version for PWA cache busting',
    ]
  },
  {
    version: 'Build 28', tag: '0.10.0', date: '2026-05-20',
    changes: [
      'Build 28: Health restoration — started monitor, agentd, shell, terminal-bridge',
      'Build 28: Removed nginx port 9010 block, updated shell systemd unit',
    ]
  },
  {
    version: 'Build 27', tag: '0.10.0', date: '2026-05-20',
    changes: [
      'Build 27: Nuclear cache break — per-build SW_BUILD sessionStorage key',
      'Build 27: Clear-Site-Data header, unconditional SW unregister + IndexedDB purge',
    ]
  },
  {
    version: 'Build 26', tag: '0.10.0', date: '2026-05-20',
    changes: [
      'Build 26: File browser fetch hardening — cache: no-store, 8s mobile timeout',
      'Build 26: Red error box with retry, CORS mode',
    ]
  },
  {
    version: 'Build 25', tag: '0.10.0', date: '2026-05-19',
    changes: [
      'Build 25: Full mobile UX overhaul — visible card backgrounds, local xterm.js',
      'Build 25: Connection status dot, changelog inline render, nginx no-cache headers',
    ]
  },
  {
    version: 'Build 24', tag: '0.10.0', date: '2026-05-19',
    changes: [
      'Build 24: Terminal-bridge secret fix, error boundaries, BUILD_ID bump',
      'Build 24.1: Fixed hardcoded build numbers in index.html and jericho.js',
    ]
  },
  {
    version: 'Build 23', tag: '0.10.0', date: '2026-05-19',
    changes: [
      'Build 23: Rebuilt container with cache buster fixes',
      'Build 23: TAB_SCRIPTS?v=BUILD_ID, handleResponse retry bug fix',
    ]
  },
  {
    version: 'Build 22', tag: '0.10.0', date: '2026-05-19',
    changes: [
      'Build 22: Secure sudo execution pipeline — mobile sudo via 2-min tickets',
      'Build 22: Sudo command allowlist with pattern matching + audit trail',
      'Build 22: File browser cache fix — removed executionContexts reload race',
      'Build 22: Shell microservice with sudo endpoints on port 9004',
    ]
  },
  {
    version: '0.10.0', tag: 'dev', date: '2026-05-19',
    changes: [
      'Build 21: File browser card visibility, system chart gradients, terminal origin fix',
      'Build 21: Changelog dropdown styling fix',
      'Build 21: Background worker with file watcher and health pulse',
      'Build 21: AgentD revived with auth bypass and running on port 9003',
      'EMERGENCY: Abandoned iframe architecture — reverted to direct DOM tabs',
      'Lazy script loading: Chart.js, system.js, terminal.js load on first tab open',
      'Mobile viewport fix: 100dvh + safe-area-inset-bottom support',
      'Statusbar changed from fixed to flex-shrink for proper layout',
      'Nginx cache headers updated to immutable for versioned static assets',
    ]
  },
  {
    version: '0.10.0', tag: 'dev', date: '2026-05-18',
    changes: [
      'Per-tab independent scrolling via CSS isolation',
      'Sub-versioning with semver changelog format',
      'Auto-log version changes to backend changelog.log',
      'All inline onclick handlers converted to event delegation',
      'Dead iframe code cleaned up from JS files',
    ]
  },
  {
    version: '0.9.0', tag: 'dev', date: '2026-05-17',
    changes: [
      'Fullscreen toggle with back-gesture safe exit',
      'Topbar cleanup: menu button far right, logout inside overlay',
      'Statusbar fixed to viewport bottom for more working area',
      'Desktop mode on mobile by default (toggle in menu)',
    ]
  },
  {
    version: '0.8.0', tag: 'dev', date: '2026-05-15',
    changes: [
      'Collapsible nav overlay with ☰ menu button',
      'File browser custom scrollbar styling',
      'Tab visibility fix — File Browser no longer bleeds across tabs',
      'Build system with cache-busted static assets',
    ]
  },
  {
    version: '0.7.0', tag: 'dev', date: '2026-05-14',
    changes: [
      'File preview modal (images, text, code, markdown, JSON)',
      'File browser scroll position memory per directory',
      'Agent platform discovery (Ollama, OpenClaw, Nemoclaw)',
      'Kimi session launcher with error handling',
      'Docker & Tailscale pulse caching with sessionStorage',
    ]
  },
  {
    version: '0.6.0', tag: 'dev', date: '2026-05-13',
    changes: [
      'Live System Pulse with Chart.js (CPU, RAM, load, disk, network)',
      'Top processes table with CPU/RAM sorting',
      'Quick Actions tab replacing broken Agents tab',
      'Service Directory with local & public service tables',
    ]
  },
];

function renderChangelog() {
  const container = document.getElementById('nav-changelog');
  if (!container) return;
  // Skip if inline renderer in index.html already rendered the changelog
  if (container.dataset.inlineRendered) {
    debugLog('[changelog] skipping render — inline version already present');
    return;
  }
  if (!JERICHO_CHANGELOG || !JERICHO_CHANGELOG.length) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px;">No changelog entries.</div>';
    return;
  }
  try {
    container.innerHTML = JERICHO_CHANGELOG.map(entry => {
      const changes = entry.changes.map(c => `<li>${escapeHtml(c)}</li>`).join('');
      return `
        <div class="changelog-entry">
          <div class="ch-version">
            <span>${escapeHtml(entry.version)}</span>
            <span class="dev-tag" style="font-size:9px;padding:1px 6px;">${escapeHtml(entry.tag)}</span>
          </div>
          <div class="ch-date">${escapeHtml(entry.date)}</div>
          <ul>${changes}</ul>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:var(--danger);padding:8px;">Changelog unavailable</div>';
    debugLog('[changelog] render error: ' + e.message);
  }
}

function toggleChangelog() {
  const panel = document.getElementById('nav-changelog');
  const btn = document.getElementById('nav-version-toggle');
  if (!panel || !btn) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
  } else {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
  }
}

// ─── Nav Overlay ─────────────────────────────────────────────────────────────
function toggleNavOverlay() {
  const overlay = document.getElementById('nav-overlay');
  const btn = document.getElementById('nav-menu-btn');
  if (!overlay || !btn) return;
  const isOpen = overlay.classList.contains('open');
  if (isOpen) closeNavOverlay();
  else openNavOverlay();
}

function openNavOverlay() {
  const overlay = document.getElementById('nav-overlay');
  const btn = document.getElementById('nav-menu-btn');
  if (!overlay || !btn) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  btn.setAttribute('aria-expanded', 'true');
}

function closeNavOverlay() {
  const overlay = document.getElementById('nav-overlay');
  const btn = document.getElementById('nav-menu-btn');
  if (!overlay || !btn) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  btn.setAttribute('aria-expanded', 'false');
}

// ─── Fullscreen ──────────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().then(() => {
      history.pushState({ fullscreen: true }, '');
    }).catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

function updateFsButton() {
  const btn = document.getElementById('fs-toggle');
  if (!btn) return;
  btn.textContent = document.fullscreenElement ? '🗗' : '⛶';
}

window.addEventListener('fullscreenchange', updateFsButton);

// Back button / gesture exits fullscreen without navigating back
window.addEventListener('popstate', (e) => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    // Prevent navigation by pushing another dummy state
    history.pushState({ fullscreen: true }, '');
  }
});

// ─── Desktop Mode ────────────────────────────────────────────────────────────
const DESKTOP_MODE_KEY = 'jericho_desktop_mode';

function getDesktopMode() {
  try {
    const stored = localStorage.getItem(DESKTOP_MODE_KEY);
    if (stored !== null) return stored === 'true';
  } catch {}
  return true; // default ON
}

function setDesktopMode(enabled) {
  try {
    localStorage.setItem(DESKTOP_MODE_KEY, String(enabled));
  } catch {}
  applyDesktopMode(enabled);
}

function applyDesktopMode(enabled) {
  const viewport = document.getElementById('viewport-meta');
  const checkbox = document.getElementById('desktop-mode-check');
  if (checkbox) checkbox.checked = enabled;
  if (!viewport) return;
  if (enabled) {
    const scale = Math.min(window.innerWidth / 1280, 1);
    viewport.content = `width=1280, initial-scale=${scale.toFixed(3)}`;
  } else {
    viewport.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  }
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.classList.add('active');
    ensureTabScripts('tab-' + tab);
    if (tab === 'terminal' && window.terminalManager) {
      setTimeout(() => window.terminalManager.fit(), 50);
    }
    closeNavOverlay();
  });
});

// Changelog "more" link — opens full changelog tab (hidden from nav overlay)
document.addEventListener('click', (e) => {
  const moreLink = e.target.closest('.changelog-more');
  if (!moreLink) return;
  e.preventDefault();
  closeNavOverlay();
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const changelogPanel = document.getElementById('tab-changelog');
  if (changelogPanel) changelogPanel.classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
});

// Overlay trigger & close handlers
(function initNavOverlay() {
  const menuBtn = document.getElementById('nav-menu-btn');
  const closeBtn = document.querySelector('.nav-overlay-close');
  const versionBtn = document.getElementById('nav-version-toggle');
  const fsBtn = document.getElementById('fs-toggle');
  const desktopCheck = document.getElementById('desktop-mode-check');
  const logoutBtn = document.getElementById('nav-logout');
  if (menuBtn) menuBtn.addEventListener('click', toggleNavOverlay);
  if (closeBtn) closeBtn.addEventListener('click', closeNavOverlay);
  if (versionBtn) versionBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleChangelog(); });
  if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
  if (desktopCheck) {
    desktopCheck.addEventListener('change', (e) => setDesktopMode(e.target.checked));
  }
  const windowCheck = document.getElementById('window-mode-check');
  if (windowCheck) {
    windowCheck.addEventListener('change', (e) => toggleDesktopMode(e.target.checked));
  }
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  // Debug & preview listeners
  const debugClose = document.getElementById('debug-close');
  const debugToggle = document.getElementById('debug-toggle');
  const previewClose = document.getElementById('preview-close');
  if (debugClose) debugClose.addEventListener('click', debugShow);
  if (debugToggle) debugToggle.addEventListener('click', debugShow);
  if (previewClose) previewClose.addEventListener('click', closePreview);
  // File browser listeners
  const fbParent = document.getElementById('fb-parent');
  const fbRefresh = document.getElementById('fb-refresh');
  const fbScrollTop = document.getElementById('fb-scroll-top');
  const fbUploadBtn = document.getElementById('fb-upload-btn');
  const fbUploadInput = document.getElementById('fb-upload-input');
  const fbMkdir = document.getElementById('fb-mkdir');
  if (fbParent) fbParent.addEventListener('click', navigateParent);
  if (fbRefresh) fbRefresh.addEventListener('click', () => loadFileBrowser(currentBrowsePath));
  if (fbScrollTop) fbScrollTop.addEventListener('click', scrollFileBrowserTop);
  if (fbUploadBtn && fbUploadInput) {
    fbUploadBtn.addEventListener('click', () => fbUploadInput.click());
    fbUploadInput.addEventListener('change', handleFileUpload);
  }
  if (fbMkdir) fbMkdir.addEventListener('click', handleMkdir);
  startFbPolling();
  renderChangelog();
  applyDesktopMode(getDesktopMode());
})();

// Re-apply desktop mode on resize/orientation change
window.addEventListener('resize', () => {
  applyDesktopMode(getDesktopMode());
});

// Close overlays on outside tap/click
function handleOutsideTap(e) {
  const navOverlay = document.getElementById('nav-overlay');
  const navBtn = document.getElementById('nav-menu-btn');
  const themeOverlay = document.getElementById('theme-overlay');
  const themeBtn = document.getElementById('nav-theme-btn');

  if (navOverlay && navOverlay.classList.contains('open')) {
    if (!navOverlay.contains(e.target) && e.target !== navBtn && !navBtn.contains(e.target)) {
      closeNavOverlay();
    }
  }

  if (themeOverlay && themeOverlay.classList.contains('open')) {
    if (!themeOverlay.contains(e.target) && e.target !== themeBtn && !themeBtn.contains(e.target)) {
      themeOverlay.classList.remove('open');
      themeOverlay.setAttribute('aria-hidden', 'true');
    }
  }
}

document.addEventListener('click', handleOutsideTap);
document.addEventListener('touchstart', handleOutsideTap, { passive: true });

// File browser event delegation
document.addEventListener('click', (e) => {
  const dirCard = e.target.closest('.fb-dir');
  if (dirCard) {
    navigateTo(dirCard.dataset.navigate);
    return;
  }
  const previewBtn = e.target.closest('.fb-preview');
  if (previewBtn) {
    e.stopPropagation();
    previewFile(previewBtn.dataset.preview);
    return;
  }
  const retryBtn = e.target.closest('.fb-retry');
  if (retryBtn) {
    loadFileBrowser(currentBrowsePath);
    return;
  }
});

// Close overlay on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeNavOverlay();
});

// ─── File Browser ────────────────────────────────────────────────────────────
let currentBrowsePath = '/srv';
let fbScrollPositions = {};

let _fbLoading = false;

async function loadFileBrowser(path, attempt = 1, silent = false) {
  const grid = document.getElementById('projects-grid');
  const pathEl = document.getElementById('fb-path');
  const parentBtn = document.getElementById('fb-parent');
  if (!grid) { console.error('[filebrowser] grid element not found'); return; }
  if (_fbLoading) { console.log('[filebrowser] already loading, skipping'); return; }
  _fbLoading = true;
  if (!silent) {
    grid.innerHTML = '<div class="fb-loading"><span class="fb-spinner">⟳</span> Loading files...</div>';
  }
  try {
    console.log('[filebrowser] fetching ' + path + ' (attempt ' + attempt + ')');
    const isMobile = window.innerWidth < 768 || navigator.maxTouchPoints > 0;
    const timeoutMs = isMobile ? 8000 : (attempt === 1 ? 15000 : 10000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(API_BASE + '/projects?path=' + encodeURIComponent(path), {
      credentials: 'same-origin',
      mode: 'cors',
      cache: 'no-store',
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log('[filebrowser] status ' + res.status);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.entries)) {
      throw new Error('Invalid server response: missing entries array');
    }
    currentBrowsePath = data.path;
    if (pathEl) pathEl.textContent = data.path;
    if (parentBtn) parentBtn.style.display = data.parent ? 'inline-block' : 'none';
    console.log('[filebrowser] received ' + data.entries.length + ' entries');
    if (!data.entries.length) {
      grid.innerHTML = '<div class="fb-empty">Empty directory</div>';
      _fbLoading = false;
      return;
    }
    grid.innerHTML = data.entries.map(e => {
      if (e.type === 'directory') {
        return `
          <div class="card fb-dir" data-navigate="${escapeHtml(e.path)}">
            <div class="fb-icon">📁</div>
            <div class="fb-name">${escapeHtml(e.name)}</div>
            <div class="fb-meta">folder</div>
          </div>
        `;
      } else {
        const size = formatBytes(e.size || 0);
        return `
          <div class="card fb-file">
            <div class="fb-icon">📄</div>
            <div class="fb-name">${escapeHtml(e.name)}</div>
            <div class="fb-meta">${size}</div>
            <div class="fb-actions">
              <button class="btn-small fb-preview" data-preview="${encodeURIComponent(e.path)}">👁 Preview</button>
              <a href="${PREFIX}/api/web/download?path=${encodeURIComponent(e.path)}" target="_blank" class="btn-small" style="text-decoration:none;">⬇ Download</a>
            </div>
          </div>
        `;
      }
    }).join('');
    _fbLastEntriesHash = getFbEntriesHash(data);
    const scrollArea = document.getElementById('fb-scroll-area');
    if (scrollArea) {
      const saved = fbScrollPositions[data.path];
      if (saved !== undefined) {
        setTimeout(() => { scrollArea.scrollTop = saved; }, 10);
      } else {
        scrollArea.scrollTop = 0;
      }
    }
  } catch (e) {
    console.error('[filebrowser] error on attempt ' + attempt + ':', e.name, e.message);
    if (e.name === 'AbortError' && attempt < 2) {
      console.log('[filebrowser] timeout, retrying...');
      setTimeout(() => loadFileBrowser(path, attempt + 1, silent), 500);
      return;
    }
    grid.innerHTML = `
      <div class="fb-error">
        <div style="font-size:1.2rem;margin-bottom:6px;">⚠️ Could not load folders</div>
        <div style="font-size:0.85rem;opacity:0.9;margin-bottom:12px;">${escapeHtml(e.message || 'Network error')}</div>
        <button class="btn-small fb-retry" style="font-size:14px;padding:10px 18px;min-height:44px;">🔄 Tap to retry</button>
      </div>
    `;
    const retryBtn = grid.querySelector('.fb-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => loadFileBrowser(path));
  } finally {
    _fbLoading = false;
  }
}

function navigateTo(path) {
  const scrollArea = document.getElementById('fb-scroll-area');
  if (scrollArea) fbScrollPositions[currentBrowsePath] = scrollArea.scrollTop;
  loadFileBrowser(path);
}

function navigateParent() {
  const scrollArea = document.getElementById('fb-scroll-area');
  if (scrollArea) fbScrollPositions[currentBrowsePath] = scrollArea.scrollTop;
  const parent = document.getElementById('fb-path').textContent;
  if (parent) {
    const p = parent.split('/').slice(0, -1).join('/') || '/';
    loadFileBrowser(p);
  }
}

function scrollFileBrowserTop() {
  const scrollArea = document.getElementById('fb-scroll-area');
  if (scrollArea) scrollArea.scrollTop = 0;
}

// ─── File Browser Auto-Refresh + Upload + Mkdir ──────────────────────────────
let _fbPollTimer = null;
let _fbLastEntriesHash = '';

function getFbEntriesHash(data) {
  if (!data.entries) return '';
  return data.entries.map(e => e.name + ':' + e.type + ':' + e.size).join('|');
}

function startFbPolling() {
  stopFbPolling();
  _fbPollTimer = setInterval(async () => {
    const check = document.getElementById('fb-autorefresh-check');
    if (!check || !check.checked) return;
    const panel = document.getElementById('tab-projects');
    if (!panel || !panel.classList.contains('active')) return;
    if (document.hidden) return;
    try {
      const res = await fetch(API_BASE + '/projects?path=' + encodeURIComponent(currentBrowsePath), {
        credentials: 'same-origin',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const hash = getFbEntriesHash(data);
      if (hash !== _fbLastEntriesHash) {
        _fbLastEntriesHash = hash;
        await loadFileBrowser(currentBrowsePath, 1, true);
      }
    } catch (e) { /* silent fail on poll */ }
  }, 10000);
}

function stopFbPolling() {
  if (_fbPollTimer) { clearInterval(_fbPollTimer); _fbPollTimer = null; }
}

async function handleFileUpload() {
  const input = document.getElementById('fb-upload-input');
  if (!input || !input.files || !input.files.length) return;
  const files = Array.from(input.files);
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', currentBrowsePath);
    try {
      showToast('Uploading ' + file.name + '...', 'info', 2000);
      await apiPostForm('/upload', formData);
      showToast(file.name + ' uploaded', 'info', 2000);
    } catch (e) {
      showToast('Upload failed: ' + e.message, 'error', 4000);
    }
  }
  input.value = '';
  await loadFileBrowser(currentBrowsePath);
}

async function handleMkdir() {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;
  const safeName = name.trim().replace(/[\\/]/g, '_');
  const newPath = currentBrowsePath.replace(/\/$/, '') + '/' + safeName;
  try {
    await apiPost('/mkdir', { path: newPath });
    showToast('Created ' + safeName, 'info', 2000);
    await loadFileBrowser(currentBrowsePath);
  } catch (e) {
    showToast('Failed to create folder: ' + e.message, 'error', 4000);
  }
}

function setupFileBrowserScroll() {
  const scrollArea = document.getElementById('fb-scroll-area');
  const topBtn = document.getElementById('fb-scroll-top');
  if (!scrollArea || !topBtn) return;
  scrollArea.addEventListener('scroll', function() {
    topBtn.style.display = scrollArea.scrollTop > 200 ? 'block' : 'none';
  });
}

function openProject(path) {
  const tabBtn = document.querySelector('[data-tab="terminal"]');
  if (tabBtn) tabBtn.click();
  if (window.terminalManager && window.terminalManager.connected) {
    window.terminalManager.sendText('cd ' + path + '\r');
  } else {
    alert('Connect to terminal first, then run: cd ' + path);
  }
}

// ─── File Preview ────────────────────────────────────────────────────────────
async function previewFile(path) {
  const modal = document.getElementById('preview-modal');
  const title = document.getElementById('preview-title');
  const body = document.getElementById('preview-body');
  if (!modal || !title || !body) return;
  title.textContent = 'Loading...';
  body.innerHTML = '<p style="color:var(--text-dim)">Loading preview...</p>';
  modal.style.display = 'block';
  try {
    const data = await apiGet('/preview?path=' + path);
    title.textContent = data.name;
    const R = window._jerichoRenderers;
    const lang = data.language || (R ? R.getLang(data.name || '') : '');
    if (data.type === 'image') {
      body.innerHTML = '<img src="' + escapeHtml(data.content) + '" style="max-width:100%;border-radius:4px;display:block;margin:0 auto;">';
    } else if (R && data.type === 'markdown') {
      body.innerHTML = R.markdown(data.content || '');
      R.renderMermaidBlocks(body);
    } else if (R && data.type === 'json') {
      body.innerHTML = R.jsonTree(data.content || '');
    } else if (R && lang === 'csv') {
      body.innerHTML = R.csv(data.content || '');
    } else if (R && lang === 'log') {
      body.innerHTML = R.logs(data.content || '');
    } else if (R && (data.type === 'code' || data.type === 'text')) {
      const code = R.highlight(data.content || '', lang);
      body.innerHTML = '<pre style="background:#0d1117;border:1px solid #333;border-radius:8px;padding:12px;overflow-x:auto;"><code>' + code + '</code></pre>';
    } else if (data.type === 'markdown') {
      body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;line-height:1.5;color:var(--text);">' + escapeHtml(data.content) + '</pre>';
    } else if (data.type === 'json') {
      try {
        const pretty = JSON.stringify(JSON.parse(data.content), null, 2);
        body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;line-height:1.5;color:var(--text);">' + escapeHtml(pretty) + '</pre>';
      } catch {
        body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;color:var(--text);">' + escapeHtml(data.content) + '</pre>';
      }
    } else if (data.type === 'code' || data.type === 'text') {
      body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;line-height:1.5;color:var(--text);">' + escapeHtml(data.content) + '</pre>';
    } else {
      body.innerHTML = '<p style="color:var(--text-dim)">' + escapeHtml(data.content) + '</p>';
    }
    if (data.truncated) {
      body.innerHTML += '<p style="color:var(--warn);font-size:0.8rem;margin-top:8px;">⚠️ File truncated to 1MB preview</p>';
    }
  } catch (e) {
    title.textContent = 'Error';
    body.innerHTML = '<p style="color:var(--danger)">Preview failed: ' + escapeHtml(e.message) + '</p>';
  }
}

function closePreview() {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'none';
}

// ─── Service Directory ───────────────────────────────────────────────────────
document.querySelectorAll('.svc-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.svc-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const svc = btn.dataset.svc;
    document.querySelectorAll('.svc-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`svc-${svc}`).classList.add('active');
    if (svc === 'local') loadServicesLocal();
    if (svc === 'public') loadServicesPublic();
  });
});

async function loadServicesLocal() {
  const tbody = document.getElementById('local-services-body');
  tbody.innerHTML = '<tr><td colspan="3">Scanning...</td></tr>';
  try {
    const services = await apiGet('/services/local');
    const html = services.map(s => {
      if (s.ip === 'docker') {
        return `<tr><td colspan="2">🐳 ${escapeHtml(s.process)}</td><td>${escapeHtml(s.ports || '')}</td></tr>`;
      }
      return `<tr>
        <td>${s.port}</td>
        <td><a href="${escapeHtml(s.url)}" target="_blank">${escapeHtml(s.url)}</a></td>
        <td>${escapeHtml(s.process)}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = html || '<tr><td colspan="3">No services found</td></tr>';
  } catch {
    tbody.innerHTML = '<tr><td colspan="3">Failed to scan</td></tr>';
  }
}

async function loadServicesPublic() {
  const tbody = document.getElementById('public-services-body');
  tbody.innerHTML = '<tr><td colspan="4">Scanning...</td></tr>';
  try {
    const services = await apiGet('/services/public');
    const html = services.map(s => {
      const healthClass = s.healthy === true ? 'up' : (s.healthy === false ? 'down' : 'unknown');
      const healthTitle = s.healthy === true ? 'Healthy' : (s.healthy === false ? 'Unreachable' : 'Unknown');
      return `
        <tr>
          <td><span class="svc-health ${healthClass}" title="${healthTitle}"></span>${escapeHtml(s.domain)}</td>
          <td><a href="${escapeHtml(s.url)}" target="_blank">${escapeHtml(s.url)}</a></td>
          <td>${s.port || '-'}</td>
          <td style="color:var(--text-dim);font-size:12px;">${escapeHtml(s.description || '')}</td>
        </tr>
      `;
    }).join('');
    tbody.innerHTML = html || '<tr><td colspan="4">No public routes configured</td></tr>';
  } catch {
    tbody.innerHTML = '<tr><td colspan="4">Failed to load</td></tr>';
  }
}

// ─── Terminal ────────────────────────────────────────────────────────────────
// Handled by terminal.js

// ─── Code ────────────────────────────────────────────────────────────────────
const loadCodeBtn = document.getElementById('load-code');
if (loadCodeBtn) loadCodeBtn.addEventListener('click', () => {
  document.getElementById('dex-warning').style.display = 'none';
  document.getElementById('code-frame').style.display = 'block';
  document.getElementById('code-frame').src = 'code/';
});

// ─── Notes ───────────────────────────────────────────────────────────────────
async function loadNotesList() {
  const ul = document.getElementById('notes-files');
  try {
    const notes = await apiGet('/notes');
    ul.innerHTML = notes.map(n => `
      <li data-name="${escapeHtml(n.name)}">
        ${escapeHtml(n.name)}
      </li>
    `).join('');
    // Event delegation for notes list
    ul.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => openNote(li.dataset.name));
    });
  } catch {
    ul.innerHTML = '<li>Failed to load</li>';
  }
}

async function openNote(name) {
  currentNote = name;
  document.getElementById('note-name').value = name;
  document.querySelectorAll('#notes-files li').forEach(li => {
    li.classList.toggle('active', li.dataset.name === name);
  });
  try {
    const note = await apiGet(`/notes/${encodeURIComponent(name)}`);
    document.getElementById('note-content').value = note.content;
    document.getElementById('note-status').textContent = '';
  } catch {
    document.getElementById('note-content').value = '';
  }
}

async function saveNote() {
  const name = document.getElementById('note-name').value.trim() || 'untitled';
  const content = document.getElementById('note-content').value;
  try {
    await apiPost(`/notes/${encodeURIComponent(name)}`, { name, content });
    document.getElementById('note-status').textContent = 'Saved';
    currentNote = name;
    loadNotesList();
  } catch {
    document.getElementById('note-status').textContent = 'Save failed';
  }
}

const newNoteBtn = document.getElementById('new-note-btn');
if (newNoteBtn) newNoteBtn.addEventListener('click', () => {
  currentNote = null;
  document.getElementById('note-name').value = '';
  document.getElementById('note-content').value = '';
  document.getElementById('note-status').textContent = '';
});
const saveNoteBtn = document.getElementById('save-note');
if (saveNoteBtn) saveNoteBtn.addEventListener('click', saveNote);

// ─── Quick Capture ───────────────────────────────────────────────────────────
const uploadBtn = document.getElementById('upload-btn');
if (uploadBtn) uploadBtn.addEventListener('click', async () => {
  const input = document.getElementById('capture-input');
  const status = document.getElementById('upload-status');
  if (!input || !input.files.length) { if (status) status.textContent = 'Select a file first'; return; }
  const fd = new FormData();
  fd.append('file', input.files[0]);
  fd.append('folder', 'inbox');
  try {
    const res = await apiPostForm('/upload', fd);
    if (status) status.textContent = 'Uploaded to ' + res.path;
    input.value = '';
  } catch {
    if (status) status.textContent = 'Upload failed';
  }
});

// ─── Status Bar ──────────────────────────────────────────────────────────────
// ─── Cached Pulse Data ───────────────────────────────────────────────────────
function loadPulseFromStorage(key) {
  try {
    const raw = sessionStorage.getItem('pulse_' + key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function savePulseToStorage(key, data) {
  try {
    sessionStorage.setItem('pulse_' + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

const PULSE_CACHE_TTL = 30000; // 30s

async function loadDockerPulse() {
  const el = document.getElementById('docker-pulse');
  if (!el) return;
  const now = Date.now();
  const cached = loadPulseFromStorage('docker');
  if (cached && cached.data && (now - cached.ts) < PULSE_CACHE_TTL) {
    const { running, total } = cached.data;
    el.textContent = `Docker: ${running}/${total} running`;
    el.style.color = running === total ? 'var(--accent-2)' : 'var(--warn)';
    debugLog('[docker] using cached result');
    return;
  }
  try {
    const containers = await apiGet('/docker/containers');
    const running = containers.filter(c => c.status.includes('Up')).length;
    const data = { running, total: containers.length };
    savePulseToStorage('docker', data);
    el.textContent = `Docker: ${running}/${containers.length} running`;
    el.style.color = running === containers.length ? 'var(--accent-2)' : 'var(--warn)';
  } catch {
    el.textContent = 'Docker: offline';
    el.style.color = 'var(--danger)';
  }
}

async function loadTailscalePulse() {
  const el = document.getElementById('tailscale-pulse');
  if (!el) return;
  const now = Date.now();
  const cached = loadPulseFromStorage('tailscale');
  if (cached && cached.data && (now - cached.ts) < PULSE_CACHE_TTL) {
    const { online, total } = cached.data;
    el.textContent = `Tailscale: ${online}/${total} peers online`;
    el.style.color = online > 0 ? 'var(--accent-2)' : 'var(--danger)';
    debugLog('[tailscale] using cached result');
    return;
  }
  try {
    const peers = await apiGet('/tailscale/peers');
    const online = peers.filter(p => p.online).length;
    const data = { online, total: peers.length };
    savePulseToStorage('tailscale', data);
    el.textContent = `Tailscale: ${online}/${peers.length} peers online`;
    el.style.color = online > 0 ? 'var(--accent-2)' : 'var(--danger)';
  } catch {
    el.textContent = 'Tailscale: unknown';
    el.style.color = 'var(--text-dim)';
  }
}

// Refresh status every 30s
setInterval(() => {
  if (document.getElementById('dashboard').classList.contains('active')) {
    loadDockerPulse().catch(() => {});
    loadTailscalePulse().catch(() => {});
  }
}, 30000);

// ─── Utilities ───────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
const loginBtn = document.getElementById('login-btn');
loginBtn.addEventListener('click', login);
loginBtn.addEventListener('touchstart', login, { passive: true });

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);
document.getElementById('login-passphrase').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('login-totp').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

// ─── PWA Install ─────────────────────────────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

function showIOSInstallInstructions() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isInstalled = window.navigator.standalone === true;
  if (isIOS && !isInstalled && !sessionStorage.getItem('ios-install-dismissed')) {
    const div = document.createElement('div');
    div.className = 'ios-install-modal';
    div.innerHTML = `
      <div class="ios-install-content">
        <h3>Install Jericho</h3>
        <p>For the best experience, add this app to your Home Screen:</p>
        <ol>
          <li>Tap the <strong>Share</strong> button in Safari</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
          <li>Tap <strong>Add</strong></li>
        </ol>
        <button id="ios-install-dismiss">Dismiss</button>
      </div>
    `;
    document.body.appendChild(div);
    const dismissBtn = div.querySelector('#ios-install-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        div.remove();
        sessionStorage.setItem('ios-install-dismissed', 'true');
      });
    }
  }
}

// ─── Kimi Sessions ───────────────────────────────────────────────────────────
async function loadKimiSessions() {
  const grid = document.getElementById('kimi-sessions-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading sessions...</div>';
  try {
    const sessions = await apiGet('/kimi/sessions');
    if (!Array.isArray(sessions) || !sessions.length) {
      grid.innerHTML = '<p style="color:var(--text-dim)">No Kimi sessions found.</p>';
      return;
    }
    grid.innerHTML = sessions.map(s => {
      const status = s.status || 'idle';
      const statusClass = status === 'active' ? 'status-active' : 'status-idle';
      const statusText = status === 'active' ? '🟢 Active' : '⚪ Idle';
      const todoBar = s.todo_total > 0
        ? `<div class="todo-bar"><div class="todo-fill" style="width:${(s.todo_done/s.todo_total*100)}%"></div></div><small>${s.todo_done}/${s.todo_total}</small>`
        : '';
      return `
        <div class="card kimi-card" data-uuid="${escapeHtml(s.uuid)}">
          <h3>${escapeHtml(s.title)}</h3>
          <p class="${statusClass}">${statusText} · ${escapeHtml(s.last_active)}</p>
          ${todoBar}
          <div class="kimi-actions">
            <button class="btn-primary kimi-launch" data-uuid="${escapeHtml(s.uuid)}">Open Web UI</button>
            <button class="btn-small kimi-terminal" data-uuid="${escapeHtml(s.uuid)}">Open in Terminal</button>
          </div>
          <div class="kimi-url" id="kimi-url-${escapeHtml(s.uuid)}"></div>
        </div>
      `;
    }).join('');
    grid.querySelectorAll('.kimi-launch').forEach(btn => {
      btn.addEventListener('click', () => launchKimi(btn.dataset.uuid));
    });
    grid.querySelectorAll('.kimi-terminal').forEach(btn => {
      btn.addEventListener('click', () => openKimiInTerminal(btn.dataset.uuid));
    });
  } catch (e) {
    grid.innerHTML = '<p style="color:var(--danger)">Host bridge offline — Kimi sessions unavailable.<br><small>Check <code>host-bridge.py</code> status.</small></p>';
    debugLog('[kimi] load failed: ' + e.message);
  }
}

async function launchKimi(uuid) {
  const btn = document.querySelector(`.kimi-card[data-uuid="${uuid}"] .btn-primary`);
  const urlDiv = document.getElementById(`kimi-url-${uuid}`);
  btn.textContent = 'Launching...';
  try {
    const res = await apiPost(`/kimi/sessions/${uuid}/launch`, {});
    if (res.url) {
      urlDiv.innerHTML = `<a href="${escapeHtml(res.url)}" target="_blank">${escapeHtml(res.url)}</a> <button class="btn-small kimi-stop" data-port="${res.port}" data-uuid="${escapeHtml(uuid)}">Stop</button>`;
      const stopBtn = urlDiv.querySelector('.kimi-stop');
      if (stopBtn) stopBtn.addEventListener('click', () => stopKimi(res.port, uuid));
      btn.textContent = 'Launched';
      btn.disabled = true;
    } else if (res.detail) {
      urlDiv.textContent = 'Launch failed: ' + res.detail;
      btn.textContent = 'Open Web UI';
    } else {
      urlDiv.textContent = 'Launch failed: unknown error';
      btn.textContent = 'Open Web UI';
    }
  } catch (e) {
    urlDiv.textContent = 'Launch failed: ' + e.message;
    btn.textContent = 'Open Web UI';
  }
}

async function openKimiInTerminal(uuid) {
  const tabBtn = document.querySelector('[data-tab="terminal"]');
  if (tabBtn) tabBtn.click();
  setTimeout(() => {
    const shellSelect = document.getElementById('terminal-shell');
    if (shellSelect) shellSelect.value = 'kimi';
    if (window.terminalManager) {
      window.terminalManager.connect({ shell: 'kimi', uuid });
    }
  }, 400);
}

async function stopKimi(port, uuid) {
  try {
    await apiPost(`/kimi/sessions/${port}/stop`, {});
    const btn = document.querySelector(`.kimi-card[data-uuid="${uuid}"] .btn-primary`);
    const urlDiv = document.getElementById(`kimi-url-${uuid}`);
    btn.textContent = 'Open Web UI';
    btn.disabled = false;
    urlDiv.innerHTML = '';
  } catch (e) {
    alert('Stop failed: ' + e.message);
  }
}

// ─── Agent Platforms ─────────────────────────────────────────────────────────
function initPlatformsTab() {
  const tab = document.getElementById('tab-platforms');
  if (!tab) return;
  if (tab.dataset.initialized) return;
  tab.dataset.initialized = 'true';
  loadPlatforms();
}

async function loadPlatforms() {
  const grid = document.getElementById('platforms-grid');
  if (!grid) return;
  grid.innerHTML = '<p style="color:var(--text-dim)">Scanning platforms...</p>';
  try {
    const platforms = await apiGet('/platforms');
    if (!platforms.length) {
      grid.innerHTML = '<p style="color:var(--text-dim)">No platforms detected.</p>';
      return;
    }
    grid.innerHTML = platforms.map(p => {
      const statusClass = p.status === 'online' ? 'status-active' : 'status-error';
      const statusIcon = p.status === 'online' ? '🟢' : '🔴';
      return `
        <div class="card platform-card">
          <div class="platform-header" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:1.5rem;">${p.icon}</span>
            <div>
              <h3 style="margin:0;">${escapeHtml(p.name)}</h3>
              <span class="${statusClass}" style="font-size:0.75rem;">${statusIcon} ${p.status}</span>
            </div>
          </div>
          <p style="color:var(--text-dim);font-size:0.85rem;margin:0 0 12px 0;">${escapeHtml(p.description)}</p>
          <a href="${escapeHtml(p.url)}" target="_blank" class="btn-primary" style="display:inline-block;text-decoration:none;">Open</a>
        </div>
      `;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<p style="color:var(--danger)">Failed to load platforms: ' + escapeHtml(e.message) + '</p>';
  }
}

// ─── Global Error Boundary ───────────────────────────────────────────────────
const _seenErrors = new Set();
window.addEventListener('error', (e) => {
  const key = e.message + ':' + (e.filename || '') + ':' + (e.lineno || 0);
  if (!_seenErrors.has(key)) {
    _seenErrors.add(key);
    debugLog('[error] ' + e.message + ' at ' + (e.filename || '?') + ':' + (e.lineno || 0));
    showToast('Something went wrong. Check debug log for details.', 'error', 4000);
    setTimeout(() => _seenErrors.delete(key), 5000);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason);
  const key = 'unhandled:' + msg;
  if (!_seenErrors.has(key)) {
    _seenErrors.add(key);
    debugLog('[unhandled] ' + msg);
    showToast('Async error: ' + msg, 'error', 4000);
    setTimeout(() => _seenErrors.delete(key), 5000);
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────
loadSavedTheme();
setupThemePanel();
checkSession();
showIOSInstallInstructions();
setupFileBrowserScroll();
// Defer tab content load to allow CSS reflow and container warm-up
setTimeout(() => {
  const activePanel = document.querySelector('.tab-panel.active');
  if (activePanel) ensureTabScripts(activePanel.id);
}, 200);

// ─── Marketing Asset Capture Helpers ─────────────────────────────────────────
// Auto-activated by URL hash for screenshot/GIF generation. No-op for normal use.
(function() {
  const hash = location.hash.slice(1);
  if (!hash) return;
  const map = {
    'desktop': () => setTimeout(() => toggleDesktopMode(true), 1200),
    'tab-terminal': () => setTimeout(() => document.querySelector('.nav-tab[data-tab="terminal"]')?.click(), 800),
    'tab-system': () => setTimeout(() => document.querySelector('.nav-tab[data-tab="system"]')?.click(), 800),
    'tab-notes': () => setTimeout(() => document.querySelector('.nav-tab[data-tab="notes"]')?.click(), 800),
    'sudo': () => setTimeout(() => { const m = document.getElementById('sudo-modal'); if(m) { m.style.display='flex'; m.style.alignItems='center'; m.style.justifyContent='center'; } }, 800),
  };
  if (map[hash]) map[hash]();
})();
// Theme hash helpers for asset capture
(function() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('theme-')) {
    const themeId = hash.replace('theme-', '');
    setTimeout(() => {
      const t = PRESET_THEMES.find(x => x.id === themeId);
      if (t) setTheme(t);
    }, 1000);
  }
})();
// GIF keyframe helpers
(function() {
  const hash = location.hash.slice(1);
  if (hash === 'wm-drag') {
    setTimeout(() => {
      const win = document.querySelector('.app-window');
      if (win) { win.style.transform = 'translate3d(200px, 100px, 0)'; win.dataset.posX='200'; win.dataset.posY='100'; }
    }, 1500);
  }
  if (hash === 'wm-minimize') {
    setTimeout(() => {
      const win = document.querySelector('.app-window');
      if (win) { win.classList.add('minimized'); }
    }, 1500);
  }
  if (hash === 'wm-maximize') {
    setTimeout(() => {
      const win = document.querySelector('.app-window');
      if (win) { win.classList.add('maximized'); }
    }, 1500);
  }
  if (hash === 'wm-close') {
    setTimeout(() => {
      const win = document.querySelector('.app-window');
      if (win) { win.style.display = 'none'; }
    }, 1500);
  }
  if (hash === 'terminal-connected') {
    setTimeout(() => {
      const status = document.getElementById('terminal-status');
      if (status) status.textContent = 'Connected';
      const btn = document.getElementById('terminal-connect');
      if (btn) btn.textContent = 'Disconnect';
      const container = document.getElementById('terminal-container');
      if (container) container.innerHTML = '<div style="padding:12px;font-family:monospace;font-size:13px;color:#0f0;background:#0a0f0d;line-height:1.5;"><div style="color:#888;">$ docker ps</div><div>CONTAINER ID  IMAGE   STATUS   PORTS</div><div style="color:#fff;">a1b2c3d4e5f6  nginx   Up 2h    80/tcp</div><div style="color:#fff;">g7h8i9j0k1l2  redis   Up 5h    6379/tcp</div><div style="margin-top:8px;color:#0ff;">$ _</div></div>';
    }, 1500);
  }
})();
