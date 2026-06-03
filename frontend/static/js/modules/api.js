(function() {
  'use strict';

  window.getAuthHeaders = function() {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken && accessToken !== 'dev-bypass') {
      headers['Authorization'] = 'Bearer ' + accessToken;
    }
    return headers;
  };

  window.handleResponse = async function(res, retryFn) {
    debugLog('[fetch] status ' + res.status);
    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (!refreshed) {
        debugLog('[fetch] refresh failed, throwing 401');
        showToast('Session expired. Please log in again.', 'error', 5000);
        throw new Error('Unauthorized');
      }
      debugLog('[fetch] retrying with new token');
      return retryFn();
    }
    if (res.status === 429) {
      let data = {};
      try { data = await res.json(); } catch (e) {}
      const retryAfter = data?.parameters?.retry_after || data?.retry_after || 5;
      showToast(`Rate limited. Retry in ${retryAfter}s`, 'rate', 3000);
      throw new Error(`Rate limited: retry after ${retryAfter}s`);
    }
    if (res.status >= 500) {
      let detail = '';
      try { const d = await res.json(); detail = d.detail || ''; } catch (e) {}
      showToast('Server error: ' + (detail || 'Please retry.'), 'error', 4000);
      throw new Error(`HTTP ${res.status}` + (detail ? ` — ${detail}` : ''));
    }
    if (!res.ok) {
      showToast(`Request failed (${res.status})`, 'error', 4000);
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  };

  window.apiGet = async function(url) {
    debugLog('[fetch] GET ' + API_BASE + url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(API_BASE + url, {
        credentials: 'same-origin',
        headers: getAuthHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const result = await handleResponse(res, () => apiGet(url));
      if (result !== res) return result;
      return res.json();
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error('Request timed out');
      throw e;
    }
  };

  window.apiPost = async function(url, body) {
    debugLog('[fetch] POST ' + API_BASE + url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(API_BASE + url, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await handleResponse(res, () => apiPost(url, body));
    if (result !== res) return result;
    return res.json();
  };

  window.apiPostForm = async function(url, formData) {
    const headers = {};
    if (accessToken) {
      headers['Authorization'] = 'Bearer ' + accessToken;
    }
    debugLog('[fetch] POST(form) ' + API_BASE + url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(API_BASE + url, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const result = await handleResponse(res, () => apiPostForm(url, formData));
      if (result !== res) return result;
      return res.json();
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') throw new Error('Request timed out');
      throw e;
    }
  };

  window.tryRefresh = async function() {
    try {
      debugLog('[refresh] trying cookie refresh...');
      const res = await fetch(PREFIX + '/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) { debugLog('[refresh] server returned ' + res.status); return false; }
      const data = await res.json();
      if (data.access_token) {
        accessToken = data.access_token;
        debugLog('[refresh] got new access token');
        return true;
      }
    } catch (e) {
      debugLog('[refresh] error: ' + e.message);
    }
    return false;
  };
})();
