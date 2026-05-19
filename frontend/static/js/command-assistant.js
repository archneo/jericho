// ─── Command Assistant Panel ─────────────────────────────────────────────────
// Integrated into Terminal tab

function initCommandAssistant() {
  if (document.getElementById('command-assistant')) return;

  const panel = document.createElement('div');
  panel.id = 'command-assistant';
  panel.className = 'command-assistant collapsed';
  panel.innerHTML = `
    <div class="ca-header" id="ca-header">
      <span>🛡️ Command Assistant</span>
      <span class="ca-toggle">▲</span>
    </div>
    <div class="ca-body">
      <div class="ca-input-row">
        <input type="text" id="ca-command-input" placeholder="Type command or ask..." autocomplete="off">
        <button id="ca-run-btn">Run</button>
      </div>
      <div id="ca-safety-badge" class="ca-safety safe">Enter a command to check safety</div>
      <div class="ca-templates">
        <h4>Quick Actions</h4>
        <div id="ca-template-grid" class="ca-template-grid"></div>
      </div>
      <div id="ca-output" class="ca-output"></div>
    </div>
  `;

  // Attach listeners
  document.getElementById('ca-header').addEventListener('click', toggleCommandAssistant);
  document.getElementById('ca-run-btn').addEventListener('click', runAssistantCommand);

  // Insert before terminal-container
  const container = document.getElementById('terminal-container');
  if (container && container.parentNode) {
    container.parentNode.insertBefore(panel, container);
  } else {
    document.body.appendChild(panel);
  }

  loadTemplates();

  // Live safety check on input
  const input = document.getElementById('ca-command-input');
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkCommandSafety, 300);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') runAssistantCommand();
  });
}

function toggleCommandAssistant() {
  const panel = document.getElementById('command-assistant');
  if (!panel) return;
  panel.classList.toggle('collapsed');
  const toggle = panel.querySelector('.ca-toggle');
  if (toggle) toggle.textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
}

async function checkCommandSafety() {
  const input = document.getElementById('ca-command-input');
  const badge = document.getElementById('ca-safety-badge');
  if (!input || !badge) return;
  const cmd = input.value.trim();
  if (!cmd) {
    badge.textContent = 'Enter a command to check safety';
    badge.className = 'ca-safety safe';
    return;
  }

  try {
    const res = await fetch(SHELL_BASE + '/validate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    });
    if (!res.ok) return;
    const data = await res.json();
    badge.textContent = data.reason;
    badge.className = 'ca-safety ' + data.level;
  } catch {}
}

async function runAssistantCommand() {
  const input = document.getElementById('ca-command-input');
  const output = document.getElementById('ca-output');
  if (!input || !output) return;
  const cmd = input.value.trim();
  if (!cmd) return;

  output.innerHTML = '<div class="ca-running">Running...</div>';

  try {
    const res = await fetch(SHELL_BASE + '/exec', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, confirmed: true }),
    });
    const data = await res.json();
    if (data.needs_confirm) {
      output.innerHTML = `<div class="ca-confirm">
        <p>⚠️ ${escapeHtml(data.reason)}</p>
        <code>${escapeHtml(data.command)}</code>
        <button class="ca-confirm-btn" data-command="${escapeHtml(data.command).replace(/"/g, '&quot;')}">Confirm & Run</button>
      </div>`;
      const confirmBtn = output.querySelector('.ca-confirm-btn');
      if (confirmBtn) confirmBtn.addEventListener('click', () => runAssistantConfirmed(data.command));
      return;
    }
    showCommandOutput(data);
  } catch (e) {
    output.innerHTML = '<div class="ca-error">Error: ' + escapeHtml(e.message) + '</div>';
  }
}

async function runAssistantConfirmed(cmd) {
  const output = document.getElementById('ca-output');
  if (output) output.innerHTML = '<div class="ca-running">Running...</div>';
  try {
    const res = await fetch(SHELL_BASE + '/exec', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, confirmed: true }),
    });
    const data = await res.json();
    showCommandOutput(data);
  } catch (e) {
    if (output) output.innerHTML = '<div class="ca-error">Error: ' + escapeHtml(e.message) + '</div>';
  }
}

// Auto-init when loaded (lazy-loaded via jericho.js TAB_INIT_FNS)

function showCommandOutput(data) {
  const output = document.getElementById('ca-output');
  if (!output) return;
  const exitColor = data.exit_code === 0 ? 'var(--accent-2)' : 'var(--danger)';
  output.innerHTML = `
    <div class="ca-result">
      <div class="ca-result-header">
        <code>${escapeHtml(data.command)}</code>
        <span style="color:${exitColor}">exit ${data.exit_code}</span>
        <span style="color:var(--text-dim)">${data.duration_ms}ms</span>
      </div>
      <pre>${escapeHtml(data.output || '(no output)')}</pre>
    </div>
  `;
}

async function loadTemplates() {
  const grid = document.getElementById('ca-template-grid');
  if (!grid) return;
  try {
    const res = await fetch(SHELL_BASE + '/templates', {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    });
    if (!res.ok) return;
    const templates = await res.json();
    grid.innerHTML = templates.map(t => `
      <button class="ca-template-btn" data-template="${escapeHtml(t.id)}" title="${escapeHtml(t.description)}">
        <span class="ca-tcat">${escapeHtml(t.category)}</span>
        <span class="ca-tname">${escapeHtml(t.name)}</span>
      </button>
    `).join('');
    grid.querySelectorAll('.ca-template-btn').forEach(btn => {
      btn.addEventListener('click', () => runTemplate(btn.dataset.template));
    });
  } catch (e) {
    grid.innerHTML = '<p>Failed to load templates</p>';
  }
}

async function runTemplate(templateId) {
  const output = document.getElementById('ca-output');
  if (output) output.innerHTML = '<div class="ca-running">Running ' + escapeHtml(templateId) + '...</div>';
  try {
    const res = await fetch(`${SHELL_BASE}/templates/${templateId}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    const data = await res.json();
    if (data.needs_confirm) {
      if (output) output.innerHTML = `<div class="ca-confirm">
        <p>⚠️ ${escapeHtml(data.reason)}</p>
        <code>${escapeHtml(data.command)}</code>
        <button class="ca-confirm-btn" data-template="${escapeHtml(templateId)}">Confirm & Run</button>
      </div>`;
      const confirmBtn = output.querySelector('.ca-confirm-btn');
      if (confirmBtn) confirmBtn.addEventListener('click', () => runTemplateConfirmed(templateId));
      return;
    }
    showCommandOutput(data);
  } catch (e) {
    if (output) output.innerHTML = '<div class="ca-error">Error: ' + escapeHtml(e.message) + '</div>';
  }
}

async function runTemplateConfirmed(templateId) {
  const output = document.getElementById('ca-output');
  if (output) output.innerHTML = '<div class="ca-running">Running...</div>';
  try {
    const res = await fetch(`${SHELL_BASE}/templates/${templateId}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    const data = await res.json();
    showCommandOutput(data);
  } catch (e) {
    if (output) output.innerHTML = '<div class="ca-error">Error: ' + escapeHtml(e.message) + '</div>';
  }
}
