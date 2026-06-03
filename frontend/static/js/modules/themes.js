(function() {
  'use strict';

  window.setTheme = function(theme) {
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
  };

  window.getSavedTheme = function() {
    const id = localStorage.getItem('jericho_theme_id');
    if (!id) return MINIMAL_THEMES[0];
    const preset = MINIMAL_THEMES.find(t => t.id === id);
    if (preset) return preset;
    return MINIMAL_THEMES[0];
  };

  window.loadSavedTheme = function() {
    try {
      const theme = getSavedTheme();
      setTheme(theme);
    } catch (e) {
      console.error('Failed to load saved theme:', e);
    }
  };

  window.renderSwatches = function(tokens) {
    const colors = [tokens.accent, tokens.bg, tokens.surface, tokens.text];
    return colors.map(c => `<div class="theme-swatch" style="background:${c}"></div>`).join('');
  };

  window.renderThemeLists = function() {
    const presetGrid = document.getElementById('theme-presets');
    let savedId = 'paper';
    try { savedId = localStorage.getItem('jericho_theme_id') || 'paper'; } catch (e) {}
    try {
      if (presetGrid) {
        presetGrid.innerHTML = MINIMAL_THEMES.map(t => `
          <div class="theme-card ${t.id === savedId ? 'active' : ''}" data-theme-id="${t.id}" data-category="preset">
            <div class="theme-card-name">${escapeHtml(t.name)}</div>
            <div class="theme-swatches">${renderSwatches(t.tokens)}</div>
          </div>
        `).join('');
      }
      const customGrid = document.getElementById('theme-custom');
      if (customGrid) customGrid.innerHTML = '';
    } catch (e) {
      debugLog('[themes] render error: ' + e.message);
      if (presetGrid) presetGrid.innerHTML = '<div style="color:var(--danger);padding:8px;">Themes unavailable</div>';
    }
  };

  window.setupThemePanel = function() {
    const navOverlay = document.getElementById('nav-overlay');
    const themeOverlay = document.getElementById('theme-overlay');
    const themeBtn = document.getElementById('nav-theme-btn');
    const themeClose = document.getElementById('theme-overlay-close');

    if (!themeBtn || !themeOverlay) return;

    renderThemeLists();

    themeBtn.addEventListener('click', () => {
      navOverlay.classList.remove('open');
      navOverlay.setAttribute('aria-hidden', 'true');
      themeOverlay.classList.add('open');
      themeOverlay.setAttribute('aria-hidden', 'false');
    });

    themeClose.addEventListener('click', () => {
      themeOverlay.classList.remove('open');
      themeOverlay.setAttribute('aria-hidden', 'true');
    });

    themeOverlay.addEventListener('click', (e) => {
      const card = e.target.closest('.theme-card');
      if (!card) return;
      const id = card.dataset.themeId;
      let theme = MINIMAL_THEMES.find(t => t.id === id);
      if (theme) {
        setTheme(theme);
        renderThemeLists();
      }
    });
  };
})();
