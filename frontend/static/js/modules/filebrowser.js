(function() {
  'use strict';

  window.loadFileBrowser = async function(path, attempt = 1, silent = false) {
    const grid = document.getElementById('projects-grid');
    const pathEl = document.getElementById('fb-path');
    const parentBtn = document.getElementById('fb-parent');
    if (!grid) { console.error('[filebrowser] grid element not found'); return; }
    if (_fbLoading) { console.log('[filebrowser] already loading, skipping'); return; }
    _fbLoading = true;
    if (!silent) {
      grid.innerHTML = '<div class="fb-loading"><span class="fb-spinner">⟳</span> Loading files...</div>';
    }
    try {
      console.log('[filebrowser] fetching ' + path + ' (attempt ' + attempt + ')');
      const isMobile = window.innerWidth < 768 || navigator.maxTouchPoints > 0;
      const timeoutMs = isMobile ? 8000 : (attempt === 1 ? 15000 : 10000);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(API_BASE + '/projects?path=' + encodeURIComponent(path), {
        credentials: 'same-origin',
        mode: 'cors',
        cache: 'no-store',
        headers: getAuthHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      console.log('[filebrowser] status ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.entries)) {
        throw new Error('Invalid server response: missing entries array');
      }
      currentBrowsePath = data.path;
      if (pathEl) pathEl.textContent = data.path;
      if (parentBtn) parentBtn.style.display = data.parent ? 'inline-block' : 'none';
      console.log('[filebrowser] received ' + data.entries.length + ' entries');
      if (!data.entries.length) {
        grid.innerHTML = '<div class="fb-empty">Empty directory</div>';
        _fbLoading = false;
        return;
      }
      grid.innerHTML = data.entries.map(e => {
        if (e.type === 'directory') {
          return `
            <div class="card fb-dir" data-navigate="${escapeHtml(e.path)}">
              <div class="fb-icon">📁</div>
              <div class="fb-name">${escapeHtml(e.name)}</div>
              <div class="fb-meta">folder</div>
            </div>
          `;
        } else {
          const size = formatBytes(e.size || 0);
          return `
            <div class="card fb-file">
              <div class="fb-icon">📄</div>
              <div class="fb-name">${escapeHtml(e.name)}</div>
              <div class="fb-meta">${size}</div>
              <div class="fb-actions">
                <button class="btn-small fb-preview" data-preview="${encodeURIComponent(e.path)}">👁 Preview</button>
                <a href="${PREFIX}/api/web/download?path=${encodeURIComponent(e.path)}" target="_blank" class="btn-small" style="text-decoration:none;">⬇ Download</a>
              </div>
            </div>
          `;
        }
      }).join('');
      _fbLastEntriesHash = getFbEntriesHash(data);
      const scrollArea = document.getElementById('fb-scroll-area');
      if (scrollArea) {
        const saved = fbScrollPositions[data.path];
        if (saved !== undefined) {
          setTimeout(() => { scrollArea.scrollTop = saved; }, 10);
        } else {
          scrollArea.scrollTop = 0;
        }
      }
    } catch (e) {
      console.error('[filebrowser] error on attempt ' + attempt + ':', e.name, e.message);
      if (e.name === 'AbortError' && attempt < 2) {
        console.log('[filebrowser] timeout, retrying...');
        setTimeout(() => loadFileBrowser(path, attempt + 1, silent), 500);
        return;
      }
      grid.innerHTML = `
        <div class="fb-error">
          <div style="font-size:1.2rem;margin-bottom:6px;">⚠️ Could not load folders</div>
          <div style="font-size:0.85rem;opacity:0.9;margin-bottom:12px;">${escapeHtml(e.message || 'Network error')}</div>
          <button class="btn-small fb-retry" style="font-size:14px;padding:10px 18px;min-height:44px;">🔄 Tap to retry</button>
        </div>
      `;
      const retryBtn = grid.querySelector('.fb-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => loadFileBrowser(path));
    } finally {
      _fbLoading = false;
    }
  };

  window.navigateTo = function(path) {
    const scrollArea = document.getElementById('fb-scroll-area');
    if (scrollArea) fbScrollPositions[currentBrowsePath] = scrollArea.scrollTop;
    loadFileBrowser(path);
  };

  window.navigateParent = function() {
    const scrollArea = document.getElementById('fb-scroll-area');
    if (scrollArea) fbScrollPositions[currentBrowsePath] = scrollArea.scrollTop;
    const parent = document.getElementById('fb-path').textContent;
    if (parent) {
      const p = parent.split('/').slice(0, -1).join('/') || '/';
      loadFileBrowser(p);
    }
  };

  window.scrollFileBrowserTop = function() {
    const scrollArea = document.getElementById('fb-scroll-area');
    if (scrollArea) scrollArea.scrollTop = 0;
  };

  window.setupFileBrowserScroll = function() {
    const scrollArea = document.getElementById('fb-scroll-area');
    const topBtn = document.getElementById('fb-scroll-top');
    if (!scrollArea || !topBtn) return;
    scrollArea.addEventListener('scroll', function() {
      topBtn.style.display = scrollArea.scrollTop > 200 ? 'block' : 'none';
    });
  };

  window.getFbEntriesHash = function(data) {
    if (!data.entries) return '';
    return data.entries.map(e => e.name + ':' + e.type + ':' + e.size).join('|');
  };

  window.startFbPolling = function() {
    stopFbPolling();
    _fbPollTimer = setInterval(async () => {
      const check = document.getElementById('fb-autorefresh-check');
      if (!check || !check.checked) return;
      const panel = document.getElementById('tab-projects');
      if (!panel || !panel.classList.contains('active')) return;
      if (document.hidden) return;
      try {
        const res = await fetch(API_BASE + '/projects?path=' + encodeURIComponent(currentBrowsePath), {
          credentials: 'same-origin',
          headers: getAuthHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        const hash = getFbEntriesHash(data);
        if (hash !== _fbLastEntriesHash) {
          _fbLastEntriesHash = hash;
          await loadFileBrowser(currentBrowsePath, 1, true);
        }
      } catch (e) { /* silent fail on poll */ }
    }, 10000);
  };

  window.stopFbPolling = function() {
    if (_fbPollTimer) { clearInterval(_fbPollTimer); _fbPollTimer = null; }
  };

  window.handleFileUpload = async function() {
    const input = document.getElementById('fb-upload-input');
    if (!input || !input.files || !input.files.length) return;
    const files = Array.from(input.files);
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', currentBrowsePath);
      try {
        showToast('Uploading ' + file.name + '...', 'info', 2000);
        await apiPostForm('/upload', formData);
        showToast(file.name + ' uploaded', 'info', 2000);
      } catch (e) {
        showToast('Upload failed: ' + e.message, 'error', 4000);
      }
    }
    input.value = '';
    await loadFileBrowser(currentBrowsePath);
  };

  window.handleMkdir = async function() {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;
    const safeName = name.trim().replace(/[\\/]/g, '_');
    const newPath = currentBrowsePath.replace(/\/$/, '') + '/' + safeName;
    try {
      await apiPost('/mkdir', { path: newPath });
      showToast('Created ' + safeName, 'info', 2000);
      await loadFileBrowser(currentBrowsePath);
    } catch (e) {
      showToast('Failed to create folder: ' + e.message, 'error', 4000);
    }
  };

  window.previewFile = async function(path) {
    const modal = document.getElementById('preview-modal');
    const title = document.getElementById('preview-title');
    const body = document.getElementById('preview-body');
    if (!modal || !title || !body) return;
    title.textContent = 'Loading...';
    body.innerHTML = '<p style="color:var(--text-dim)">Loading preview...</p>';
    modal.style.display = 'block';
    try {
      const data = await apiGet('/preview?path=' + path);
      title.textContent = data.name;
      const R = window._jerichoRenderers;
      const lang = data.language || (R ? R.getLang(data.name || '') : '');
      if (data.type === 'image') {
        body.innerHTML = '<img src="' + escapeHtml(data.content) + '" style="max-width:100%;border-radius:4px;display:block;margin:0 auto;">';
      } else if (R && data.type === 'markdown') {
        body.innerHTML = R.markdown(data.content || '');
        R.renderMermaidBlocks(body);
      } else if (R && data.type === 'json') {
        body.innerHTML = R.jsonTree(data.content || '');
      } else if (R && lang === 'csv') {
        body.innerHTML = R.csv(data.content || '');
      } else if (R && lang === 'log') {
        body.innerHTML = R.logs(data.content || '');
      } else if (R && (data.type === 'code' || data.type === 'text')) {
        const code = R.highlight(data.content || '', lang);
        body.innerHTML = '<pre style="background:#0d1117;border:1px solid #333;border-radius:8px;padding:12px;overflow-x:auto;"><code>' + code + '</code></pre>';
      } else if (data.type === 'markdown') {
        body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;line-height:1.5;color:var(--text);">' + escapeHtml(data.content) + '</pre>';
      } else if (data.type === 'json') {
        try {
          const pretty = JSON.stringify(JSON.parse(data.content), null, 2);
          body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;line-height:1.5;color:var(--text);">' + escapeHtml(pretty) + '</pre>';
        } catch {
          body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;color:var(--text);">' + escapeHtml(data.content) + '</pre>';
        }
      } else if (data.type === 'code' || data.type === 'text') {
        body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.85rem;line-height:1.5;color:var(--text);">' + escapeHtml(data.content) + '</pre>';
      } else {
        body.innerHTML = '<p style="color:var(--text-dim)">' + escapeHtml(data.content) + '</p>';
      }
      if (data.truncated) {
        body.innerHTML += '<p style="color:var(--warn);font-size:0.8rem;margin-top:8px;">⚠️ File truncated to 1MB preview</p>';
      }
    } catch (e) {
      title.textContent = 'Error';
      body.innerHTML = '<p style="color:var(--danger)">Preview failed: ' + escapeHtml(e.message) + '</p>';
    }
  };

  window.closePreview = function() {
    const modal = document.getElementById('preview-modal');
    if (modal) modal.style.display = 'none';
  };

  window.initFileBrowserListeners = function() {
    const fbParent = document.getElementById('fb-parent');
    const fbRefresh = document.getElementById('fb-refresh');
    const fbScrollTop = document.getElementById('fb-scroll-top');
    const fbUploadBtn = document.getElementById('fb-upload-btn');
    const fbUploadInput = document.getElementById('fb-upload-input');
    const fbMkdir = document.getElementById('fb-mkdir');
    if (fbParent) fbParent.addEventListener('click', navigateParent);
    if (fbRefresh) fbRefresh.addEventListener('click', () => loadFileBrowser(currentBrowsePath));
    if (fbScrollTop) fbScrollTop.addEventListener('click', scrollFileBrowserTop);
    if (fbUploadBtn && fbUploadInput) {
      fbUploadBtn.addEventListener('click', () => fbUploadInput.click());
      fbUploadInput.addEventListener('change', handleFileUpload);
    }
    if (fbMkdir) fbMkdir.addEventListener('click', handleMkdir);
    startFbPolling();

    document.addEventListener('click', (e) => {
      const dirCard = e.target.closest('.fb-dir');
      if (dirCard) {
        navigateTo(dirCard.dataset.navigate);
        return;
      }
      const previewBtn = e.target.closest('.fb-preview');
      if (previewBtn) {
        e.stopPropagation();
        previewFile(previewBtn.dataset.preview);
        return;
      }
      const retryBtn = e.target.closest('.fb-retry');
      if (retryBtn) {
        loadFileBrowser(currentBrowsePath);
        return;
      }
    });
  };
})();
