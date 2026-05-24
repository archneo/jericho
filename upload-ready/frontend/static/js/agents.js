// ─── Quick Actions Tab ───────────────────────────────────────────────────────

function initAgentsTab() {
  const tab = document.getElementById('tab-agents') || document.body;
  if (!tab) return;
  if (tab.dataset.initialized) return;
  tab.dataset.initialized = 'true';

  tab.innerHTML = `
    <h2>Quick Actions</h2>
    <div class="card-grid" id="agents-grid">
      <div class="card" data-action="restart">
        <h3>🔄 Restart Jericho</h3>
        <p>Rebuild API container & restart services</p>
      </div>
      <div class="card" data-action="ollama">
        <h3>🦙 Ollama</h3>
        <p>Open local LLM inference server</p>
      </div>
      <div class="card" data-action="openclaw">
        <h3>🐾 OpenClaw</h3>
        <p>Open multi-agent gateway</p>
      </div>
      <div class="card" data-action="refresh">
        <h3>🧹 Hard Refresh</h3>
        <p>Clear cache and reload page</p>
      </div>
      <div class="card" data-action="info">
        <h3>📡 Connection Info</h3>
        <p>Show Tailscale access details</p>
      </div>
    </div>
  `;

  const grid = document.getElementById('agents-grid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      switch (card.dataset.action) {
        case 'restart': restartJericho(); break;
        case 'ollama': window.location.href = '/platform/ollama/'; break;
        case 'openclaw': window.location.href = '/platform/openclaw/'; break;
        case 'refresh': window.location.reload(true); break;
        case 'info': alert('Jericho Agent System\nPorts: 9000 (main), 9001 (direct API)'); break;
      }
    });
  }
}

// Auto-init when loaded (lazy-loaded via jericho.js TAB_INIT_FNS)

async function restartJericho() {
  if (!confirm('Restart Jericho stack? This will briefly interrupt service.')) return;
  try {
    const res = await fetch('/api/restart', { method: 'POST', headers: getAuthHeaders() });
    alert(res.ok ? 'Restart triggered. Wait 10s then refresh.' : 'Restart failed: ' + res.status);
  } catch (e) {
    alert('Restart failed: ' + e.message);
  }
}
