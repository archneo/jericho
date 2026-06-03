(function() {
  'use strict';

  window.startSudoTimer = function() {
    clearInterval(sudoTimer);
    sudoTimer = setInterval(() => {
      if (!isSudoActive()) {
        clearSudo();
        showToast('Sudo mode expired', true);
      } else {
        updateSudoUI();
      }
    }, 1000);
    updateSudoUI();
  };

  window.showSudoAuthModal = function() {
    return new Promise((resolve) => {
      const modal = document.getElementById('sudo-modal');
      const passphraseInput = document.getElementById('sudo-passphrase');
      const totpInput = document.getElementById('sudo-totp');
      const errorDiv = document.getElementById('sudo-error');
      const confirmBtn = document.getElementById('sudo-confirm');
      const cancelBtn = document.getElementById('sudo-cancel');

      if (!modal) { resolve(false); return; }

      passphraseInput.value = '';
      totpInput.value = '';
      errorDiv.style.display = 'none';
      errorDiv.textContent = '';
      modal.classList.add('show');
      passphraseInput.focus();

      const cleanup = () => {
        modal.classList.remove('show');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
      };

      cancelBtn.onclick = () => { cleanup(); resolve(false); };
      confirmBtn.onclick = async () => {
        const passphrase = passphraseInput.value.trim();
        const totp = totpInput.value.trim();
        if (!passphrase || !totp || totp.length !== 6) {
          errorDiv.textContent = 'Enter passphrase and 6-digit TOTP code';
          errorDiv.style.display = 'block';
          return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Activating...';
        try {
          const res = await fetch(API_BASE + '/tickets/sudo', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ passphrase, totp }),
          });
          const data = await res.json();
          if (!res.ok) {
            errorDiv.textContent = data.detail || 'Authentication failed';
            errorDiv.style.display = 'block';
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Activate';
            return;
          }
          sudoTicket = data.ticket;
          sudoExpiry = Date.now() + (data.expires_in_seconds * 1000);
          startSudoTimer();
          cleanup();
          showToast('Sudo mode activated — 2 minutes');
          resolve(true);
        } catch (e) {
          errorDiv.textContent = 'Network error: ' + e.message;
          errorDiv.style.display = 'block';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Activate';
        }
      };
    });
  };

  window.executeSudoCommand = async function(command, description) {
    if (!isSudoActive()) {
      const ok = await showSudoAuthModal();
      if (!ok) return;
    }
    const confirmed = confirm(`Execute with sudo:\n${description || command}`);
    if (!confirmed) return;
    try {
      const res = await fetch(API_BASE + '/sudo/exec', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
          'X-Sudo-Ticket': sudoTicket,
        },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('Sudo failed: ' + (data.detail || 'Unknown error'), true);
        return;
      }
      const exitCode = data.exit_code ?? 0;
      const output = data.output || '';
      if (exitCode !== 0) {
        showToast(`Exit code ${exitCode}`, true);
      } else {
        showToast('Command executed successfully');
      }
      if (output.length > 200) {
        debugLog('[sudo] ' + command + '\n' + output.slice(0, 500));
        showToast('Output logged to debug panel');
      }
      return data;
    } catch (e) {
      showToast('Sudo execution error: ' + e.message, true);
    }
  };

  window.initSudoUI = function() {
    return;
  };

  window.requestSudoTicket = function() {
    return showSudoAuthModal();
  };
})();
