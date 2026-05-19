// ─── System Monitor Tab ──────────────────────────────────────────────────────
// Requires Chart.js loaded from CDN

let systemCharts = {};
let systemPollInterval = null;
const SYSTEM_HISTORY_LENGTH = 60;
let systemHistory = {
  cpu: Array(SYSTEM_HISTORY_LENGTH).fill(0),
  ram: Array(SYSTEM_HISTORY_LENGTH).fill(0),
  load: Array(SYSTEM_HISTORY_LENGTH).fill(0),
  labels: Array(SYSTEM_HISTORY_LENGTH).fill(''),
};
let prevNetSnapshot = null;
let prevNetTimestamp = 0;

function initSystemTab() {
  const tab = document.getElementById('tab-system') || document.body;
  if (!tab) return;
  if (tab.dataset.initialized) return;
  tab.dataset.initialized = 'true';

  // Build tab content
  tab.innerHTML = `
    <h2>System Pulse</h2>
    <div id="sys-error" style="color:var(--danger);font-size:0.85rem;margin-bottom:8px;"></div>
    <div class="system-grid">
      <div class="sys-card wide">
        <h3>CPU Usage</h3>
        <div class="sys-metric" id="sys-cpu-value">--%</div>
        <canvas id="chart-cpu"></canvas>
        <div class="sys-cores" id="sys-cores"></div>
      </div>
      <div class="sys-card">
        <h3>Memory</h3>
        <div class="sys-metric" id="sys-ram-value">--%</div>
        <canvas id="chart-ram"></canvas>
        <div class="sys-detail" id="sys-ram-detail">-- / --</div>
      </div>
      <div class="sys-card">
        <h3>Load Average</h3>
        <div class="sys-metric" id="sys-load-value">--</div>
        <canvas id="chart-load"></canvas>
        <div class="sys-detail">1m / 5m / 15m</div>
      </div>
      <div class="sys-card wide">
        <h3>Disk Usage</h3>
        <div id="sys-disks"></div>
      </div>
      <div class="sys-card wide">
        <h3>Network</h3>
        <div id="sys-network"></div>
      </div>
      <div class="sys-card wide">
        <h3>Top Processes</h3>
        <table class="data-table compact">
          <thead><tr><th>PID</th><th>Name</th><th>CPU%</th><th>RAM%</th><th>Status</th></tr></thead>
          <tbody id="sys-processes"></tbody>
        </table>
      </div>
    </div>
  `;

  initCharts();
  loadSystemStats();
  if (systemPollInterval) clearInterval(systemPollInterval);
  systemPollInterval = setInterval(loadSystemStats, 3000);
}

function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'var(--text)', font: { size: 10 } } },
    },
    elements: { point: { radius: 0 }, line: { tension: 0.3 } },
  };

  const ctxCpu = document.getElementById('chart-cpu');
  if (ctxCpu) {
    const gradCpu = ctxCpu.getContext('2d').createLinearGradient(0, 0, 0, ctxCpu.height);
    gradCpu.addColorStop(0, 'rgba(0,255,65,0.15)');
    gradCpu.addColorStop(1, 'rgba(0,255,65,0.02)');
    systemCharts.cpu = new Chart(ctxCpu, {
      type: 'line',
      data: {
        labels: systemHistory.labels,
        datasets: [{
          data: systemHistory.cpu,
          borderColor: '#ffffff',
          backgroundColor: gradCpu,
          fill: true,
          borderWidth: 1.5,
        }],
      },
      options: { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, max: 100 } } },
    });
  }

  const ctxRam = document.getElementById('chart-ram');
  if (ctxRam) {
    systemCharts.ram = new Chart(ctxRam, {
      type: 'doughnut',
      data: {
        labels: ['Used', 'Free'],
        datasets: [{
          data: [0, 100],
          backgroundColor: ['#ffffff', 'rgba(0,255,65,0.25)'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: { legend: { display: false } },
      },
    });
  }

  const ctxLoad = document.getElementById('chart-load');
  if (ctxLoad) {
    const gradLoad = ctxLoad.getContext('2d').createLinearGradient(0, 0, 0, ctxLoad.height);
    gradLoad.addColorStop(0, 'rgba(0,255,65,0.15)');
    gradLoad.addColorStop(1, 'rgba(0,255,65,0.02)');
    systemCharts.load = new Chart(ctxLoad, {
      type: 'line',
      data: {
        labels: systemHistory.labels,
        datasets: [{
          data: systemHistory.load,
          borderColor: '#ffffff',
          backgroundColor: gradLoad,
          fill: true,
          borderWidth: 1.5,
        }],
      },
      options: commonOptions,
    });
  }
}

async function loadSystemStats() {
  debugLog('[system] fetching stats from ' + MONITOR_BASE + '/stats');
  const headers = {};
  if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
  try {
    const res = await fetch(MONITOR_BASE + '/stats', { headers });
    debugLog('[system] stats response status: ' + res.status);
    if (!res.ok) {
      debugLog('[system] stats fetch failed: HTTP ' + res.status);
      const errEl = document.getElementById('sys-error');
      if (errEl) errEl.textContent = 'Stats unavailable (HTTP ' + res.status + ')';
      return;
    }
    const data = await res.json();
    debugLog('[system] stats received, cpu=' + (data.cpu_percent || 0) + '%');
    const errEl = document.getElementById('sys-error');
    if (errEl) errEl.textContent = '';
    updateSystemUI(data);
    loadSystemProcesses();
  } catch (e) {
    debugLog('[system] stats error: ' + e.message);
    const errEl = document.getElementById('sys-error');
    if (errEl) errEl.textContent = 'Stats error: ' + e.message;
  }
}

function updateSystemUI(data) {
  // Update history
  const now = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  systemHistory.cpu.shift(); systemHistory.cpu.push(data.cpu_percent || 0);
  systemHistory.ram.shift(); systemHistory.ram.push(data.ram_percent || 0);
  systemHistory.load.shift(); systemHistory.load.push(data.load_1m || 0);
  systemHistory.labels.shift(); systemHistory.labels.push(now);

  // CPU
  document.getElementById('sys-cpu-value').textContent = (data.cpu_percent || 0).toFixed(1) + '%';
  if (systemCharts.cpu) {
    systemCharts.cpu.data.datasets[0].data = [...systemHistory.cpu];
    systemCharts.cpu.data.labels = [...systemHistory.labels];
    systemCharts.cpu.update('none');
  }
  const coresEl = document.getElementById('sys-cores');
  if (coresEl && data.cpu_per_core) {
    coresEl.innerHTML = data.cpu_per_core.map(c => `
      <div class="core-bar"><div class="core-fill" style="width:${c.percent}%"></div><span>${c.core}</span></div>
    `).join('');
  }

  // RAM
  document.getElementById('sys-ram-value').textContent = (data.ram_percent || 0).toFixed(1) + '%';
  if (systemCharts.ram) {
    systemCharts.ram.data.datasets[0].data = [data.ram_percent || 0, 100 - (data.ram_percent || 0)];
    systemCharts.ram.update('none');
  }
  const ramDetail = document.getElementById('sys-ram-detail');
  if (ramDetail) {
    const used = formatBytes(data.ram_used || 0);
    const total = formatBytes(data.ram_total || 0);
    ramDetail.textContent = `${used} / ${total}`;
  }

  // Load
  document.getElementById('sys-load-value').textContent = (data.load_1m || 0).toFixed(2);
  if (systemCharts.load) {
    systemCharts.load.data.datasets[0].data = [...systemHistory.load];
    systemCharts.load.data.labels = [...systemHistory.labels];
    systemCharts.load.update('none');
  }

  // Disks
  const disksEl = document.getElementById('sys-disks');
  if (disksEl && data.disks) {
    disksEl.innerHTML = data.disks.map(d => `
      <div class="disk-row">
        <span class="disk-name">${escapeHtml(d.mount)}</span>
        <div class="disk-bar"><div class="disk-fill" style="width:${d.percent}%"></div></div>
        <span class="disk-pct">${d.percent.toFixed(1)}%</span>
        <span class="disk-size">${formatBytes(d.used)} / ${formatBytes(d.total)}</span>
      </div>
    `).join('');
  }

  // Network — show throughput rates (B/s) alongside cumulative totals
  const netEl = document.getElementById('sys-network');
  if (netEl && data.networks) {
    const now = Date.now();
    const dt = prevNetTimestamp ? (now - prevNetTimestamp) / 1000 : 0;
    netEl.innerHTML = data.networks.filter(n => n.bytes_recv > 0 || n.bytes_sent > 0).map(n => {
      let rateRx = '', rateTx = '';
      if (prevNetSnapshot && dt > 0) {
        const prev = prevNetSnapshot.find(p => p.name === n.name);
        if (prev) {
          const rx = Math.max(0, (n.bytes_recv - prev.bytes_recv) / dt);
          const tx = Math.max(0, (n.bytes_sent - prev.bytes_sent) / dt);
          if (rx > 0 || tx > 0) {
            rateRx = `<span class="net-rate" style="color:var(--accent-2);font-size:0.75rem;">▼ ${formatBytes(rx)}/s</span>`;
            rateTx = `<span class="net-rate" style="color:var(--accent);font-size:0.75rem;">▲ ${formatBytes(tx)}/s</span>`;
          }
        }
      }
      return `
        <div class="net-row">
          <span class="net-name">${escapeHtml(n.name)}</span>
          <span class="net-rx">▼ ${formatBytes(n.bytes_recv)} ${rateRx}</span>
          <span class="net-tx">▲ ${formatBytes(n.bytes_sent)} ${rateTx}</span>
        </div>
      `;
    }).join('');
    prevNetSnapshot = data.networks.map(n => ({ name: n.name, bytes_recv: n.bytes_recv, bytes_sent: n.bytes_sent }));
    prevNetTimestamp = now;
  }
}

async function loadSystemProcesses() {
  const headers = {};
  if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
  try {
    const res = await fetch(MONITOR_BASE + '/processes?limit=20', { headers });
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById('sys-processes');
    if (tbody) {
      tbody.innerHTML = data.map(p => `
        <tr>
          <td>${p.pid}</td>
          <td title="${escapeHtml(p.cmdline || '')}">${escapeHtml(p.name)}</td>
          <td>${p.cpu_percent.toFixed(1)}</td>
          <td>${p.memory_percent.toFixed(1)}</td>
          <td>${p.status}</td>
        </tr>
      `).join('');
    }
  } catch (e) {
    debugLog('[system] processes error: ' + e.message);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Auto-init when loaded (lazy-loaded via jericho.js TAB_INIT_FNS)
