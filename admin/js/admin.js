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
  async function checkSession() {
    // Check if URL has a password recovery hash (#access_token=...&type=recovery)
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      showResetPasswordView();
      return;
    }

    const session = await window.FlipBackend.getSession();
    const gate = document.getElementById('auth-gate-section');
    const dash = document.getElementById('admin-dashboard-section');
    const authActions = document.getElementById('auth-header-actions');

    if (session) {
      gate.style.display = 'none';
      dash.style.display = 'block';
      authActions.style.display = 'block';
      loadAllData();
    } else {
      gate.style.display = 'block';
      dash.style.display = 'none';
      authActions.style.display = 'none';
    }
  }

  window.showLoginView = function () {
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
      showAlert('Session authenticated successfully.', 'success');
      checkSession();
    } catch (err) {
      showAlert(err.message || 'Login failed.');
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
    btn.textContent = 'Sending Recovery...';

    try {
      const res = await window.FlipBackend.requestPasswordReset(email);
      if (res.method === 'supabase') {
        showAlert('Password reset link sent to your email. Check your inbox.', 'success');
      } else {
        showAlert('Reset session verified. Enter your new password.', 'success');
        showResetPasswordView();
      }
    } catch (err) {
      showAlert(err.message || 'Password reset request failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Reset Link';
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
      showAlert('Password updated successfully. Session active.', 'success');
      // Clean recovery hash if present in URL
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      showLoginView();
      checkSession();
    } catch (err) {
      showAlert(err.message || 'Failed to update password.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Password & Login';
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

    if (!url && !id) {
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
        fileSize,
        type,
        url: url || undefined
      };

      await window.FlipBackend.saveMediaItem(itemData);
      showAlert(`Item "${title}" saved successfully.`, 'success');

      // Reset form
      document.getElementById('item-metadata-form').reset();
      document.getElementById('item-id').value = '';
      document.getElementById('item-url').value = '';
      document.getElementById('upload-progress-wrap').style.display = 'none';
      document.getElementById('save-item-btn').textContent = 'Save and Publish Item';

      loadAllData();
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
    await Promise.all([renderAdminItems(), renderAdminReleases()]);
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
              <img src="${item.url}" class="item-thumb-preview" alt="Preview">
            `}
            <div class="item-meta">
              <h3 class="item-title-text">${item.title}</h3>
              <p class="item-desc-text">${item.description || 'No description provided.'}</p>
              <div style="display: flex; gap: var(--space-8); align-items: center; margin-top: var(--space-4);">
                <span class="status-tag ${item.isPublished ? 'status-published' : 'status-draft'}">
                  ${item.isPublished ? 'Published' : 'Draft (Hidden)'}
                </span>
                <span style="font-size: 12px; color: var(--color-text-muted); font-family: var(--font-mono);">${formatBytes(item.fileSize)}</span>
              </div>
            </div>
          </div>

          <div class="item-actions-row">
            <button class="btn btn-secondary btn-sm" onclick="togglePublish('${item.id}')">
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
      showAlert(`Status updated to ${updated.isPublished ? 'Published' : 'Draft'}.`, 'success');
      renderAdminItems();
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
    renderAdminItems();
  };

  window.editItem = function (item) {
    document.getElementById('item-id').value = item.id;
    document.getElementById('item-url').value = item.url;
    document.getElementById('item-title').value = item.title;
    document.getElementById('item-desc').value = item.description || '';
    document.getElementById('item-category').value = item.category || 'tutorials';
    document.getElementById('item-published').checked = item.isPublished;
    document.getElementById('item-file-size').value = item.fileSize || 0;
    document.getElementById('item-file-type').value = item.type || 'image';

    document.getElementById('save-item-btn').textContent = 'Update Item';
    window.switchTab('tab-upload');
  };

  window.deleteItem = async function (id, title) {
    if (confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) {
      try {
        await window.FlipBackend.deleteMediaItem(id);
        showAlert(`Deleted "${title}".`, 'success');
        renderAdminItems();
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
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-8);">
          <div>
            <strong style="font-size: 16px;">${rel.platformName} (v${rel.version})</strong>
            <span style="font-size: 12px; color: var(--color-text-muted); display: block;">${rel.filename} - ${formatBytes(rel.fileSize)}</span>
          </div>
          <span class="status-tag status-published">Verified in R2</span>
        </div>
        <p style="font-size: 13px; color: var(--color-text-secondary); margin-bottom: var(--space-8);">${rel.notes}</p>
        <p style="font-size: 11px; font-family: var(--font-mono); color: var(--color-text-muted); word-break: break-all;">SHA256: ${rel.sha256}</p>
      </div>
    `).join('');
  }

  // ========================================================
  // 7. BACKEND CONFIGURATION
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
