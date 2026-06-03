(function() {
  'use strict';

  window.loadPulseFromStorage = function(key) {
    try {
      const raw = sessionStorage.getItem('pulse_' + key);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  };

  window.savePulseToStorage = function(key, data) {
    try {
      sessionStorage.setItem('pulse_' + key, JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  };

  window.loadDockerPulse = async function() {
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
  };

  window.loadTailscalePulse = async function() {
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
  };

  window.loadKimiSessions = async function() {
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
  };

  window.launchKimi = async function(uuid) {
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
  };

  window.stopKimi = async function(port, uuid) {
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
  };

  window.initPlatformsTab = function() {
    const tab = document.getElementById('tab-platforms');
    if (!tab) return;
    if (tab.dataset.initialized) return;
    tab.dataset.initialized = 'true';
    loadPlatforms();
  };

  window.loadPlatforms = async function() {
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
  };

  window.loadServicesLocal = async function() {
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
  };

  window.loadServicesPublic = async function() {
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
  };

  window.loadNotesList = async function() {
    const ul = document.getElementById('notes-files');
    try {
      const notes = await apiGet('/notes');
      ul.innerHTML = notes.map(n => `
        <li data-name="${escapeHtml(n.name)}">
          ${escapeHtml(n.name)}
        </li>
      `).join('');
      ul.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => openNote(li.dataset.name));
      });
    } catch {
      ul.innerHTML = '<li>Failed to load</li>';
    }
  };

  window.openNote = async function(name) {
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
  };

  window.saveNote = async function() {
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
  };

  window.ensureTabScripts = function(tabId) {
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
  };

  window.bridgeInitToWindow = function(tabId) {
    const tab = document.getElementById(tabId);
    const win = document.querySelector('.app-window[data-tab="' + tabId.replace('tab-', '') + '"]');
    const winContent = win ? win.querySelector('.window-content') : null;
    if (tab && winContent) {
      while (winContent.firstChild) {
        tab.appendChild(winContent.firstChild);
      }
      TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
      while (tab.firstChild) {
        winContent.appendChild(tab.firstChild);
      }
    } else {
      TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
    }
  };

  window.initTabListeners = function() {
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
  };

  window.initServiceTabs = function() {
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
  };

  window.initNotesListeners = function() {
    const newNoteBtn = document.getElementById('new-note-btn');
    if (newNoteBtn) newNoteBtn.addEventListener('click', () => {
      currentNote = null;
      document.getElementById('note-name').value = '';
      document.getElementById('note-content').value = '';
      document.getElementById('note-status').textContent = '';
    });
    const saveNoteBtn = document.getElementById('save-note');
    if (saveNoteBtn) saveNoteBtn.addEventListener('click', saveNote);
  };

  window.initCodeListener = function() {
    const loadCodeBtn = document.getElementById('load-code');
    if (loadCodeBtn) loadCodeBtn.addEventListener('click', () => {
      document.getElementById('dex-warning').style.display = 'none';
      document.getElementById('code-frame').style.display = 'block';
      document.getElementById('code-frame').src = 'code/';
    });
  };

  window.initCaptureListener = function() {
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
  };
})();
