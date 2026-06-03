(function() {
  'use strict';
  window.PREFIX = location.pathname.startsWith('/jericho/') ? '/jericho' : '';
  window.API_BASE = window.PREFIX + '/api/web';
  window.MONITOR_BASE = window.PREFIX + '/api/system';
  window.AGENTS_BASE = window.PREFIX + '/api/agents';
  window.SHELL_BASE = window.PREFIX + '/api/shell';
  window.CB = '?v=' + BUILD_ID;

  window.accessToken = null;
  window.currentNote = null;
  window.sessionCheckInterval = null;
  window.capabilities = {};
  window.debugLines = [];

  window.sudoTicket = null;
  window.sudoExpiry = null;
  window.sudoTimer = null;

  window.desktopMode = false;
  window._windowZ = 10;

  window.currentBrowsePath = '/srv';
  window.fbScrollPositions = {};
  window._fbLoading = false;
  window._fbPollTimer = null;
  window._fbLastEntriesHash = '';

  window.deferredPrompt = null;
  window._toastTimer = null;
  window._seenErrors = new Set();

  window.WINDOW_DEFAULTS = {
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

  window.MINIMAL_THEMES = [
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

  window.TAB_SCRIPTS = {
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

  window.TAB_INIT_FNS = {
    'tab-system': function() { if (typeof initSystemTab === 'function') initSystemTab(); },
    'tab-agents': function() { if (typeof initAgentsTab === 'function') initAgentsTab(); },
    'tab-terminal': function() { if (typeof initTerminal === 'function') initTerminal(); },
    'tab-code': function() {},
    'tab-notes': function() { if (typeof loadNotesList === 'function') loadNotesList(); },
    'tab-capture': function() {},
    'tab-projects': function() { if (typeof loadFileBrowser === 'function') loadFileBrowser(currentBrowsePath); if (typeof setupFileBrowserScroll === 'function') setupFileBrowserScroll(); },
    'tab-platforms': function() { if (typeof loadPlatforms === 'function') loadPlatforms(); },
    'tab-services': function() { if (typeof loadServicesLocal === 'function') loadServicesLocal(); },
    'tab-kimi': function() { if (typeof loadKimiSessions === 'function') loadKimiSessions(); },
  };

  window.DESKTOP_MODE_KEY = 'jericho_desktop_mode';
  window.PULSE_CACHE_TTL = 30000;

  window.JERICHO_CHANGELOG = [
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
})();
