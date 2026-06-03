(function() {
  'use strict';

  // Global listeners
  window.addEventListener('resize', () => { applyDesktopMode(getDesktopMode()); });
  window.addEventListener('fullscreenchange', updateFsButton);
  window.addEventListener('popstate', (e) => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      history.pushState({ fullscreen: true }, '');
    }
  });
  document.addEventListener('click', handleOutsideTap);
  document.addEventListener('touchstart', handleOutsideTap, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNavOverlay(); });

  // Module init listeners
  initDesktopListeners();
  initTabListeners();
  initNavOverlay();
  initFileBrowserListeners();
  initServiceTabs();
  initCodeListener();
  initNotesListeners();
  initCaptureListener();
  initAuthListeners();
  initPWA();

  // Global error boundary
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

  // Page init sequence
  loadSavedTheme();
  setupThemePanel();
  checkSession();
  showIOSInstallInstructions();
  setupFileBrowserScroll();
  setTimeout(() => {
    const activePanel = document.querySelector('.tab-panel.active');
    if (activePanel) ensureTabScripts(activePanel.id);
  }, 200);

  // Status bar refresh
  setInterval(() => {
    const dashboard = document.getElementById('dashboard');
    if (dashboard && dashboard.classList.contains('active')) {
      loadDockerPulse().catch(() => {});
      loadTailscalePulse().catch(() => {});
    }
  }, 30000);

  // ─── Marketing Asset Capture Helpers ─────────────────────────────────────────
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

  (function() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('theme-')) {
      const themeId = hash.replace('theme-', '');
      setTimeout(() => {
        const t = MINIMAL_THEMES.find(x => x.id === themeId);
        if (t) setTheme(t);
      }, 1000);
    }
  })();

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
})();
