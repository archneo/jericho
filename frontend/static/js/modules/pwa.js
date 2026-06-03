(function() {
  'use strict';

  window.showIOSInstallInstructions = function() {
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
  };

  window.initPWA = function() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
    });
  };
})();
