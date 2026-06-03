(function() {
  'use strict';

  window.isSudoActive = function() {
    return sudoTicket && Date.now() < sudoExpiry;
  };

  window.clearSudo = function() {
    sudoTicket = null;
    sudoExpiry = null;
    clearInterval(sudoTimer);
    sudoTimer = null;
    updateSudoUI();
  };

  window.updateSudoUI = function() {
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
  };

  // Shield button opens terminal instead of dashboard
  const sudoToggleBtn = document.getElementById('sudo-toggle');
  if (sudoToggleBtn) {
    sudoToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Switch to terminal tab
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const terminalTab = document.querySelector('.nav-tab[data-tab="terminal"]');
      const terminalPanel = document.getElementById('tab-terminal');
      if (terminalTab) terminalTab.classList.add('active');
      if (terminalPanel) terminalPanel.classList.add('active');
      ensureTabScripts('tab-terminal');
      closeNavOverlay();
    });
  }

  window.debugLog = function(msg) {
    const line = new Date().toLocaleTimeString() + ' ' + msg;
    debugLines.push(line);
    if (debugLines.length > 50) debugLines.shift();
    const el = document.getElementById('debug-panel');
    if (el) el.textContent = debugLines.join('\n');
    console.log(msg);
  };

  window.debugShow = function() {
    const panel = document.getElementById('debug-wrap');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  window.showToast = function(message, type = 'info', duration = 3000) {
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
  };

  window.updateCapabilityBadge = function(tier) {
    const badge = document.getElementById('capability-badge');
    badge.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
    badge.className = 'cap-badge ' + tier;
  };

  window.escapeHtml = function(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
  };

  window.formatBytes = function(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  window.renderChangelog = function() {
    const container = document.getElementById('nav-changelog');
    if (!container) return;
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
  };

  window.toggleChangelog = function() {
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
  };

  window.toggleNavOverlay = function() {
    const overlay = document.getElementById('nav-overlay');
    const btn = document.getElementById('nav-menu-btn');
    if (!overlay || !btn) return;
    const isOpen = overlay.classList.contains('open');
    if (isOpen) closeNavOverlay();
    else openNavOverlay();
  };

  window.openNavOverlay = function() {
    const overlay = document.getElementById('nav-overlay');
    const btn = document.getElementById('nav-menu-btn');
    if (!overlay || !btn) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
  };

  window.closeNavOverlay = function() {
    const overlay = document.getElementById('nav-overlay');
    const btn = document.getElementById('nav-menu-btn');
    if (!overlay || !btn) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
  };

  window.toggleFullscreen = function() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        history.pushState({ fullscreen: true }, '');
      }).catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };

  window.updateFsButton = function() {
    const btn = document.getElementById('fs-toggle');
    if (!btn) return;
    btn.textContent = document.fullscreenElement ? '🗗' : '⛶';
  };

  window.getDesktopMode = function() {
    try {
      const stored = localStorage.getItem(DESKTOP_MODE_KEY);
      if (stored !== null) return stored === 'true';
    } catch {}
    return true;
  };

  window.setDesktopMode = function(enabled) {
    try {
      localStorage.setItem(DESKTOP_MODE_KEY, String(enabled));
    } catch {}
    applyDesktopMode(enabled);
  };

  window.applyDesktopMode = function(enabled) {
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
  };

  // ─── Desktop Window Manager ──────────────────────────────────────────────────
  window.bringToFront = function(winEl) {
    _windowZ += 1;
    winEl.style.zIndex = _windowZ;
    document.querySelectorAll('.app-window').forEach(w => {
      w.classList.remove('active');
      w.classList.add('inactive');
    });
    winEl.classList.remove('inactive');
    winEl.classList.add('active');
    syncSidebarDock();
  };

  window.makeDraggable = function(winEl, titlebar) {
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
  };

  window.syncTaskbar = function() {
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
  };

  window.createSidebarDock = function() {
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
  };

  window.syncSidebarDock = function() {
    document.querySelectorAll('.sidebar-dock__item').forEach(item => {
      const tabId = item.dataset.dockTab;
      const win = document.querySelector(`.app-window[data-tab="${tabId}"]`);
      item.classList.toggle('active', win && win.classList.contains('active') && !win.classList.contains('minimized') && win.style.display !== 'none');
    });
  };

  window.initDesktopMode = function() {
    const main = document.querySelector('.main-content');
    if (!main) return;
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

    document.querySelectorAll('.app-window').forEach(win => {
      const tabId = win.dataset.tab;
      if (tabId) ensureTabScripts('tab-' + tabId);
    });
  };

  window.destroyDesktopMode = function() {
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
  };

  window.toggleDesktopMode = function(enabled) {
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
      const firstWin = document.querySelector('.app-window');
      if (firstWin) bringToFront(firstWin);
    } else {
      if (main) main.classList.remove('desktop-mode');
      if (desktopBg) desktopBg.style.display = 'none';
      if (taskbar) taskbar.classList.remove('open');
      const dock = document.getElementById('sidebar-dock');
      if (dock) dock.remove();
      destroyDesktopMode();
      const defaultTab = document.querySelector('.nav-tab.active');
      if (defaultTab) {
        const tab = defaultTab.dataset.tab;
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById('tab-' + tab);
        if (panel) panel.classList.add('active');
      }
    }
  };

  window.initDesktopListeners = function() {
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

    document.addEventListener('click', (e) => {
      const win = e.target.closest('.app-window');
      if (win) bringToFront(win);
    });

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
  };

  window.initNavOverlay = function() {
    const menuBtn = document.getElementById('nav-menu-btn');
    const closeBtn = document.querySelector('.nav-overlay-close');
    const versionBtn = document.getElementById('nav-version-toggle');
    const fsBtn = document.getElementById('fs-toggle');
    const desktopCheck = document.getElementById('desktop-mode-check');
    const windowCheck = document.getElementById('window-mode-check');
    if (menuBtn) menuBtn.addEventListener('click', toggleNavOverlay);
    if (closeBtn) closeBtn.addEventListener('click', closeNavOverlay);
    if (versionBtn) versionBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleChangelog(); });
    if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
    if (desktopCheck) {
      desktopCheck.addEventListener('change', (e) => setDesktopMode(e.target.checked));
    }
    if (windowCheck) {
      windowCheck.addEventListener('change', (e) => toggleDesktopMode(e.target.checked));
    }
    const debugClose = document.getElementById('debug-close');
    const debugToggle = document.getElementById('debug-toggle');
    const previewClose = document.getElementById('preview-close');
    if (debugClose) debugClose.addEventListener('click', debugShow);
    if (debugToggle) debugToggle.addEventListener('click', debugShow);
    if (previewClose) previewClose.addEventListener('click', closePreview);
    renderChangelog();
    applyDesktopMode(getDesktopMode());
  };

  window.handleOutsideTap = function(e) {
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
  };
})();
