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

  function getVisitorId() {
    try {
      let vid = localStorage.getItem('flip_visitor_id');
      if (!vid) {
        vid = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        localStorage.setItem('flip_visitor_id', vid);
      }
      return vid;
    } catch (_) {
      return 'v_anon_' + Math.random().toString(36).slice(2, 9);
    }
  }

  function sendMetricEvent(payload) {
    const body = JSON.stringify({
      ...payload,
      visitorId: getVisitorId(),
      page: window.location.pathname || '/'
    });

    if (navigator.sendBeacon && (payload.type === 'leave' || payload.type === 'download')) {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/metrics', blob)) return;
      } catch (_) {}
    }

    fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {
      fetch('https://flip-admin.pages.dev/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    });
  }

  function initLiveTelemetry() {
    // Record real page visit
    sendMetricEvent({ type: 'visit' });

    // Send live presence heartbeat every 25s while tab is open
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        sendMetricEvent({ type: 'heartbeat' });
      }
    }, 25000);

    window.addEventListener('pagehide', () => {
      sendMetricEvent({ type: 'leave' });
    });
  }

  window.recordDownloadClick = function (item) {
    try {
      sendMetricEvent({
        type: 'download',
        platform: item.platform,
        filename: item.filename,
        version: item.version,
        fileSize: item.fileSize || 0
      });

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

  function formatWhatsNewDescription(rawText) {
    if (!rawText) return '';
    // Split into blocks separated by double newlines or section headers
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const groups = [];
    let currentGroup = null;

    for (const line of lines) {
      const isBullet = line.startsWith('•') || line.startsWith('-') || line.startsWith('*');
      if (!isBullet && line.length < 48 && !line.endsWith('.')) {
        currentGroup = { heading: line, items: [] };
        groups.push(currentGroup);
      } else {
        if (!currentGroup) {
          currentGroup = { heading: '', items: [] };
          groups.push(currentGroup);
        }
        currentGroup.items.push(line.replace(/^[•\-*]\s*/, ''));
      }
    }

    if (groups.length === 0) return '';

    return `<div class="whatsnew-grid">` + groups.map(g => {
      let headingHtml = '';
      if (g.heading) {
        if (/^flip web/i.test(g.heading)) {
          headingHtml = `
            <h3 class="whatsnew-group-title">
              <a href="web-mode.html" class="whatsnew-web-link">
                <span>${g.heading}</span>
                <span class="whatsnew-web-badge">How it works &rarr;</span>
              </a>
            </h3>
          `;
        } else {
          headingHtml = `<h3 class="whatsnew-group-title">${g.heading}</h3>`;
        }
      }
      const listHtml = g.items.length > 0
        ? `<ul class="whatsnew-list">${g.items.map(it => `<li>${it}</li>`).join('')}</ul>`
        : '';
      return `<div class="whatsnew-group">${headingHtml}${listHtml}</div>`;
    }).join('') + `</div>`;
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
            <article class="whatsnew-writeup-card">
              <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: var(--space-8); border-bottom: 1px solid var(--color-border-subtle); padding-bottom: var(--space-16);">
                <h2 class="section-title" style="margin-bottom: 0;">${item.title}</h2>
                <a href="web-mode.html" style="font-size: 14px; font-weight: 600; color: var(--color-text-primary); text-decoration: underline; text-underline-offset: 4px;">
                  Read the Flip Web Mode Guide &rarr;
                </a>
              </div>
              ${formatWhatsNewDescription(item.description)}
            </article>
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
    initLiveTelemetry();
    renderReleases();
    renderMediaItems();
    setupScrollSpy();
    setupLiveSync();
  });
})();
