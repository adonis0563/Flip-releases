/**
 * Flip Public Web Application
 * Reads live releases and published media items from shared FlipBackend.
 * Implements real-time sync with /admin changes.
 */

(function () {
  'use strict';

  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function showToast(text) {
    const el = document.getElementById('toast-message');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => {
      el.style.display = 'none';
    }, 2800);
  }

  window.copyChecksum = function (hash) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(hash).then(() => {
        showToast('SHA-256 checksum copied to clipboard.');
      }).catch(() => {
        prompt('Copy SHA-256 Checksum:', hash);
      });
    } else {
      prompt('Copy SHA-256 Checksum:', hash);
    }
  };

  window.recordDownloadClick = function (item) {
    try {
      const raw = localStorage.getItem('flip_analytics_events');
      const events = raw ? JSON.parse(raw) : [];
      events.unshift({
        id: 'evt_' + Date.now(),
        timestamp: new Date().toISOString(),
        platform: item.platform,
        filename: item.filename,
        version: item.version,
        fileSize: item.fileSize || 0
      });
      if (events.length > 500) events.length = 500;
      localStorage.setItem('flip_analytics_events', JSON.stringify(events));
    } catch (e) {
      console.warn('[Analytics] Could not record click event:', e);
    }
  };

  async function renderReleases() {
    const container = document.getElementById('release-cards-container');
    if (!container || !window.FlipBackend) return;

    try {
      const releases = await window.FlipBackend.getReleases({ publicOnly: true });

      if (!releases || releases.length === 0) {
        container.innerHTML = '<p style="color: var(--color-text-secondary); padding: var(--space-24); text-align: center;">No releases currently published.</p>';
        return;
      }

      container.innerHTML = releases.map(rel => `
        <article class="card">
          <div>
            <div class="card-title-row">
              <h3 class="card-platform">${rel.platformName || rel.platform}</h3>
              <span class="card-format">${rel.format || 'Binary'}</span>
            </div>

            <p class="card-notes">${rel.notes || 'Verified release build.'}</p>

            <div class="spec-list">
              <div class="spec-row">
                <span class="spec-label">Version</span>
                <span class="spec-value">v${rel.version}</span>
              </div>
              <div class="spec-row">
                <span class="spec-label">Size</span>
                <span class="spec-value">${formatBytes(rel.fileSize)}</span>
              </div>
              <div class="spec-row">
                <span class="spec-label">Target</span>
                <span class="spec-value">${rel.compatibility || 'Universal'}</span>
              </div>
            </div>

            <div class="checksum-block">
              <span class="checksum-text" title="${rel.sha256}">SHA256: ${rel.sha256 ? rel.sha256.substring(0, 16) + '...' : 'Verified'}</span>
              <button class="btn-copy" onclick="copyChecksum('${rel.sha256}')" aria-label="Copy SHA256 checksum">Copy</button>
            </div>
          </div>

          <a href="${rel.downloadUrl}" class="btn btn-primary btn-block" download="${rel.filename}" onclick='recordDownloadClick(${JSON.stringify(rel).replace(/'/g, "&#39;")})'>
            Download ${rel.filename}
          </a>
        </article>
      `).join('');
    } catch (err) {
      console.error('[App] Failed to render releases:', err);
      container.innerHTML = '<p style="color: var(--color-text-secondary); padding: var(--space-24);">Unable to load release list.</p>';
    }
  }

  async function renderMediaItems() {
    const container = document.getElementById('media-showcase-container');
    const whatsNewSection = document.getElementById('whats-new');
    const whatsNewContainer = document.getElementById('whats-new-container');
    if (!container || !window.FlipBackend) return;

    try {
      const items = await window.FlipBackend.getMediaItems({ publicOnly: true });
      const whatsNewItems = (items || []).filter(m => m.category === 'releases' || m.id === 'media_whatsnew_v101');
      const mediaItems = (items || []).filter(m => m.category !== 'releases' && m.id !== 'media_whatsnew_v101');

      if (whatsNewSection && whatsNewContainer) {
        if (whatsNewItems.length > 0) {
          whatsNewSection.style.display = 'block';
          whatsNewContainer.innerHTML = whatsNewItems.map(item => `
            <div style="background: var(--color-bg-surface); border: 1px solid var(--color-border-strong); border-radius: var(--border-radius); padding: var(--space-24); margin-bottom: var(--space-16);">
              <h2 class="section-title" style="margin-bottom: var(--space-16);">${item.title}</h2>
              <div class="media-desc" style="font-size: 15px; line-height: 1.6; white-space: pre-line;">${item.description || ''}</div>
            </div>
          `).join('');
        } else {
          whatsNewSection.style.display = 'none';
          whatsNewContainer.innerHTML = '';
        }
      }

      if (mediaItems.length === 0) {
        container.innerHTML = `
          <div style="background: var(--color-bg-surface); border: 1px solid var(--color-border-subtle); border-radius: var(--border-radius); padding: var(--space-32); text-align: center; grid-column: 1 / -1;">
            <p style="font-size: 15px; color: var(--color-text-primary); font-weight: 600; margin-bottom: var(--space-8);">No Guides or Media Published Yet</p>
            <p style="font-size: 14px; color: var(--color-text-secondary); max-width: 440px; margin: 0 auto;">
              Tutorial videos and interface walkthroughs will appear here as soon as they are uploaded in the admin portal.
            </p>
          </div>
        `;
        return;
      }

      container.innerHTML = mediaItems.map(item => {
        const isVideo = item.type === 'video' || (item.url && (item.url.endsWith('.mp4') || item.url.endsWith('.webm')));
        return `
          <article class="media-item">
            <div class="media-thumbnail-wrap">
              ${isVideo ? `
                <video src="${item.url}" controls preload="metadata" playsinline poster="${item.thumbnail || ''}"></video>
              ` : `
                <img src="${item.url}" alt="${item.title}" loading="lazy">
              `}
            </div>
            <div class="media-info">
              <h3 class="media-title">${item.title}</h3>
              <p class="media-desc">${item.description || ''}</p>
            </div>
          </article>
        `;
      }).join('');
    } catch (err) {
      console.error('[App] Failed to render media items:', err);
    }
  }

  // Active bottom nav highlighter on scroll
  function setupScrollSpy() {
    const sections = ['downloads', 'tutorials', 'specifications'];
    const navItems = document.querySelectorAll('.mobile-nav-item');

    window.addEventListener('scroll', () => {
      let current = '';
      const scrollPos = window.scrollY + 120;

      sections.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= scrollPos) {
          current = id;
        }
      });

      navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href === '#' + current) {
          item.classList.add('active');
        } else if (href.startsWith('#')) {
          item.classList.remove('active');
        }
      });
    }, { passive: true });
  }

  // Live real-time sync with changes made in /admin
  function setupLiveSync() {
    window.addEventListener('flip_data_changed', (e) => {
      if (e.detail.topic === 'releases') renderReleases();
      if (e.detail.topic === 'media') renderMediaItems();
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'flip_last_sync_event' || e.key === 'flip_live_media_items' || e.key === 'flip_live_releases') {
        renderReleases();
        renderMediaItems();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderReleases();
    renderMediaItems();
    setupScrollSpy();
    setupLiveSync();
  });
})();
