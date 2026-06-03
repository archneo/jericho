(function() {
  'use strict';

  window.checkSession = async function() {
    debugLog('[checkSession] checking session...');
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
  };

  window.login = async function() {
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
  };

  window.logout = async function() {
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
  };

  window.showGatekeeper = function() {
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
  };

  window.showLogin = function() {
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
  };

  window.showDashboard = function() {
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
  };

  window.initAuthListeners = function() {
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', login);
      loginBtn.addEventListener('touchstart', login, { passive: true });
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    const ppInput = document.getElementById('login-passphrase');
    const totpInput = document.getElementById('login-totp');
    if (ppInput) ppInput.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
    if (totpInput) totpInput.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  };
})();
