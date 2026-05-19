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

// ─── Theme Engine ────────────────────────────────────────────────────────────
const PRESET_THEMES = [
  {
    id: 'matrix', name: 'Matrix Terminal', description: 'Green phosphor on black CRT',
    category: 'preset',
    tokens: {
      bg: '#000000', surface: '#0d0208', 'surface-2': '#001100',
      accent: '#2d8a5e', 'accent-2': '#4db87a', text: '#e8f0ec',
      'text-dim': '#8fa89a', danger: '#ff3333', warn: '#ffaa00',
      border: '#1f3329', radius: '2px', shadow: '0 0 10px rgba(0,255,65,0.08)'
    },
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    effects: { textShadow: '0 0 5px rgba(0,255,65,0.3)', scanlineOpacity: '0.4', glowIntensity: '0.3' }
  },
  {
    id: 'cyberpunk', name: 'Cyberpunk', description: 'Neon amber and purple on dark slate',
    category: 'preset',
    tokens: {
      bg: '#0a0a12', surface: '#12121f', 'surface-2': '#1a1a2e',
      accent: '#ff9500', 'accent-2': '#b967ff', text: '#e8e8f0',
      'text-dim': '#a0a0b0', danger: '#ff3366', warn: '#ffaa00',
      border: '#2a2a40', radius: '4px', shadow: '0 0 12px rgba(255,149,0,0.15)'
    },
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    effects: { textShadow: '0 0 6px rgba(255,149,0,0.25)', scanlineOpacity: '0.25', glowIntensity: '0.4' }
  },
  {
    id: 'ocean', name: 'Ocean', description: 'Deep sea blues and teals',
    category: 'preset',
    tokens: {
      bg: '#020617', surface: '#0f172a', 'surface-2': '#1e293b',
      accent: '#00d4aa', 'accent-2': '#0891b2', text: '#e0f2fe',
      'text-dim': '#7dd3fc', danger: '#f87171', warn: '#fbbf24',
      border: '#134e4a', radius: '6px', shadow: '0 0 12px rgba(0,212,170,0.1)'
    },
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    effects: { textShadow: 'none', scanlineOpacity: '0', glowIntensity: '0' }
  },
  {
    id: 'solarized', name: 'Solarized', description: 'Classic developer color scheme',
    category: 'preset',
    tokens: {
      bg: '#002b36', surface: '#073642', 'surface-2': '#586e75',
      accent: '#268bd2', 'accent-2': '#2aa198', text: '#93a1a1',
      'text-dim': '#586e75', danger: '#dc322f', warn: '#b58900',
      border: '#073642', radius: '3px', shadow: '0 2px 8px rgba(0,0,0,0.3)'
    },
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
    effects: { textShadow: 'none', scanlineOpacity: '0', glowIntensity: '0' }
  },
  {
    id: 'midnight', name: 'Midnight', description: 'Clean dark with soft blue accents',
    category: 'preset',
    tokens: {
      bg: '#0f172a', surface: '#1e293b', 'surface-2': '#334155',
      accent: '#60a5fa', 'accent-2': '#3b82f6', text: '#f1f5f9',
      'text-dim': '#cbd5e1', danger: '#ef4444', warn: '#f59e0b',
      border: '#1e293b', radius: '8px', shadow: '0 4px 16px rgba(0,0,0,0.4)'
    },
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    effects: { textShadow: 'none', scanlineOpacity: '0', glowIntensity: '0' }
  },
  {
    id: 'amber', name: 'Amber Mono', description: 'Vintage amber phosphor terminal',
    category: 'preset',
    tokens: {
      bg: '#1a0f00', surface: '#2a1a00', 'surface-2': '#3d2600',
      accent: '#ffb000', 'accent-2': '#cc8800', text: '#ffd4a3',
      'text-dim': '#b8956a', danger: '#ff4444', warn: '#ffcc00',
      border: '#4d3300', radius: '0px', shadow: '0 0 8px rgba(255,176,0,0.1)'
    },
    fontFamily: "'Courier New', 'Courier', monospace",
    effects: { textShadow: '0 0 4px rgba(255,176,0,0.3)', scanlineOpacity: '0.35', glowIntensity: '0.3' }
  }
];

let _customThemes = [];
let _candidateTheme = null;

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
  if (!id) return PRESET_THEMES[0];
  const preset = PRESET_THEMES.find(t => t.id === id);
  if (preset) return preset;
  const custom = _customThemes.find(t => t.id === id);
  if (custom) return custom;
  return PRESET_THEMES[0];
}

function loadSavedTheme() {
  try {
    const theme = getSavedTheme();
    setTheme(theme);
  } catch (e) {
    console.error('Failed to load saved theme:', e);
  }
}

async function loadCustomThemes() {
  try {
    const data = await apiGet(API_BASE + '/themes');
    if (Array.isArray(data)) _customThemes = data;
  } catch (e) {
    _customThemes = [];
  }
  renderThemeLists();
}

function renderSwatches(tokens) {
  const colors = [tokens.accent, tokens.bg, tokens.surface, tokens.text];
  return colors.map(c => `<div class="theme-swatch" style="background:${c}"></div>`).join('');
}

function renderThemeLists() {
  const presetGrid = document.getElementById('theme-presets');
  const customGrid = document.getElementById('theme-custom');
  const savedId = localStorage.getItem('jericho_theme_id') || 'matrix';
  if (presetGrid) {
    presetGrid.innerHTML = PRESET_THEMES.map(t => `
      <div class="theme-card ${t.id === savedId ? 'active' : ''}" data-theme-id="${t.id}" data-category="preset">
        <div class="theme-card-name">${escapeHtml(t.name)}</div>
        <div class="theme-swatches">${renderSwatches(t.tokens)}</div>
      </div>
    `).join('');
  }
  if (customGrid) {
    if (_customThemes.length === 0) {
      customGrid.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px;">No custom themes yet. Use the AI generator below.</div>';
    } else {
      customGrid.innerHTML = _customThemes.map(t => `
        <div class="theme-card ${t.id === savedId ? 'active' : ''}" data-theme-id="${t.id}" data-category="custom">
          <div class="theme-card-name">${escapeHtml(t.name)}</div>
          <div class="theme-swatches">${renderSwatches(t.tokens)}</div>
        </div>
      `).join('');
    }
  }
}

function renderThemePreview(theme) {
  const wrap = document.getElementById('theme-preview-mini');
  if (!wrap) return;
  const t = theme.tokens;
  wrap.innerHTML = `
    <div class="tp-topbar" style="background:${t.surface};border-color:${t.border};">
      <span class="tp-logo" style="color:${t.accent};">⬡ Jericho</span>
      <span class="tp-badge" style="background:${t.accent};color:#000;">b20</span>
    </div>
    <div class="tp-cards">
      <div class="tp-card" style="background:${t.surface};border-color:${t.border};">
        <h4 style="color:${t.text};">System</h4>
        <p style="color:${t['text-dim']};">CPU: 12% · RAM: 4.2G</p>
      </div>
      <div class="tp-card" style="background:${t.surface};border-color:${t.border};">
        <h4 style="color:${t.text};">Docker</h4>
        <p style="color:${t['text-dim']};">8 containers running</p>
      </div>
    </div>
    <div class="tp-bar" style="background:${t.surface};border-color:${t.border};">
      <span class="tp-dot" style="background:${t.accent};"></span>
      <span style="color:${t['text-dim']};">Online · 100.114.140.23</span>
    </div>
  `;
  wrap.style.background = t.bg;
  wrap.style.borderColor = t.border;
}

async function generateThemeFromPrompt(prompt) {
  const statusEl = document.getElementById('theme-gen-status');
  statusEl.textContent = 'Generating theme via AI...';
  try {
    const schemaDesc = JSON.stringify({
      id: 'string', name: 'string', description: 'string', category: 'ai-generated',
      tokens: { bg:'#000', surface:'#111', 'surface-2':'#222', accent:'#0f0', 'accent-2':'#0a0', text:'#0f0', 'text-dim':'#080', danger:'#f00', warn:'#fa0', border:'#333', radius:'4px', shadow:'none' },
      fontFamily: "'JetBrains Mono', monospace",
      effects: { textShadow:'none', scanlineOpacity:'0', glowIntensity:'0' }
    });
    const fewShot = `Example 1: {"id":"sunset","name":"Sunset","description":"Warm oranges and purples","category":"ai-generated","tokens":{"bg":"#1a0a1a","surface":"#2d1b2d","surface-2":"#3d2b3d","accent":"#ff6b35","accent-2":"#9b59b6","text":"#ffd4a3","text-dim":"#c08497","danger":"#e74c3c","warn":"#f39c12","border":"#4a304a","radius":"6px","shadow":"0 0 10px rgba(255,107,53,0.1)"},"fontFamily":"'Inter', sans-serif","effects":{"textShadow":"none","scanlineOpacity":"0","glowIntensity":"0"}}`;
    const ollamaBody = {
      model: 'llama3.2',
      prompt: `You are a UI theme designer. Given a user description, output ONLY valid JSON matching this schema:\n${schemaDesc}\n\n${fewShot}\n\nUser description: "${prompt.replace(/"/g, '\\"')}"\n\nRespond with JSON only. No markdown, no explanation.`,
      stream: false,
      format: 'json'
    };
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ollamaBody)
    });
    if (!res.ok) throw new Error('Ollama returned ' + res.status);
    const data = await res.json();
    const raw = data.response || data.message?.content || '{}';
    const parsed = JSON.parse(raw);
    if (!parsed.id) parsed.id = 'ai-' + Date.now();
    if (!parsed.category) parsed.category = 'ai-generated';
    return parsed;
  } catch (e) {
    statusEl.textContent = 'AI failed, using rule-based fallback: ' + e.message;
    return ruleBasedTheme(prompt);
  }
}

function ruleBasedTheme(prompt) {
  const p = prompt.toLowerCase();
  const has = (words) => words.some(w => p.includes(w));
  const id = 'custom-' + Date.now();
  if (has(['light', 'white', 'day', 'bright'])) {
    return {
      id, name: 'Custom Light', description: prompt, category: 'custom',
      tokens: { bg:'#f8fafc', surface:'#ffffff', 'surface-2':'#e2e8f0', accent:'#2563eb', 'accent-2':'#1d4ed8', text:'#0f172a', 'text-dim':'#64748b', danger:'#dc2626', warn:'#d97706', border:'#cbd5e1', radius:'8px', shadow:'0 2px 8px rgba(0,0,0,0.08)' },
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif", effects: { textShadow:'none', scanlineOpacity:'0', glowIntensity:'0' }
    };
  }
  if (has(['red', 'crimson', 'blood', 'ruby'])) {
    return {
      id, name: 'Custom Red', description: prompt, category: 'custom',
      tokens: { bg:'#0a0000', surface:'#1a0505', 'surface-2':'#2a0a0a', accent:'#ff3333', 'accent-2':'#cc0000', text:'#ff9999', 'text-dim':'#aa4444', danger:'#ff0000', warn:'#ffaa00', border:'#440000', radius:'4px', shadow:'0 0 10px rgba(255,51,51,0.15)' },
      fontFamily: "'JetBrains Mono', monospace", effects: { textShadow:'0 0 5px rgba(255,51,51,0.3)', scanlineOpacity:'0.3', glowIntensity:'0.3' }
    };
  }
  if (has(['purple', 'violet', 'lavender', 'magenta'])) {
    return {
      id, name: 'Custom Purple', description: prompt, category: 'custom',
      tokens: { bg:'#0f0518', surface:'#1a0f2e', 'surface-2':'#2a1a40', accent:'#a855f7', 'accent-2':'#7c3aed', text:'#e9d5ff', 'text-dim':'#a78bfa', danger:'#f43f5e', warn:'#fbbf24', border:'#3a1f55', radius:'6px', shadow:'0 0 10px rgba(168,85,247,0.1)' },
      fontFamily: "'Inter', sans-serif", effects: { textShadow:'0 0 5px rgba(168,85,247,0.2)', scanlineOpacity:'0.15', glowIntensity:'0.2' }
    };
  }
  return {
    id, name: 'Custom Theme', description: prompt, category: 'custom',
    tokens: { bg:'#0a0a0a', surface:'#141414', 'surface-2':'#1e1e1e', accent:'#00d4ff', 'accent-2':'#0891b2', text:'#e0f2fe', 'text-dim':'#7dd3fc', danger:'#f87171', warn:'#fbbf24', border:'#262626', radius:'4px', shadow:'0 0 10px rgba(0,212,255,0.1)' },
    fontFamily: "'JetBrains Mono', monospace", effects: { textShadow:'none', scanlineOpacity:'0', glowIntensity:'0' }
  };
}

async function saveThemeToBackend(theme) {
  try {
    await apiPost(API_BASE + '/themes', {
      id: theme.id, name: theme.name, description: theme.description,
      category: theme.category, tokens: JSON.stringify(theme.tokens),
      fontFamily: theme.fontFamily, effects: JSON.stringify(theme.effects)
    });
  } catch (e) {
    console.error('Failed to save theme to backend:', e);
  }
}

function setupThemePanel() {
  const navOverlay = document.getElementById('nav-overlay');
  const themeOverlay = document.getElementById('theme-overlay');
  const themeBtn = document.getElementById('nav-theme-btn');
  const themeClose = document.getElementById('theme-overlay-close');
  const genBtn = document.getElementById('theme-gen-btn');
  const genInput = document.getElementById('theme-gen-input');
  const previewWrap = document.getElementById('theme-preview-wrap');
  const tweakArea = document.getElementById('theme-tweak-area');
  const tweakBtn = document.getElementById('theme-tweak-btn');
  const discardBtn = document.getElementById('theme-discard-btn');
  const applyBtn = document.getElementById('theme-apply-btn');
  const tweakJson = document.getElementById('theme-tweak-json');
  const statusEl = document.getElementById('theme-gen-status');

  if (!themeBtn || !themeOverlay) return;

  themeBtn.addEventListener('click', () => {
    navOverlay.classList.remove('open');
    navOverlay.setAttribute('aria-hidden', 'true');
    themeOverlay.classList.add('open');
    themeOverlay.setAttribute('aria-hidden', 'false');
    loadCustomThemes();
  });

  themeClose.addEventListener('click', () => {
    themeOverlay.classList.remove('open');
    themeOverlay.setAttribute('aria-hidden', 'true');
  });

  themeOverlay.addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    const id = card.dataset.themeId;
    const category = card.dataset.category;
    let theme;
    if (category === 'preset') theme = PRESET_THEMES.find(t => t.id === id);
    else theme = _customThemes.find(t => t.id === id);
    if (theme) {
      setTheme(theme);
      renderThemeLists();
      statusEl.textContent = 'Applied: ' + theme.name;
    }
  });

  genBtn.addEventListener('click', async () => {
    const prompt = genInput.value.trim();
    if (!prompt) return;
    previewWrap.style.display = 'none';
    tweakArea.classList.remove('open');
    const theme = await generateThemeFromPrompt(prompt);
    _candidateTheme = theme;
    renderThemePreview(theme);
    previewWrap.style.display = 'block';
    statusEl.textContent = 'Preview: ' + theme.name;
  });

  tweakBtn.addEventListener('click', () => {
    if (!_candidateTheme) return;
    tweakJson.value = JSON.stringify(_candidateTheme, null, 2);
    tweakArea.classList.toggle('open');
  });

  discardBtn.addEventListener('click', () => {
    _candidateTheme = null;
    previewWrap.style.display = 'none';
    tweakArea.classList.remove('open');
    statusEl.textContent = '';
  });

  applyBtn.addEventListener('click', async () => {
    if (!_candidateTheme) return;
    if (tweakArea.classList.contains('open')) {
      try {
        _candidateTheme = JSON.parse(tweakJson.value);
      } catch (e) {
        statusEl.textContent = 'Invalid JSON: ' + e.message;
        return;
      }
    }
    setTheme(_candidateTheme);
    if (_candidateTheme.category !== 'preset') {
      await saveThemeToBackend(_candidateTheme);
      await loadCustomThemes();
    }
    previewWrap.style.display = 'none';
    tweakArea.classList.remove('open');
    statusEl.textContent = 'Applied and saved: ' + _candidateTheme.name;
    _candidateTheme = null;
  });

  document.addEventListener('click', (e) => {
    if (themeOverlay.classList.contains('open') && !themeOverlay.contains(e.target) && e.target !== themeBtn && !themeBtn.contains(e.target)) {
      themeOverlay.classList.remove('open');
      themeOverlay.setAttribute('aria-hidden', 'true');
    }
  });
}

// ─── Lazy Tab Script Loading ─────────────────────────────────────────────────
const TAB_SCRIPTS = {
  'tab-system': ['https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js', 'static/js/system.js?v=20'],
  'tab-agents': ['static/js/agents.js?v=20'],
  'tab-terminal': ['static/js/agent-state.js?v=20', 'static/js/terminal.js?v=20', 'static/js/command-assistant.js?v=20'],
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
    TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
    return;
  }
  scripts._loaded = true;
  let pending = scripts.length;
  if (!pending) {
    TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
    return;
  }
  scripts.forEach(src => {
    const fullSrc = src.startsWith('http') ? src : (PREFIX ? PREFIX + '/' + src : src);
    if (document.querySelector('script[src="' + fullSrc + '"]')) {
      if (--pending === 0) TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId]();
      return;
    }
    const s = document.createElement('script');
    s.src = fullSrc;
    s.onload = () => { if (--pending === 0) TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId](); };
    s.onerror = () => { debugLog('[lazy] failed to load ' + fullSrc); if (--pending === 0) TAB_INIT_FNS[tabId] && TAB_INIT_FNS[tabId](); };
    document.head.appendChild(s);
  });
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
  // Prototype bypass: always send bypass token
  headers['Authorization'] = 'Bearer prototype-bypass';
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
    showToast('Server error. Please retry.', 'error', 4000);
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok) {
    showToast(`Request failed (${res.status})`, 'error', 4000);
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

async function apiGet(url) {
  debugLog('[fetch] GET ' + API_BASE + url);
  const res = await fetch(API_BASE + url, {
    credentials: 'same-origin',
    headers: getAuthHeaders(),
  });
  await handleResponse(res, () => apiGet(url));
  return res.json();
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
  await handleResponse(res, () => apiPost(url, body));
  return res.json();
}

async function apiPostForm(url, formData) {
  const headers = { 'Authorization': 'Bearer prototype-bypass' };
  debugLog('[fetch] POST(form) ' + API_BASE + url);
  const res = await fetch(API_BASE + url, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: formData,
  });
  await handleResponse(res, () => apiPostForm(url, formData));
  return res.json();
}

async function tryRefresh() {
  try {
    debugLog('[refresh] trying cookie refresh...');
    const res = await fetch('api/auth/refresh', {
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
  // AUTH BYPASSED FOR PROTOTYPE — loads dashboard directly
  debugLog('[checkSession] auth bypassed, loading dashboard');
  accessToken = 'prototype-bypass';
  capabilities = {
    terminal: true, agent_control: true, file_browser: true,
    push_notifications: false, offline_queue: false,
    biometric_unlock: false, team_sharing: false, audit_logs: false
  };
  updateCapabilityBadge('free');
  showDashboard();
}

async function login() {
  // AUTH BYPASSED FOR PROTOTYPE
  debugLog('[login] auth bypassed, loading dashboard');
  showDashboard();
}

function devBypass() {
  debugLog('[devBypass] triggered');
  accessToken = 'dev-bypass';
  capabilities = {
    terminal: true, agent_control: true, file_browser: true,
    push_notifications: false, offline_queue: false,
    biometric_unlock: false, team_sharing: false, audit_logs: false
  };
  updateCapabilityBadge('free');
  showDashboard();
}

async function logout() {
  try {
    await fetch('api/auth/logout', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'same-origin',
    });
  } catch {}
  accessToken = null;
  sessionStorage.removeItem('access_token');
  showGatekeeper();
  if (sessionCheckInterval) clearInterval(sessionCheckInterval);
  if (window.terminalManager) window.terminalManager.disconnect();
}

function showGatekeeper() {
  const g = document.getElementById('gatekeeper');
  const d = document.getElementById('dashboard');
  if (g) g.classList.add('active');
  if (d) d.classList.remove('active');
}

function showDashboard() {
  try {
    debugLog('[showDashboard] switching to dashboard');
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) {
      debugLog('[showDashboard] CRITICAL: missing dashboard element');
      return;
    }
    const gatekeeper = document.getElementById('gatekeeper');
    if (gatekeeper) gatekeeper.classList.remove('active');
    dashboard.classList.add('active');
    closeNavOverlay();
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
  if (fbRefresh) fbRefresh.addEventListener('click', loadProjects);
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

// Close overlay on outside click
document.addEventListener('click', (e) => {
  const overlay = document.getElementById('nav-overlay');
  const btn = document.getElementById('nav-menu-btn');
  if (!overlay || !overlay.classList.contains('open')) return;
  if (!overlay.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    closeNavOverlay();
  }
});

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
    loadProjects();
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

async function loadProjects() {
  await loadFileBrowser(currentBrowsePath);
}

async function loadFileBrowser(path, attempt = 1, silent = false) {
  const grid = document.getElementById('projects-grid');
  const pathEl = document.getElementById('fb-path');
  const parentBtn = document.getElementById('fb-parent');
  if (!grid) { debugLog('[filebrowser] grid element not found'); return; }
  if (!silent) {
    const dots = '.'.repeat(attempt);
    grid.innerHTML = '<p id="fb-loading" style="color:var(--text-dim);padding:20px;text-align:center;"><span class="spinner">⟳</span> Loading files' + dots + '</p>';
  }
  try {
    debugLog('[filebrowser] fetching ' + path + ' (attempt ' + attempt + ')');
    const controller = new AbortController();
    const timeoutMs = attempt === 1 ? 30000 : 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(API_BASE + '/projects?path=' + encodeURIComponent(path), {
      credentials: 'same-origin',
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    debugLog('[filebrowser] status ' + res.status);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    currentBrowsePath = data.path;
    if (pathEl) pathEl.textContent = data.path;
    if (parentBtn) parentBtn.style.display = data.parent ? 'inline-block' : 'none';
    debugLog('[filebrowser] received ' + (data.entries ? data.entries.length : 0) + ' entries');
    if (!data.entries || !data.entries.length) {
      grid.innerHTML = '<p style="color:var(--text-dim);padding:20px;text-align:center;">Empty directory</p>';
      return;
    }
    grid.innerHTML = data.entries.map(e => {
      if (e.type === 'directory') {
        return `
          <div class="card fb-dir" data-navigate="${escapeHtml(e.path)}" style="min-height:80px;display:flex;flex-direction:column;justify-content:center;cursor:pointer;">
            <div style="font-size:1.5rem;margin-bottom:4px;">📁</div>
            <div style="font-weight:600;font-size:0.95rem;word-break:break-word;">${escapeHtml(e.name)}</div>
            <div style="color:var(--text-dim);font-size:0.75rem;">folder</div>
          </div>
        `;
      } else {
        const size = formatBytes(e.size || 0);
        return `
          <div class="card fb-file" style="cursor:default;min-height:80px;display:flex;flex-direction:column;justify-content:center;">
            <div style="font-size:1.5rem;margin-bottom:4px;">📄</div>
            <div style="font-weight:600;font-size:0.95rem;word-break:break-word;">${escapeHtml(e.name)}</div>
            <div style="color:var(--text-dim);font-size:0.75rem;">${size}</div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <button class="btn-small fb-preview" data-preview="${encodeURIComponent(e.path)}">👁 Preview</button>
              <a href="/api/web/download?path=${encodeURIComponent(e.path)}" target="_blank" class="btn-small" style="text-decoration:none;">⬇ Download</a>
            </div>
          </div>
        `;
      }
    }).join('');
    _fbLastEntriesHash = getFbEntriesHash(data);
    // Restore scroll position if returning to a previously visited directory
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
    if (e.name === 'AbortError' && attempt < 3) {
      debugLog('[filebrowser] timeout on attempt ' + attempt + ', retrying in ' + (attempt * 1000) + 'ms');
      setTimeout(() => loadFileBrowser(path, attempt + 1), attempt * 1000);
      return;
    }
    debugLog('[filebrowser] error: ' + e.message);
    grid.innerHTML = '<p style="color:var(--danger);padding:20px;text-align:center;">Failed to load files: ' + escapeHtml(e.message) + '<br><button class="btn-small fb-retry" style="margin-top:12px;">Retry</button></p>';
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
    if (data.type === 'image') {
      body.innerHTML = '<img src="' + escapeHtml(data.content) + '" style="max-width:100%;border-radius:4px;display:block;margin:0 auto;">';
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
document.getElementById('passphrase').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('totp').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

// ─── Dev bypass: triple-tap the gate icon ────────────────────────────────────
let gateTapCount = 0;
let gateTapTimer = null;
document.querySelector('.gate-icon').addEventListener('click', () => {
  gateTapCount++;
  if (gateTapTimer) clearTimeout(gateTapTimer);
  gateTapTimer = setTimeout(() => { gateTapCount = 0; }, 800);
  if (gateTapCount >= 3) {
    gateTapCount = 0;
    devBypass();
  }
});

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
  grid.innerHTML = '<div class="loading">Loading sessions...</div>';
  try {
    const sessions = await apiGet('/kimi/sessions');
    if (!sessions.length) {
      grid.innerHTML = '<p>No Kimi sessions found.</p>';
      return;
    }
    grid.innerHTML = sessions.map(s => {
      const statusClass = s.status === 'active' ? 'status-active' : 'status-idle';
      const statusText = s.status === 'active' ? '🟢 Active' : '⚪ Idle';
      const todoBar = s.todo_total > 0
        ? `<div class="todo-bar"><div class="todo-fill" style="width:${(s.todo_done/s.todo_total*100)}%"></div></div><small>${s.todo_done}/${s.todo_total}</small>`
        : '';
      return `
        <div class="card kimi-card" data-uuid="${escapeHtml(s.uuid)}">
          <h3>${escapeHtml(s.title)}</h3>
          <p>${statusText} · ${escapeHtml(s.last_active)}</p>
          ${todoBar}
          <div class="kimi-actions">
            <button class="btn-primary kimi-launch" data-uuid="${escapeHtml(s.uuid)}">Open Web UI</button>
            <button class="btn-small kimi-terminal" data-uuid="${escapeHtml(s.uuid)}">Open in Terminal</button>
          </div>
          <div class="kimi-url" id="kimi-url-${escapeHtml(s.uuid)}"></div>
        </div>
      `;
    }).join('');
    // Event delegation for Kimi cards
    grid.querySelectorAll('.kimi-launch').forEach(btn => {
      btn.addEventListener('click', () => launchKimi(btn.dataset.uuid));
    });
    grid.querySelectorAll('.kimi-terminal').forEach(btn => {
      btn.addEventListener('click', () => openKimiInTerminal(btn.dataset.uuid));
    });
  } catch {
    grid.innerHTML = '<p>Failed to load Kimi sessions.</p>';
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
