(function() {
  'use strict';

  window.loadTerminal = function() {
    if (typeof initTerminal === 'function') initTerminal();
  };

  window.openProject = function(path) {
    const tabBtn = document.querySelector('[data-tab="terminal"]');
    if (tabBtn) tabBtn.click();
    if (window.terminalManager && window.terminalManager.connected) {
      window.terminalManager.sendText('cd ' + path + '\r');
    } else {
      alert('Connect to terminal first, then run: cd ' + path);
    }
  };

  window.openKimiInTerminal = async function(uuid) {
    const tabBtn = document.querySelector('[data-tab="terminal"]');
    if (tabBtn) tabBtn.click();
    setTimeout(() => {
      const shellSelect = document.getElementById('terminal-shell');
      if (shellSelect) shellSelect.value = 'kimi';
      if (window.terminalManager) {
        window.terminalManager.connect({ shell: 'kimi', uuid });
      }
    }, 400);
  };
})();
