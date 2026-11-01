/**
 * Flip Admin Operations Script (Mobile-First)
 * Handles owner session gating, media upload with client compression,
 * CRUD operations, drag/order shifting, and draft/published toggling.
 */

(function () {
  'use strict';

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function showAlert(msg, type = 'error') {
    const errorEl = document.getElementById('global-alert-error');
    const successEl = document.getElementById('global-alert-success');
    errorEl.classList.remove('visible');
    successEl.classList.remove('visible');

    const target = type === 'error' ? errorEl : successEl;
    target.textContent = msg;
    target.classList.add('visible');

    setTimeout(() => {
      target.classList.remove('visible');
    }, 4000);
  }

  // ========================================================
  // 1. AUTHENTICATION & SESSION GATE
  // ========================================================
  const EYE_OPEN_SVG = '<svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG = '<svg class="eye-off" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  window.togglePasswordVisibility = function (inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    if (btnEl) {
      btnEl.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
      btnEl.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      btnEl.setAttribute('title', isHidden ? 'Hide password' : 'Show password');
      btnEl.innerHTML = isHidden ? EYE_OFF_SVG : EYE_OPEN_SVG;
    }
  };

  async function saveCredentialToBrowser(email, password) {
    try {
      if (typeof window !== 'undefined' && window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
        const cred = new window.PasswordCredential({
          id: email,
          password: password,
          name: 'Flip Administrator'
        });
        await navigator.credentials.store(cred);
      }
    } catch (_) {
      // Browser credential manager storage is optional
    }
  }

  async function checkSession() {
    const gate = document.getElementById('auth-gate-section');
    const dash = document.getElementById('admin-dashboard-section');
    const authActions = document.getElementById('auth-header-actions');

    // Handle expired/invalid email link errors in URL
    if (window.FlipBackend && window.FlipBackend.authErrorFromUrl) {
      const errMsg = window.FlipBackend.authErrorFromUrl.replace(/\+/g, ' ');
      window.FlipBackend.authErrorFromUrl = null;
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      gate.style.display = 'block';
      dash.style.display = 'none';
      authActions.style.display = 'none';
      showForgotPasswordView();
      showAlert(errMsg || 'Reset link has expired. Please request a new reset link.');
      return;
    }

    // Check if opened via a Supabase password recovery redirect link
    const isRecovery = (window.FlipBackend && window.FlipBackend.isRecoveryRedirect) ||
      (typeof window !== 'undefined' && (window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery')));

    if (isRecovery) {
      gate.style.display = 'block';
      dash.style.display = 'none';
      authActions.style.display = 'none';
      showResetPasswordView();
      showAlert('Recovery link verified. Please enter your new password below.', 'success');
      return;
    }

    const session = await window.FlipBackend.getSession();

    if (session) {
      gate.style.display = 'none';
      dash.style.display = 'block';
      authActions.style.display = 'block';
      loadAllData();
      startMetricsPolling();
    } else {
      stopMetricsPolling();
      gate.style.display = 'block';
      dash.style.display = 'none';
      authActions.style.display = 'none';
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('flip_password_recovery', function () {
      const gate = document.getElementById('auth-gate-section');
      const dash = document.getElementById('admin-dashboard-section');
      const authActions = document.getElementById('auth-header-actions');
      if (gate) gate.style.display = 'block';
      if (dash) dash.style.display = 'none';
      if (authActions) authActions.style.display = 'none';
      showResetPasswordView();
      showAlert('Recovery link verified. Please enter your new password below.', 'success');
    });
  }

  window.showLoginView = function () {
    if (window.FlipBackend) window.FlipBackend.isRecoveryRedirect = false;
    document.getElementById('owner-login-form').style.display = 'block';
    document.getElementById('forgot-password-form').style.display = 'none';
    document.getElementById('reset-password-form').style.display = 'none';
  };

  window.showForgotPasswordView = function () {
    document.getElementById('owner-login-form').style.display = 'none';
    document.getElementById('forgot-password-form').style.display = 'block';
    document.getElementById('reset-password-form').style.display = 'none';
  };

  window.showResetPasswordView = function () {
    document.getElementById('owner-login-form').style.display = 'none';
    document.getElementById('forgot-password-form').style.display = 'none';
    document.getElementById('reset-password-form').style.display = 'block';
  };

  window.handleLogin = async function (e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    const btn = document.getElementById('login-btn');

    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
      await window.FlipBackend.login(email, pass);
      await saveCredentialToBrowser(email.trim(), pass);
      showAlert('Session authenticated successfully.', 'success');
      checkSession();
    } catch (err) {
      showAlert('incorrect credentials');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Authenticate Session';
    }
  };

  window.handleForgotPassword = async function (e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const btn = document.getElementById('forgot-btn');

    btn.disabled = true;
    btn.textContent = 'Sending Reset Link...';

    try {
      await window.FlipBackend.requestPasswordReset(email);
      showAlert(`Password reset link sent to ${email.trim()}. Click the link in your inbox to set a new password.`, 'success');
    } catch (err) {
      if (err && err.message === 'incorrect credentials') {
        showAlert('incorrect credentials');
      } else {
        showAlert((err && err.message) || 'Could not send reset link. Please wait a moment and try again.');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Password Reset Link';
    }
  };

  window.handleUpdatePassword = async function (e) {
    e.preventDefault();
    const newPass = document.getElementById('new-pass').value;
    const confirmPass = document.getElementById('confirm-pass').value;
    const btn = document.getElementById('reset-btn');

    if (newPass !== confirmPass) {
      showAlert('Passwords do not match. Please re-enter.');
      return;
    }

    if (newPass.length < 8) {
      showAlert('Password must be at least 8 characters long.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Updating Password...';

    try {
      await window.FlipBackend.updatePassword(newPass);
      await saveCredentialToBrowser('rajiadinoyi0@gmail.com', newPass);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      document.getElementById('new-pass').value = '';
      document.getElementById('confirm-pass').value = '';
      showAlert('Password updated successfully! Session authenticated.', 'success');
      showLoginView();
      checkSession();
    } catch (err) {
      showAlert(err.message || 'Password update failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Password & Sign In';
    }
  };

  window.logout = function () {
    window.FlipBackend.logout();
    showAlert('Logged out successfully.', 'success');
    showLoginView();
    checkSession();
  };

  // ========================================================
  // 2. TABS NAVIGATION
  // ========================================================
  window.switchTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    if (event && event.currentTarget) {
      event.currentTarget.classList.add('active');
    }
  };

  // ========================================================
  // 3. FILE PICKER & CLIENT-SIDE COMPRESSION
  // ========================================================
  window.handleFileChosen = async function (file) {
    if (!file) return;

    const progressWrap = document.getElementById('upload-progress-wrap');
    const progressFill = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressLabel = document.getElementById('progress-file-label');

    progressWrap.style.display = 'block';
    progressLabel.textContent = `Processing ${file.name}...`;

    try {
      const uploadResult = await window.FlipBackend.uploadFile(file, (pct) => {
        progressFill.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
      });

      document.getElementById('item-url').value = uploadResult.url;
      document.getElementById('item-file-size').value = uploadResult.size;
      document.getElementById('item-file-type').value = file.type.startsWith('video') ? 'video' : 'image';

      // Auto-populate title if empty
      const titleInput = document.getElementById('item-title');
      if (!titleInput.value) {
        titleInput.value = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      }

      progressLabel.textContent = `Ready: ${file.name} (${formatBytes(uploadResult.size)})`;
      showAlert(`File prepared: ${file.name}`, 'success');
    } catch (err) {
      showAlert(err.message);
      progressWrap.style.display = 'none';
    }
  };

  // ========================================================
  // 4. ITEM CREATION & EDITING
  // ========================================================
  window.handleItemSave = async function (e) {
    e.preventDefault();
    const id = document.getElementById('item-id').value;
    const url = document.getElementById('item-url').value;
    const title = document.getElementById('item-title').value.trim();
    const desc = document.getElementById('item-desc').value.trim();
    const category = document.getElementById('item-category').value;
    const isPublished = document.getElementById('item-published').checked;
    const fileSize = parseInt(document.getElementById('item-file-size').value || '0', 10);
    const type = document.getElementById('item-file-type').value;

    if (!url && !id && category !== 'releases') {
      showAlert('Please choose a file or image to upload first.');
      return;
    }

    try {
      const itemData = {
        id: id || undefined,
        title,
        description: desc,
        category,
        isPublished,
        fileSize: fileSize || 3142,
        type: type || 'image',
        url: url || 'assets/favicon.svg'
      };

      await window.FlipBackend.saveMediaItem(itemData);
      showAlert(`Item "${title}" saved successfully.`, 'success');

      // Reset form
      document.getElementById('item-metadata-form').reset();
      document.getElementById('item-id').value = '';
      document.getElementById('item-url').value = '';
      document.getElementById('upload-progress-wrap').style.display = 'none';
      document.getElementById('save-item-btn').textContent = 'Save and Publish Item';

      await loadAllData();
      // Switch to Items tab
      window.switchTab('tab-items');
      const tabs = document.querySelectorAll('.tab-btn');
      if (tabs[1]) tabs[1].classList.add('active');
    } catch (err) {
      showAlert(err.message || 'Failed to save item.');
    }
  };

  // ========================================================
  // 5. ITEM MANAGEMENT (REORDER, EDIT, DELETE, TOGGLE DRAFT)
  // ========================================================
  async function loadAllData() {
    await Promise.all([renderLiveMetrics(), renderStagedReleaseControl(), renderAdminItems(), renderAdminReleases()]);
  }

  async function renderStagedReleaseControl() {
    const container = document.getElementById('staged-release-control-container');
    if (!container) return;

    const items = await window.FlipBackend.getMediaItems({ publicOnly: false });
    const whatsNewItem = items.find(m => m.id === 'media_whatsnew_v101' || m.category === 'releases') || items[0];
    if (!whatsNewItem) {
      container.innerHTML = '';
      return;
    }

    const isPub = Boolean(whatsNewItem.isPublished);
    const safeItemJson = JSON.stringify(whatsNewItem).replace(/'/g, "&#39;");
    const previewHtml = (whatsNewItem.description || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(
        /Flip Web \(new\)/i,
        '<a href="https://flip-download.pages.dev/web-mode.html" target="_blank" rel="noopener" style="color: var(--color-text-primary); font-weight: 700; text-decoration: underline; text-underline-offset: 4px;">Flip Web (new) &rarr; How to use it</a>'
      );

    container.innerHTML = `
      <div class="staged-release-banner">
        <div class="staged-banner-top">
          <div>
            <div style="display: flex; align-items: center; gap: var(--space-8); margin-bottom: var(--space-4);">
              <strong style="font-size: 17px;">${whatsNewItem.title}</strong>
              <span class="status-tag ${isPub ? 'status-published' : 'status-draft'}" style="margin-top: 0;">
                ${isPub ? 'Published (Live on Website)' : 'Draft (Hidden — Ready for Tomorrow)'}
              </span>
            </div>
            <p style="font-size: 13px; color: var(--color-text-secondary);">
              Separate write-up displayed right before the APK &amp; PC download cards. Flip the toggle switch to publish or hide.
            </p>
          </div>

          <div style="display: flex; align-items: center; gap: var(--space-16);">
            <label class="toggle-control-wrap" title="Toggle What's New visibility on public site">
              <span class="toggle-switch">
                <input type="checkbox" ${isPub ? 'checked' : ''} onchange="togglePublish('${whatsNewItem.id}')">
                <span class="toggle-slider"></span>
              </span>
              <span class="toggle-label-text">${isPub ? 'Public' : 'Draft'}</span>
            </label>

            <button class="btn ${isPub ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="togglePublish('${whatsNewItem.id}')">
              ${isPub ? 'Set to Draft' : 'Make Public Now'}
            </button>
          </div>
        </div>

        <div class="whatsnew-preview-box">${previewHtml}</div>

        <div style="display: flex; gap: var(--space-8); margin-top: var(--space-16); flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" onclick='editItem(${safeItemJson})'>Edit What's New Text</button>
          <a href="https://flip-download.pages.dev/web-mode.html" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">Preview Flip Web Guide &rarr;</a>
          <button class="btn btn-secondary btn-sm" onclick="switchTab('tab-releases')">View v1.0.1 Binaries (APK &amp; PC)</button>
        </div>
      </div>
    `;
  }

  async function renderAdminItems() {
    const container = document.getElementById('items-list-container');
    const countEl = document.getElementById('count-items');
    if (!container) return;

    const items = await window.FlipBackend.getMediaItems({ publicOnly: false });
    countEl.textContent = items.length;

    if (items.length === 0) {
      container.innerHTML = `
        <div style="background: var(--color-bg-surface); border: 1px solid var(--color-border-subtle); border-radius: var(--border-radius); padding: var(--space-32); text-align: center;">
          <p style="color: var(--color-text-secondary); margin-bottom: var(--space-16);">No items created yet.</p>
          <button class="btn btn-primary" onclick="switchTab('tab-upload')">Upload Your First Guide/Screenshot</button>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map((item, index) => {
      const isVideo = item.type === 'video' || (item.url && item.url.endsWith('.mp4'));
      return `
        <article class="admin-item-card" data-id="${item.id}">
          <div class="item-card-top">
            ${isVideo ? `
              <div class="item-thumb-preview" style="display: flex; align-items: center; justify-content: center; font-size: 18px;">🎥</div>
            ` : `
              <img src="${item.url || 'assets/favicon.svg'}" class="item-thumb-preview" alt="Preview">
            `}
            <div class="item-meta">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-8); flex-wrap: wrap; margin-bottom: var(--space-4);">
                <h3 class="item-title-text">${item.title}</h3>
                <label class="toggle-control-wrap" style="min-height: 32px;">
                  <span class="toggle-switch">
                    <input type="checkbox" ${item.isPublished ? 'checked' : ''} onchange="togglePublish('${item.id}')">
                    <span class="toggle-slider"></span>
                  </span>
                  <span class="toggle-label-text">${item.isPublished ? 'Public' : 'Draft'}</span>
                </label>
              </div>
              <p class="item-desc-text">${item.description || 'No description provided.'}</p>
              <div style="display: flex; gap: var(--space-8); align-items: center; margin-top: var(--space-8);">
                <span class="status-tag ${item.isPublished ? 'status-published' : 'status-draft'}">
                  ${item.isPublished ? 'Published (Live)' : 'Draft (Hidden)'}
                </span>
                <span style="font-size: 12px; color: var(--color-text-muted); font-family: var(--font-mono);">${formatBytes(item.fileSize)}</span>
              </div>
            </div>
          </div>

          <div class="item-actions-row">
            <button class="btn ${item.isPublished ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="togglePublish('${item.id}')">
              ${item.isPublished ? 'Set to Draft' : 'Publish'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="moveItem('${item.id}', -1)" ${index === 0 ? 'disabled style="opacity: 0.4;"' : ''}>
              ↑ Move Up
            </button>
            <button class="btn btn-secondary btn-sm" onclick="moveItem('${item.id}', 1)" ${index === items.length - 1 ? 'disabled style="opacity: 0.4;"' : ''}>
              ↓ Move Down
            </button>
            <button class="btn btn-secondary btn-sm" onclick='editItem(${JSON.stringify(item).replace(/'/g, "&#39;")})'>
              Edit
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteItem('${item.id}', '${item.title.replace(/'/g, "\\'")}')">
              Delete
            </button>
          </div>
        </article>
      `;
    }).join('');
  }

  window.togglePublish = async function (id) {
    try {
      const updated = await window.FlipBackend.togglePublished(id);
      showAlert(`Status updated to ${updated.isPublished ? 'Published (Live on Website)' : 'Draft (Hidden)'}.`, 'success');
      await loadAllData();
    } catch (err) {
      showAlert(err.message);
    }
  };

  window.moveItem = async function (id, direction) {
    const items = await window.FlipBackend.getMediaItems({ publicOnly: false });
    const currentIndex = items.findIndex(m => m.id === id);
    if (currentIndex < 0) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    // Swap
    const temp = items[currentIndex];
    items[currentIndex] = items[targetIndex];
    items[targetIndex] = temp;

    const newOrder = items.map(m => m.id);
    await window.FlipBackend.reorderMediaItems(newOrder);
    await loadAllData();
  };

  window.editItem = function (item) {
    document.getElementById('item-id').value = item.id;
    document.getElementById('item-url').value = item.url || 'assets/favicon.svg';
    document.getElementById('item-title').value = item.title;
    document.getElementById('item-desc').value = item.description || '';
    document.getElementById('item-category').value = item.category || 'releases';
    document.getElementById('item-published').checked = Boolean(item.isPublished);
    document.getElementById('item-file-size').value = item.fileSize || 0;
    document.getElementById('item-file-type').value = item.type || 'image';

    document.getElementById('save-item-btn').textContent = 'Save Changes';
    window.switchTab('tab-upload');
  };

  window.deleteItem = async function (id, title) {
    if (confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) {
      try {
        await window.FlipBackend.deleteMediaItem(id);
        showAlert(`Deleted "${title}".`, 'success');
        await loadAllData();
      } catch (err) {
        showAlert(err.message);
      }
    }
  };

  // ========================================================
  // 6. RELEASES MANAGEMENT
  // ========================================================
  async function renderAdminReleases() {
    const container = document.getElementById('releases-admin-container');
    if (!container) return;

    const releases = await window.FlipBackend.getReleases({ publicOnly: false });
    container.innerHTML = releases.map(rel => `
      <div style="background: var(--color-bg-base); border: 1px solid var(--color-border-subtle); border-radius: var(--border-radius); padding: var(--space-16); margin-bottom: var(--space-16);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-16); flex-wrap: wrap; margin-bottom: var(--space-8);">
          <div>
            <strong style="font-size: 16px;">${rel.platformName} (v${rel.version})</strong>
            <span style="font-size: 12px; color: var(--color-text-muted); display: block;">${rel.filename} - ${formatBytes(rel.fileSize)}</span>
          </div>
          <div style="display: flex; gap: var(--space-16); align-items: center;">
            <span class="status-tag ${rel.isPublished ? 'status-published' : 'status-draft'}" style="margin-top: 0;">
              ${rel.isPublished ? 'Published (Live)' : 'Draft (Hidden)'}
            </span>
            <label class="toggle-control-wrap" style="min-height: 32px;">
              <span class="toggle-switch">
                <input type="checkbox" ${rel.isPublished ? 'checked' : ''} onchange="toggleReleasePublish('${rel.id}')">
                <span class="toggle-slider"></span>
              </span>
              <span class="toggle-label-text">${rel.isPublished ? 'Public' : 'Draft'}</span>
            </label>
          </div>
        </div>
        <p style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: var(--space-8); white-space: pre-line; line-height: 1.45;">${rel.notes}</p>
        <p style="font-size: 11px; font-family: var(--font-mono); color: var(--color-text-muted); word-break: break-all;">SHA256: ${rel.sha256}</p>
      </div>
    `).join('');
  }

  window.toggleReleasePublish = async function (id) {
    try {
      const updated = await window.FlipBackend.toggleReleasePublished(id);
      showAlert(`Release status updated to ${updated.isPublished ? 'Published (Live)' : 'Draft (Hidden)'}.`, 'success');
      await loadAllData();
    } catch (err) {
      showAlert(err.message);
    }
  };

  // ========================================================
  // 7. REAL-TIME LIVE METRICS (ADMIN ONLY)
  // ========================================================
  let metricsPollTimer = null;

  function startMetricsPolling() {
    stopMetricsPolling();
    metricsPollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        renderLiveMetrics();
      }
    }, 5000);
  }

  function stopMetricsPolling() {
    if (metricsPollTimer) {
      clearInterval(metricsPollTimer);
      metricsPollTimer = null;
    }
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return 'Just now';
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
    if (diffSec < 5) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }

  async function renderLiveMetrics() {
    const summaryContainer = document.getElementById('live-metrics-summary-container');
    const detailContainer = document.getElementById('live-metrics-detail-container');
    if (!summaryContainer && !detailContainer) return;

    const m = await window.FlipBackend.getLiveMetrics();
    if (!m) return;

    const byPlat = m.downloadsByPlatform || {};
    const androidDl = byPlat['android'] || 0;
    const winInstallerDl = byPlat['windows-installer'] || 0;
    const winPortableDl = byPlat['windows-portable'] || 0;
    const winTotalDl = winInstallerDl + winPortableDl;
    const totalDl = m.totalDownloads || 0;
    const totalVisits = m.totalVisits || 0;

    if (summaryContainer) {
      summaryContainer.innerHTML = `
        <div class="metrics-header-bar">
          <div style="display: flex; align-items: center; gap: var(--space-8);">
            <span class="live-indicator"><span class="live-dot"></span> LIVE TELEMETRY</span>
            <span style="font-size: 12px; color: var(--color-text-muted);">Auto-syncs every 5s</span>
          </div>
          <div style="display: flex; gap: var(--space-8);">
            <button class="btn btn-secondary btn-sm" onclick="refreshMetricsNow()">Refresh</button>
            <button class="btn btn-secondary btn-sm" onclick="switchTab('tab-metrics')">Full Breakdown</button>
          </div>
        </div>

        <div class="metrics-kpi-grid">
          <div class="metric-kpi-card">
            <span class="metric-kpi-label">Online Now</span>
            <span class="metric-kpi-value" style="color: var(--color-status-published);">${m.onlineNow || 0}</span>
            <span class="metric-kpi-sub">Active on site</span>
          </div>
          <div class="metric-kpi-card">
            <span class="metric-kpi-label">Total Visits</span>
            <span class="metric-kpi-value">${totalVisits}</span>
            <span class="metric-kpi-sub">${m.visitsToday || 0} today</span>
          </div>
          <div class="metric-kpi-card">
            <span class="metric-kpi-label">Unique Visitors</span>
            <span class="metric-kpi-value">${m.uniqueVisitors || 0}</span>
            <span class="metric-kpi-sub">Distinct devices</span>
          </div>
          <div class="metric-kpi-card">
            <span class="metric-kpi-label">Total Downloads</span>
            <span class="metric-kpi-value">${totalDl}</span>
            <span class="metric-kpi-sub">${m.downloadsToday || 0} today</span>
          </div>
          <div class="metric-kpi-card">
            <span class="metric-kpi-label">Android APK</span>
            <span class="metric-kpi-value">${androidDl}</span>
            <span class="metric-kpi-sub">Flip.apk</span>
          </div>
          <div class="metric-kpi-card">
            <span class="metric-kpi-label">Windows PC</span>
            <span class="metric-kpi-value">${winTotalDl}</span>
            <span class="metric-kpi-sub">${winInstallerDl} Setup / ${winPortableDl} Portable</span>
          </div>
        </div>
      `;
    }

    if (detailContainer) {
      const filesMap = m.downloadsByFile || {};
      const fileEntries = Object.entries(filesMap).sort((a, b) => b[1] - a[1]);

      const devicesMap = m.devices || {};
      const deviceEntries = Object.entries(devicesMap).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);

      const countriesMap = m.countries || {};
      const countryEntries = Object.entries(countriesMap).sort((a, b) => b[1] - a[1]);

      const recent = m.recentEvents || [];
      const activeVisitors = m.activeVisitors || [];

      detailContainer.innerHTML = `
        <div class="metrics-header-bar">
          <div>
            <h2 style="font-size: 18px; font-weight: 700;">Real-Time Traffic & Download Analytics</h2>
            <p style="font-size: 13px; color: var(--color-text-secondary);">
              Total data delivered: <strong style="color: var(--color-text-primary); font-family: var(--font-mono);">${formatBytes(m.totalBandwidthBytes || 0)}</strong>
            </p>
          </div>
          <div style="display: flex; gap: var(--space-8);">
            <button class="btn btn-secondary btn-sm" onclick="refreshMetricsNow()">Refresh Now</button>
            <button class="btn btn-danger btn-sm" onclick="resetMetrics()">Reset Counters</button>
          </div>
        </div>

        <div class="metrics-panels-grid">
          <!-- Downloads by Binary -->
          <div class="metrics-panel-card">
            <h3 class="metrics-panel-title">Downloads by Binary</h3>
            ${fileEntries.length === 0 ? `
              <p style="font-size: 13px; color: var(--color-text-muted);">No binary downloads recorded yet.</p>
            ` : fileEntries.map(([name, count]) => {
              const pct = totalDl > 0 ? Math.round((count / totalDl) * 100) : 0;
              return `
                <div class="metric-bar-row">
                  <div class="metric-bar-top">
                    <span style="font-weight: 600;">${name}</span>
                    <span style="font-family: var(--font-mono);">${count} (${pct}%)</span>
                  </div>
                  <div class="metric-bar-track">
                    <div class="metric-bar-fill" style="width: ${pct}%;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <!-- Visitor Operating Systems & Countries -->
          <div class="metrics-panel-card">
            <h3 class="metrics-panel-title">Visitors by Device & Country</h3>
            ${deviceEntries.length === 0 ? `
              <p style="font-size: 13px; color: var(--color-text-muted);">No visitor device telemetry recorded yet.</p>
            ` : deviceEntries.map(([dev, count]) => {
              const pct = totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0;
              return `
                <div class="metric-bar-row">
                  <div class="metric-bar-top">
                    <span style="font-weight: 600;">${dev}</span>
                    <span style="font-family: var(--font-mono);">${count} (${pct}%)</span>
                  </div>
                  <div class="metric-bar-track">
                    <div class="metric-bar-fill" style="width: ${pct}%;"></div>
                  </div>
                </div>
              `;
            }).join('')}

            ${countryEntries.length > 0 ? `
              <div style="margin-top: var(--space-16); padding-top: var(--space-16); border-top: 1px solid var(--color-border-subtle);">
                <div style="font-size: 12px; font-weight: 700; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: var(--space-8);">Top Countries</div>
                <div style="display: flex; gap: var(--space-8); flex-wrap: wrap;">
                  ${countryEntries.map(([code, cnt]) => `
                    <span style="background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: var(--font-mono);">
                      ${code}: <strong>${cnt}</strong>
                    </span>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Currently Online Visitors -->
        <div class="metrics-panel-card" style="margin-bottom: var(--space-16);">
          <h3 class="metrics-panel-title">Active Visitors Right Now (${activeVisitors.length})</h3>
          ${activeVisitors.length === 0 ? `
            <p style="font-size: 13px; color: var(--color-text-muted);">No visitors currently have the public site open.</p>
          ` : activeVisitors.map(v => `
            <div class="live-event-item">
              <div>
                <span class="event-badge event-badge-download">ONLINE</span>
                <strong style="margin-left: var(--space-8);">${v.device || 'Browser'}</strong>
                <span style="color: var(--color-text-secondary); margin-left: var(--space-8);">Page: ${v.page || '/'}</span>
              </div>
              <div style="font-size: 12px; font-family: var(--font-mono); color: var(--color-text-muted);">
                ${v.country || ''}${v.city ? ' (' + v.city + ')' : ''} • Active ${formatTimeAgo(new Date(v.lastSeen).toISOString())}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Live Event Stream -->
        <div class="metrics-panel-card">
          <h3 class="metrics-panel-title">Live Activity Stream (Last ${recent.length} Events)</h3>
          ${recent.length === 0 ? `
            <p style="font-size: 13px; color: var(--color-text-muted);">Waiting for real visits and downloads on the public website...</p>
          ` : recent.map(ev => `
            <div class="live-event-item">
              <div>
                <span class="event-badge ${ev.type === 'download' ? 'event-badge-download' : 'event-badge-visit'}">
                  ${ev.type === 'download' ? 'DOWNLOAD' : 'VISIT'}
                </span>
                <strong style="margin-left: var(--space-8);">${ev.label}</strong>
                <span style="color: var(--color-text-secondary); margin-left: var(--space-8);">
                  ${ev.device || ''} ${ev.country && ev.country !== 'XX' ? '• ' + ev.country : ''}${ev.city ? ' (' + ev.city + ')' : ''}
                </span>
              </div>
              <span style="font-size: 12px; font-family: var(--font-mono); color: var(--color-text-muted);">
                ${formatTimeAgo(ev.timestamp)}
              </span>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  window.refreshMetricsNow = async function () {
    await renderLiveMetrics();
    showAlert('Live metrics refreshed.', 'success');
  };

  window.resetMetrics = async function () {
    if (confirm('Are you sure you want to reset all live visit and download counters to zero?')) {
      await window.FlipBackend.resetLiveMetrics();
      await renderLiveMetrics();
      showAlert('All live metrics counters have been reset to zero.', 'success');
    }
  };

  // ========================================================
  // 8. BACKEND CONFIGURATION
  // ========================================================
  window.handleSaveBackendConfig = function (e) {
    e.preventDefault();
    const url = document.getElementById('cfg-supabase-url').value.trim();
    const key = document.getElementById('cfg-supabase-key').value.trim();

    localStorage.setItem('flip_backend_config', JSON.stringify({
      supabaseUrl: url,
      supabaseKey: key
    }));

    showAlert('Supabase backend settings saved. Reloading...', 'success');
    setTimeout(() => location.reload(), 1000);
  };

  document.addEventListener('DOMContentLoaded', checkSession);
})();
