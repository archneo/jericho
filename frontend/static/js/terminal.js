// terminal.js — xterm.js WebSocket terminal for Jericho
// Loads xterm.js from CDN

const XTERM_LOCAL = (typeof PREFIX !== 'undefined' ? PREFIX : '') + '/static/vendor/xterm/xterm.min.js';
const FIT_ADDON_LOCAL = (typeof PREFIX !== 'undefined' ? PREFIX : '') + '/static/vendor/xterm/xterm-addon-fit.min.js';
const WEBLINKS_LOCAL = (typeof PREFIX !== 'undefined' ? PREFIX : '') + '/static/vendor/xterm/xterm-addon-web-links.min.js';
const XTERM_CDN = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js';
const FIT_ADDON_CDN = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js';
const WEBLINKS_CDN = 'https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.min.js';

class TerminalManager {
  constructor() {
    this.term = null;
    this.ws = null;
    this.fitAddon = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimer = null;
    // Circuit breaker states: CLOSED, OPEN, HALF_OPEN
    this.circuitState = 'CLOSED';
    this.circuitFailureCount = 0;
    this.circuitFailureThreshold = 5;
    this.circuitOpenDuration = 30000; // 30s cooldown
    this.circuitTimer = null;
    this.heartbeatTimer = null;
    this.lastHeartbeat = 0;
    this.stickyMod = null;
    this.pendingInput = [];
    this._beforeUnloadHandler = null;
  }

  async init() {
    try {
      await this.loadScript(XTERM_LOCAL);
      await this.loadScript(FIT_ADDON_LOCAL);
      await this.loadScript(WEBLINKS_LOCAL);
    } catch (e) {
      console.log('[terminal] local xterm failed, falling back to CDN');
      await this.loadScript(XTERM_CDN);
      await this.loadScript(FIT_ADDON_CDN);
      await this.loadScript(WEBLINKS_CDN);
    }

    this.term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      theme: {
        background: '#000000',
        foreground: '#e8f0ec',
        cursor: '#00ff41',
        selectionBackground: '#003b00',
        black: '#000000',
        red: '#ff3333',
        green: '#00ff41',
        yellow: '#ffaa00',
        blue: '#008f11',
        magenta: '#00ff41',
        cyan: '#00ff41',
        white: '#e8f0ec',
        brightBlack: '#003b00',
        brightRed: '#ff6666',
        brightGreen: '#4dff7a',
        brightYellow: '#ffcc33',
        brightBlue: '#00cc33',
        brightMagenta: '#4dff7a',
        brightCyan: '#4dff7a',
        brightWhite: '#ffffff',
      },
    });

    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinks.WebLinksAddon());

    const container = document.getElementById('terminal-container');
    this.term.open(container);
    this.fitAddon.fit();

    // Keyboard input → WebSocket
    this.term.onData(data => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(new TextEncoder().encode(data));
      }
    });

    // Resize handling
    window.addEventListener('resize', () => this.fit());

    // Visual viewport for mobile keyboard
    if (window.visualViewport) {
      let resizeTimeout;
      window.visualViewport.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => this.fit(), 150);
      });
    }

    // Connect button
    document.getElementById('terminal-connect').addEventListener('click', () => this.toggleConnect());

    // Keyboard bar
    this.initKeyboardBar();

    // Start agent state detector
    if (window.AgentStateDetector) {
      this.stateDetector = new AgentStateDetector();
    }
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  fit() {
    if (this.fitAddon) {
      this.fitAddon.fit();
      this.sendResize();
    }
  }

  sendResize() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const cols = this.term.cols;
    const rows = this.term.rows;
    this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  async toggleConnect() {
    if (this.connected) {
      this.disconnect();
    } else {
      const shell = document.getElementById('terminal-shell').value;
      const uuid = null; // could be passed for kimi sessions
      await this.connect({ shell });
    }
  }

  async connect(opts = {}) {
    if (this.connected) return;

    const btn = document.getElementById('terminal-connect');
    const status = document.getElementById('terminal-status');
    btn.textContent = 'Connecting...';
    btn.disabled = true;

    try {
      // Get ticket from API
      const apiPrefix = location.pathname.startsWith('/jericho/') ? '/jericho' : '';
      const ticketRes = await fetch(apiPrefix + '/api/web/tickets/terminal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken,
        },
        credentials: 'same-origin',
      });
      if (!ticketRes.ok) {
        const err = await ticketRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to get terminal ticket');
      }
      const ticketData = await ticketRes.json();

      // Build WebSocket URL — detect if running under /jericho/ or at root
      const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const pathPrefix = location.pathname.startsWith('/jericho/') ? '/jericho' : '';
      const wsPath = `${pathPrefix}/ws/terminal/web`;
      let wsUrl = `${wsProto}//${location.host}${wsPath}?ticket=${encodeURIComponent(ticketData.ticket)}`;
      if (opts.shell) wsUrl += `&shell=${encodeURIComponent(opts.shell)}`;
      if (opts.uuid) wsUrl += `&uuid=${encodeURIComponent(opts.uuid)}`;

      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastHeartbeat = Date.now();
        this._circuitRecordSuccess();
        btn.textContent = 'Disconnect';
        btn.disabled = false;
        status.textContent = 'Connected';
        status.className = 'connected';
        this.updateStateBadge('active');
        this.sendResize();
        this.startHeartbeat();
        // Flush pending input
        while (this.pendingInput.length && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new TextEncoder().encode(this.pendingInput.shift()));
        }
        // Protect against accidental page close/refresh while terminal is active
        this._beforeUnloadHandler = (e) => {
          e.preventDefault();
          e.returnValue = 'Terminal session is active. Leave anyway?';
        };
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const decoder = new TextDecoder('utf-8');
          const text = decoder.decode(event.data);
          this.term.write(text);
          if (this.stateDetector) {
            const state = this.stateDetector.ingest(text);
            this.updateStateBadge(state);
          }
        } else {
          // JSON control message
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ready') {
              this.term.writeln('\r\n\x1b[32m✓ Terminal connected\x1b[0m\r\n');
            } else if (msg.type === 'heartbeat') {
              this.lastHeartbeat = Date.now();
              this.ws.send(JSON.stringify({ type: 'heartbeat_ack', seq: msg.seq, ts: Date.now() }));
            } else if (msg.type === 'error') {
              this.term.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
            }
          } catch {}
        }
      };

      this.ws.onclose = (e) => {
        this.connected = false;
        this.stopHeartbeat();
        btn.textContent = 'Connect';
        btn.disabled = false;
        status.textContent = 'Disconnected';
        status.className = 'disconnected';
        this.updateStateBadge('idle');
        if (this._beforeUnloadHandler) {
          window.removeEventListener('beforeunload', this._beforeUnloadHandler);
          this._beforeUnloadHandler = null;
        }
        if (e.code !== 1000 && e.code !== 1001) {
          this._circuitRecordFailure();
          this.scheduleReconnect(opts);
        }
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        this.term.writeln('\r\n\x1b[31mConnection error\x1b[0m\r\n');
      };

    } catch (e) {
      btn.textContent = 'Connect';
      btn.disabled = false;
      status.textContent = 'Failed: ' + e.message;
      status.className = 'error';
      this.term.writeln(`\r\n\x1b[31mConnection failed: ${e.message}\x1b[0m\r\n`);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'client_close');
      this.ws = null;
    }
    this.connected = false;
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    document.getElementById('terminal-connect').textContent = 'Connect';
    document.getElementById('terminal-status').textContent = 'Disconnected';
    document.getElementById('terminal-status').className = 'disconnected';
    this.updateStateBadge('idle');
  }

  scheduleReconnect(opts) {
    if (this.circuitState === 'OPEN') {
      this.term.writeln('\r\n\x1b[31mService temporarily unavailable. Cooling down...\x1b[0m\r\n');
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.term.writeln('\r\n\x1b[31mMax reconnection attempts reached\x1b[0m\r\n');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    const jitter = delay * (0.9 + Math.random() * 0.2);
    this.term.writeln(`\r\n\x1b[33mReconnecting in ${Math.round(jitter/1000)}s...\x1b[0m\r\n`);
    this.reconnectTimer = setTimeout(() => this.connect(opts), jitter);
  }

  // ─── Circuit Breaker ────────────────────────────────────────────────────────
  _circuitRecordSuccess() {
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'CLOSED';
      this.circuitFailureCount = 0;
      this.term.writeln('\r\n\x1b[32mCircuit closed — connection stable\x1b[0m\r\n');
    } else if (this.circuitState === 'CLOSED') {
      this.circuitFailureCount = 0;
    }
  }

  _circuitRecordFailure() {
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'OPEN';
      this._circuitStartCooldown();
      return;
    }
    this.circuitFailureCount++;
    if (this.circuitFailureCount >= this.circuitFailureThreshold) {
      this.circuitState = 'OPEN';
      this._circuitStartCooldown();
    }
  }

  _circuitStartCooldown() {
    this.term.writeln(`\r\n\x1b[31mCircuit OPEN — too many failures. Cooling down for ${this.circuitOpenDuration/1000}s...\x1b[0m\r\n`);
    if (this.circuitTimer) clearTimeout(this.circuitTimer);
    this.circuitTimer = setTimeout(() => {
      this.circuitState = 'HALF_OPEN';
      this.circuitFailureCount = 0;
      this.reconnectAttempts = 0;
      this.term.writeln('\r\n\x1b[33mCircuit HALF-OPEN — attempting recovery...\x1b[0m\r\n');
    }, this.circuitOpenDuration);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) return;
      if (Date.now() - this.lastHeartbeat > 45000) {
        this.term.writeln('\r\n\x1b[33mConnection timeout, reconnecting...\x1b[0m\r\n');
        this.ws.close();
      }
    }, 5000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  sendText(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(new TextEncoder().encode(text));
    } else {
      this.pendingInput.push(text);
    }
  }

  updateStateBadge(state) {
    const badge = document.getElementById('agent-state-badge');
    const labels = {
      idle: '● Idle',
      active: '● Active',
      listening: '● Listening',
      thinking: '● Thinking',
      executing: '● Executing',
      waiting: '● Waiting',
      error: '● Error',
    };
    badge.textContent = labels[state] || '● Unknown';
    badge.className = 'agent-state ' + state;
  }

  async loadCommands() {
    const container = document.getElementById('kb-commands');
    const cacheKey = 'jericho_commands_cache';
    const cacheTsKey = 'jericho_commands_ts';

    // Show loading skeleton
    if (container) {
      container.innerHTML = '<span class="cmd-chip" style="opacity:0.5;background:var(--surface);"><span class="chip-label">Loading...</span></span>';
    }

    // Try cache first
    try {
      const cached = sessionStorage.getItem(cacheKey);
      const ts = parseInt(sessionStorage.getItem(cacheTsKey) || '0', 10);
      if (cached && (Date.now() - ts < 60000)) {
        const data = JSON.parse(cached);
        this.commandRegistry = data.categories || {};
        this.toolsDetected = data.tools_detected || [];
        this.renderCommandChips(this.commandRegistry);
        return;
      }
    } catch (e) { /* ignore cache errors */ }

    try {
      const res = await fetch(API_BASE + '/commands' + CB, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load commands');
      const data = await res.json();
      this.commandRegistry = data.categories || {};
      this.toolsDetected = data.tools_detected || [];
      // Cache success
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(data));
        sessionStorage.setItem(cacheTsKey, String(Date.now()));
      } catch (e) { /* ignore quota errors */ }
      this.renderCommandChips(this.commandRegistry);
    } catch (e) {
      console.error('Command registry load failed:', e);
      if (container) {
        container.innerHTML = `
          <span class="kb-loading">Commands unavailable</span>
          <button class="cmd-chip" id="cmd-retry" style="margin-left:4px;"><span class="chip-label">↻ Retry</span></button>
        `;
        const retryBtn = container.querySelector('#cmd-retry');
        if (retryBtn) retryBtn.addEventListener('click', () => this.loadCommands());
      }
    }
  }

  renderCommandChips(categories) {
    const container = document.getElementById('kb-commands');
    if (!container) return;
    const chips = [];
    const order = ['system', 'docker', 'git', 'network', 'sudo', 'dangerous'];
    for (const cat of order) {
      const cmds = categories[cat];
      if (!cmds) continue;
      for (const cmd of cmds) {
        chips.push(`
          <button class="cmd-chip ${cmd.dangerous ? 'dangerous' : ''} ${cmd.sudo ? 'sudo' : ''}" data-cmd="${escapeHtml(cmd.command)}" data-danger="${cmd.dangerous}" data-sudo="${cmd.sudo || false}" title="${escapeHtml(cmd.description)}">
            <span class="chip-icon">${cmd.icon || '▶'}</span>
            <span class="chip-label">${escapeHtml(cmd.id)}</span>
          </button>
        `);
      }
    }
    container.innerHTML = chips.join('') || '<span class="kb-loading">No commands</span>';
    this.attachChipListeners();
  }

  attachChipListeners() {
    const container = document.getElementById('kb-commands');
    if (!container) return;
    container.querySelectorAll('.cmd-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const cmd = chip.dataset.cmd;
        const dangerous = chip.dataset.danger === 'true';
        const isSudo = chip.dataset.sudo === 'true';
        if (isSudo) {
          executeSudoCommand(cmd, chip.title);
        } else if (dangerous) {
          this.showConfirmDialog(cmd, () => this.executeCommand(cmd));
        } else {
          this.executeCommand(cmd);
        }
      });
    });
  }

  async loadShortcuts() {
    try {
      const res = await fetch(API_BASE + '/shortcuts' + CB, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load shortcuts');
      const data = await res.json();
      this.shortcuts = data.shortcuts || {};
      this.renderShortcutChips(this.shortcuts);
    } catch (e) {
      console.error('Shortcuts load failed:', e);
      const container = document.getElementById('kb-shortcuts');
      if (container) container.innerHTML = '';
    }
  }

  renderShortcutChips(shortcuts) {
    const container = document.getElementById('kb-shortcuts');
    if (!container) return;
    const chips = [];
    for (const [id, sc] of Object.entries(shortcuts)) {
      chips.push(`
        <button class="cmd-chip ${sc.dangerous ? 'dangerous' : ''}" data-shortcut="${escapeHtml(id)}" data-danger="${sc.dangerous}" title="${escapeHtml(sc.description)}">
          <span class="chip-icon">${sc.icon || '⚡'}</span>
          <span class="chip-label">${escapeHtml(sc.name)}</span>
        </button>
      `);
    }
    container.innerHTML = chips.join('');
    this.attachShortcutListeners();
  }

  attachShortcutListeners() {
    const container = document.getElementById('kb-shortcuts');
    if (!container) return;
    container.querySelectorAll('.cmd-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const id = chip.dataset.shortcut;
        const dangerous = chip.dataset.danger === 'true';
        const sc = this.shortcuts[id];
        if (!sc) return;
        if (dangerous) {
          this.showConfirmDialog(sc.steps.map(s => s.cmd).join(' → '), () => this.runShortcut(id));
        } else {
          this.runShortcut(id);
        }
      });
    });
  }

  async runShortcut(id) {
    const sc = this.shortcuts[id];
    if (!sc || !sc.steps) return;
    const total = sc.steps.length;
    for (let i = 0; i < total; i++) {
      const step = sc.steps[i];
      const label = `[${sc.name} ${i + 1}/${total}] ${step.label}`;
      if (this.term) {
        this.term.writeln(`\r\n\x1b[36m${label}\x1b[0m`);
      }
      this.sendText(step.cmd + '\r');
      // Wait for prompt return before next step (simple heuristic: wait 2s + 1s per command length)
      const waitMs = Math.min(5000, 2000 + step.cmd.length * 100);
      await new Promise(r => setTimeout(r, waitMs));
    }
    if (this.term) {
      this.term.writeln(`\r\n\x1b[32m✓ ${sc.name} complete\x1b[0m`);
    }
  }

  executeCommand(cmd) {
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(15);
    // Show command in terminal
    if (this.term) {
      this.term.writeln(`\r\n\x1b[90m▶ ${cmd}\x1b[0m`);
    }
    // Send command via WebSocket with Enter
    this.sendText(cmd + '\r');
  }

  showConfirmDialog(cmd, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'cmd-confirm-overlay';
    overlay.innerHTML = `
      <div class="cmd-confirm-box">
        <h4>⚠️ Dangerous Command</h4>
        <p>This command may cause data loss or service interruption.</p>
        <code>${escapeHtml(cmd)}</code>
        <div class="cmd-confirm-actions">
          <button class="btn-cancel">Cancel</button>
          <button class="btn-confirm">Execute</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.btn-confirm').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  initKeyboardBar() {
    const bar = document.getElementById('mobile-keyboard-bar');
    const toggle = document.getElementById('kb-toggle');

    toggle.addEventListener('click', () => {
      bar.classList.toggle('collapsed');
    });

    bar.querySelectorAll('.kb-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = btn.dataset.key;
        const mod = btn.dataset.mod;

        if (mod) {
          // Sticky modifier
          if (this.stickyMod === mod) {
            this.stickyMod = null;
            btn.classList.remove('active');
          } else {
            // Clear previous sticky
            bar.querySelectorAll('.kb-btn.mod').forEach(b => b.classList.remove('active'));
            this.stickyMod = mod;
            btn.classList.add('active');
          }
          return;
        }

        if (key) {
          let send = key;
          if (this.stickyMod === 'ctrl') {
            // For control sequences, key is already the control char
            this.stickyMod = null;
            bar.querySelectorAll('.kb-btn.mod').forEach(b => b.classList.remove('active'));
          }
          this.sendText(send);
        }
      });
    });

    // Load dynamic commands and shortcuts
    this.loadCommands();
    this.loadShortcuts();
  }
}

// Initialize immediately if terminal container exists (supports both eager and lazy load)
function initTerminal() {
  if (document.getElementById('terminal-container') && !window.terminalManager) {
    window.terminalManager = new TerminalManager();
    window.terminalManager.init().catch(console.error);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTerminal);
} else {
  initTerminal();
}
