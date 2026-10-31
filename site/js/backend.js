/**
 * Flip Shared Backend Adapter (Supabase + Local Persistent Storage)
 * 
 * Provides unified API for:
 * - Auth: Single owner login, session checking, sign out.
 * - Database: Releases & Media Items (CRUD, reordering, draft/published filter).
 * - Storage: File upload with type validation, client compression, progress callbacks.
 * - Realtime Live Sync: Changes made in /admin appear immediately on the public page.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FlipBackend = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const STORAGE_KEY_ITEMS = 'flip_live_media_items';
  const STORAGE_KEY_RELEASES = 'flip_live_releases';
  const STORAGE_KEY_AUTH = 'flip_admin_auth_session';
  const STORAGE_KEY_CONFIG = 'flip_backend_config';

  // Default initial releases data (verified v1.0.0)
  const DEFAULT_RELEASES = [
    {
        "id": "rel_android_1_0_1",
        "platform": "android",
        "platformName": "Android",
        "version": "1.0.1",
        "format": "APK (Universal)",
        "filename": "Flip.apk",
        "fileSize": 83551747,
        "sha256": "4bb921f01d8b2c07230dbb511eb3660ad64ef4f1f4a3f4ebac79637f43ded24e",
        "compatibility": "Android 10+ (API 29-36)",
        "notes": "Flip: What’s New\n\nFlip Web (new)\n• Send and receive files with any device through a browser. Nothing to install on the other side.\n• Web mode is available from Android only. Just scan the QR code or open the short link.\n\nFiles\n• Documents (PDF, DOCX and more) now show up in Files.\n• Apps are in an A–Z grid, with system apps hidden by default.\n• Sharper thumbnails.\n• Hold to select one file, then tap others to add them.\n• Smoother scrolling with haptic feedback.\n\nStorage and History\n• Storage details now use shades of violet, with black for free space.\n• Cleaner History tabs and better light-mode contrast.\n\nPolish\n• Every bottom sheet and pop-up now blurs the background.\n• Smoother typing on the transfer screen.\n• New Flip logo.\n• Supports Android 10 to 15.",
        "downloadUrl": "https://pub-6c3c9d95f8fb414aa1fc8e027fb62601.r2.dev/binaries/v1.0.1/Flip.apk",
        "isPublished": true,
        "orderIndex": 0,
        "updatedAt": "2026-10-31T18:05:36.373Z"
    },
    {
        "id": "rel_windows_installer_1_0_1",
        "platform": "windows-installer",
        "platformName": "Windows Setup",
        "version": "1.0.1",
        "format": "Setup Wizard (.exe)",
        "filename": "Flip-Setup-1.0.1.exe",
        "fileSize": 72649728,
        "sha256": "5c18394fdf4f4ee6d14234f614663b62998bd7ed0787c7a70c6c538f8702cc57",
        "compatibility": "Windows 10 / 11 (64-bit)",
        "notes": "Flip v1.0.1: Full installer with desktop shortcuts, non-blocking 1.5s disconnect, clean BYE protocol, dynamic QR scanner, and automated firewall rules.",
        "downloadUrl": "https://pub-6c3c9d95f8fb414aa1fc8e027fb62601.r2.dev/binaries/v1.0.1/Flip-Setup-1.0.1.exe",
        "isPublished": true,
        "orderIndex": 1,
        "updatedAt": "2026-10-31T18:05:36.373Z"
    },
    {
        "id": "rel_windows_portable_1_0_1",
        "platform": "windows-portable",
        "platformName": "Windows Portable",
        "version": "1.0.1",
        "format": "Standalone (.exe)",
        "filename": "Flip.exe",
        "fileSize": 78481651,
        "sha256": "f9aec56ceafedd60301ebc81d9f6d6209b134dbf0a70b4e96a25ec2f09e69b24",
        "compatibility": "Windows 10 / 11 (x64)",
        "notes": "Flip v1.0.1: Portable standalone executable. Instant disconnect without freezing, full duplex file & text transfers, no installation needed.",
        "downloadUrl": "https://pub-6c3c9d95f8fb414aa1fc8e027fb62601.r2.dev/binaries/v1.0.1/Flip.exe",
        "isPublished": true,
        "orderIndex": 2,
        "updatedAt": "2026-10-31T18:05:36.373Z"
    }
];

  // Default media items with What's New draft for owner to review and publish
  const DEFAULT_MEDIA = [
    {
      "id": "media_whatsnew_v101",
      "title": "Flip: What’s New (v1.0.1)",
      "description": "Flip Web (new)\n\n• Send and receive files with any device through a browser. Nothing to install on the other side.\n• Web mode is available from Android only. Just scan the QR code or open the short link.\n\nFiles\n\n• Documents (PDF, DOCX and more) now show up in Files.\n• Apps are in an A–Z grid, with system apps hidden by default.\n• Sharper thumbnails.\n• Hold to select one file, then tap others to add them.\n• Smoother scrolling with haptic feedback.\n\nStorage and History\n\n• Storage details now use shades of violet, with black for free space.\n• Cleaner History tabs and better light-mode contrast.\n\nPolish\n\n• Every bottom sheet and pop-up now blurs the background.\n• Smoother typing on the transfer screen.\n• New Flip logo.\n• Supports Android 10 to 15.",
      "category": "releases",
      "url": "assets/flip-logo.jpg",
      "fileSize": 3142,
      "type": "image",
      "isPublished": false,
      "orderIndex": 0,
      "createdAt": "2026-10-31T18:50:00.000Z",
      "updatedAt": "2026-10-31T18:50:00.000Z"
    }
  ];

  class BackendClient {
    constructor() {
      this.supabase = null;
      this.isRecoveryRedirect = false;
      this.authErrorFromUrl = null;
      this.detectUrlAuthState();
      this.initStorage();
      this.initSupabaseIfConfigured();
    }

    detectUrlAuthState() {
      if (typeof window === 'undefined') return;
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      if (hash.includes('type=recovery') || search.includes('type=recovery')) {
        this.isRecoveryRedirect = true;
      }
      const combined = (hash.startsWith('#') ? hash.slice(1) : hash) + '&' + (search.startsWith('?') ? search.slice(1) : search);
      const params = new URLSearchParams(combined);
      if (params.get('error_description') || params.get('error')) {
        this.authErrorFromUrl = params.get('error_description') || params.get('error');
      }
    }

    initStorage() {
      if (typeof localStorage === 'undefined') return;
      const storedReleases = localStorage.getItem(STORAGE_KEY_RELEASES);
      if (!storedReleases) {
        localStorage.setItem(STORAGE_KEY_RELEASES, JSON.stringify(DEFAULT_RELEASES));
      } else {
        try {
          const list = JSON.parse(storedReleases);
          DEFAULT_RELEASES.forEach(defRel => {
            const existing = list.find(r => r.id === defRel.id);
            if (existing) {
              existing.notes = defRel.notes;
            } else {
              list.unshift(defRel);
            }
          });
          localStorage.setItem(STORAGE_KEY_RELEASES, JSON.stringify(list));
        } catch (_) {}
      }

      const storedItems = localStorage.getItem(STORAGE_KEY_ITEMS);
      if (!storedItems) {
        localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(DEFAULT_MEDIA));
      } else {
        try {
          const items = JSON.parse(storedItems);
          DEFAULT_MEDIA.forEach(defItem => {
            const existing = items.find(m => m.id === defItem.id);
            if (!existing) {
              items.unshift(defItem);
            }
          });
          localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
        } catch (_) {}
      }
    }

    initSupabaseIfConfigured() {
      try {
        let cfg = null;
        if (typeof window !== 'undefined' && window.FLIP_ENV && window.FLIP_ENV.supabaseUrl) {
          cfg = window.FLIP_ENV;
        } else if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
          if (raw) {
            cfg = JSON.parse(raw);
          }
        }

        if (cfg && cfg.supabaseUrl && cfg.supabaseKey && typeof window !== 'undefined' && window.supabase) {
          this.supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

          // Listen for Supabase PASSWORD_RECOVERY or session events from email redirect links
          this.supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && this.isRecoveryRedirect)) {
              this.isRecoveryRedirect = true;
              if (session && session.access_token) {
                localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
                  authenticated: true,
                  role: 'owner',
                  email: (session.user && session.user.email) || 'rajiadinoyi0@gmail.com',
                  token: session.access_token,
                  expiresAt: Date.now() + ((session.expires_in || 3600) * 1000)
                }));
              }
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('flip_password_recovery'));
              }
            }
          });

          // Support token_hash recovery links (?token_hash=...&type=recovery) if used by template
          if (typeof window !== 'undefined') {
            const searchParams = new URLSearchParams(window.location.search);
            const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
            const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');
            const type = searchParams.get('type') || hashParams.get('type');
            if (tokenHash && type === 'recovery') {
              this.isRecoveryRedirect = true;
              this.supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ data }) => {
                if (data && data.session) {
                  localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
                    authenticated: true,
                    role: 'owner',
                    email: (data.user && data.user.email) || 'rajiadinoyi0@gmail.com',
                    token: data.session.access_token,
                    expiresAt: Date.now() + ((data.session.expires_in || 3600) * 1000)
                  }));
                  window.dispatchEvent(new CustomEvent('flip_password_recovery'));
                }
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn('[Backend] Could not initialize Supabase client:', e);
      }
    }

    // ========================================================
    // AUTHENTICATION (Owner account & Recovery)
    // ========================================================
    async login(email, password) {
      const normalizedEmail = (email || '').trim().toLowerCase();
      const adminEmail = 'rajiadinoyi0@gmail.com';

      // 1. Strict Administrator Email Gate (enforcing owner identity)
      if (normalizedEmail !== adminEmail && normalizedEmail !== 'admin@flip.app') {
        throw new Error('incorrect credentials');
      }

      const hash = await this.sha256Hex(password);

      // 2. If Supabase client is configured, attempt Supabase Auth first
      if (this.supabase) {
        try {
          const { data, error } = await this.supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password: password
          });
          if (!error && data && data.user) {
            localStorage.setItem('flip_owner_hash', hash);
            localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
              authenticated: true,
              role: 'owner',
              email: data.user.email,
              token: data.session.access_token,
              expiresAt: Date.now() + (data.session.expires_in * 1000)
            }));
            return data.user;
          }
        } catch (_) {
          // Fall through to master key check below
        }
      }

      // 3. Cryptographic Verification for master password
      const storedMasterHash = localStorage.getItem('flip_owner_hash');

      if (!storedMasterHash) {
        // First-time owner setup: initialize master password hash for rajiadinoyi0@gmail.com
        localStorage.setItem('flip_owner_hash', hash);
        localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
          authenticated: true,
          role: 'owner',
          email: normalizedEmail,
          expiresAt: Date.now() + (12 * 60 * 60 * 1000)
        }));
        return { email: normalizedEmail, role: 'owner' };
      }

      if (hash === storedMasterHash) {
        localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
          authenticated: true,
          role: 'owner',
          email: normalizedEmail,
          expiresAt: Date.now() + (12 * 60 * 60 * 1000)
        }));
        return { email: normalizedEmail, role: 'owner' };
      }

      throw new Error('incorrect credentials');
    }

    /**
     * Sends password reset email link via Supabase Auth
     */
    async requestPasswordReset(email) {
      const normalizedEmail = (email || '').trim().toLowerCase();
      const adminEmail = 'rajiadinoyi0@gmail.com';

      if (normalizedEmail !== adminEmail && normalizedEmail !== 'admin@flip.app') {
        throw new Error('incorrect credentials');
      }

      if (this.supabase) {
        const redirectUrl = typeof window !== 'undefined'
          ? (window.location.origin + window.location.pathname)
          : 'https://flip-admin.pages.dev/';

        let { error } = await this.supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: redirectUrl
        });

        if (error) {
          // Retry without explicit redirectTo so Supabase uses its configured Site URL
          const fallback = await this.supabase.auth.resetPasswordForEmail(normalizedEmail);
          error = fallback.error;
        }

        if (error) {
          throw new Error(error.message || 'Unable to send reset link right now.');
        }

        return { success: true, method: 'supabase', email: normalizedEmail };
      }

      return {
        success: true,
        method: 'local',
        email: normalizedEmail
      };
    }

    /**
     * Updates the administrator password after following the recovery link
     */
    async updatePassword(newPassword) {
      if (!newPassword || newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters long.');
      }

      if (this.supabase) {
        const { error } = await this.supabase.auth.updateUser({
          password: newPassword
        });
        if (error && !/different from the old password/i.test(error.message || '')) {
          throw new Error(error.message || 'Failed to update password. Your reset link may have expired.');
        }
      }

      const newHash = await this.sha256Hex(newPassword);
      localStorage.setItem('flip_owner_hash', newHash);
      this.isRecoveryRedirect = false;

      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
        authenticated: true,
        role: 'owner',
        email: 'rajiadinoyi0@gmail.com',
        expiresAt: Date.now() + (12 * 60 * 60 * 1000)
      }));

      return true;
    }

    async getSession() {
      const raw = localStorage.getItem(STORAGE_KEY_AUTH);
      if (!raw) return null;
      try {
        const session = JSON.parse(raw);
        if (session.expiresAt && Date.now() > session.expiresAt) {
          this.logout();
          return null;
        }
        return session;
      } catch {
        return null;
      }
    }

    logout() {
      if (this.supabase) {
        this.supabase.auth.signOut();
      }
      localStorage.removeItem(STORAGE_KEY_AUTH);
    }

    // ========================================================
    // RELEASES DATA (Public reads published only)
    // ========================================================
    async getReleases(options = {}) {
      const { publicOnly = true } = options;

      if (this.supabase) {
        let query = this.supabase.from('releases').select('*').order('order_index', { ascending: true });
        if (publicOnly) query = query.eq('is_published', true);
        const { data, error } = await query;
        if (!error && data) return data;
      }

      const raw = localStorage.getItem(STORAGE_KEY_RELEASES);
      const items = raw ? JSON.parse(raw) : DEFAULT_RELEASES;
      
      const filtered = publicOnly ? items.filter(r => r.isPublished) : items;
      return filtered.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    }

    async saveRelease(release) {
      const items = await this.getReleases({ publicOnly: false });
      const index = items.findIndex(r => r.id === release.id);

      if (index >= 0) {
        items[index] = { ...items[index], ...release, updatedAt: new Date().toISOString() };
      } else {
        release.id = release.id || 'rel_' + Date.now();
        release.orderIndex = items.length;
        release.updatedAt = new Date().toISOString();
        items.push(release);
      }

      localStorage.setItem(STORAGE_KEY_RELEASES, JSON.stringify(items));
      this.broadcastChange('releases');
      return release;
    }

    // ========================================================
    // MEDIA & TUTORIALS ITEMS (Public reads published only)
    // ========================================================
    async getMediaItems(options = {}) {
      const { publicOnly = true, category = 'all' } = options;

      if (this.supabase) {
        let query = this.supabase.from('media_items').select('*').order('order_index', { ascending: true });
        if (publicOnly) query = query.eq('is_published', true);
        if (category !== 'all') query = query.eq('category', category);
        const { data, error } = await query;
        if (!error && data) return data;
      }

      const raw = localStorage.getItem(STORAGE_KEY_ITEMS);
      const items = raw ? JSON.parse(raw) : [];

      let result = publicOnly ? items.filter(m => m.isPublished) : items;
      if (category !== 'all') {
        result = result.filter(m => m.category === category);
      }

      return result.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    }

    async saveMediaItem(item) {
      const items = await this.getMediaItems({ publicOnly: false });
      const index = items.findIndex(m => m.id === item.id);

      if (index >= 0) {
        items[index] = { ...items[index], ...item, updatedAt: new Date().toISOString() };
      } else {
        item.id = item.id || 'media_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        item.orderIndex = item.orderIndex !== undefined ? item.orderIndex : items.length;
        item.isPublished = item.isPublished !== undefined ? item.isPublished : true;
        item.createdAt = item.createdAt || new Date().toISOString();
        item.updatedAt = new Date().toISOString();
        items.push(item);
      }

      localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
      this.broadcastChange('media');
      return item;
    }

    async deleteMediaItem(id) {
      let items = await this.getMediaItems({ publicOnly: false });
      items = items.filter(m => m.id !== id);
      // Re-normalize order indexes
      items.forEach((m, idx) => m.orderIndex = idx);
      localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
      this.broadcastChange('media');
      return true;
    }

    async reorderMediaItems(orderedIds) {
      const items = await this.getMediaItems({ publicOnly: false });
      const idMap = new Map(items.map(m => [m.id, m]));
      const reordered = [];

      orderedIds.forEach((id, index) => {
        const item = idMap.get(id);
        if (item) {
          item.orderIndex = index;
          reordered.push(item);
          idMap.delete(id);
        }
      });

      // Append any unreferenced items
      for (const item of idMap.values()) {
        item.orderIndex = reordered.length;
        reordered.push(item);
      }

      localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(reordered));
      this.broadcastChange('media');
      return reordered;
    }

    async togglePublished(id) {
      const items = await this.getMediaItems({ publicOnly: false });
      const item = items.find(m => m.id === id);
      if (item) {
        item.isPublished = !item.isPublished;
        item.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
        this.broadcastChange('media');
        return item;
      }
      return null;
    }

    async toggleReleasePublished(id) {
      const items = await this.getReleases({ publicOnly: false });
      const item = items.find(r => r.id === id);
      if (item) {
        item.isPublished = !item.isPublished;
        item.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY_RELEASES, JSON.stringify(items));
        this.broadcastChange('releases');
        return item;
      }
      return null;
    }

    // ========================================================
    // STORAGE & CLIENT-SIDE COMPRESSION
    // ========================================================
    validateFile(file, options = {}) {
      const {
        maxSizeBytes = 100 * 1024 * 1024, // 100 MB max
        allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'application/vnd.android.package-archive', 'application/octet-stream']
      } = options;

      if (!file) throw new Error('No file selected.');

      if (file.size > maxSizeBytes) {
        const limitMb = Math.round(maxSizeBytes / (1024 * 1024));
        throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum limit is ${limitMb} MB.`);
      }

      const isAllowed = allowedTypes.includes(file.type) || 
        file.name.endsWith('.apk') || 
        file.name.endsWith('.exe') ||
        file.name.endsWith('.mp4');

      if (!isAllowed) {
        throw new Error(`Unsupported file type: ${file.type || 'unknown'}. Allowed types: PNG, JPG, WEBP, MP4, APK, EXE.`);
      }

      return true;
    }

    /**
     * Compresses images client-side before storing to conserve bandwidth and speed up first load
     */
    async compressImage(file, maxDimension = 1600, quality = 0.82) {
      if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
        return file; // No compression for non-images
      }

      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
              if (blob && blob.size < file.size) {
                const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
                  type: 'image/webp',
                  lastModified: Date.now()
                });
                resolve(compressedFile);
              } else {
                resolve(file); // Keep original if compression wasn't smaller
              }
            }, 'image/webp', quality);
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    /**
     * Upload file with progress reporting
     */
    async uploadFile(file, onProgress) {
      this.validateFile(file);

      // Compress if it is an image
      const readyFile = await this.compressImage(file);

      if (onProgress) onProgress(30);

      // In browser, create blob URL for instantaneous local playback & store base64 or IndexedDB
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (onProgress) onProgress(100);
          resolve({
            url: event.target.result,
            size: readyFile.size,
            name: readyFile.name,
            type: readyFile.type
          });
        };
        reader.onerror = () => reject(new Error('Failed to read file data.'));
        reader.readAsDataURL(readyFile);
      });
    }

    // ========================================================
    // REALTIME BROADCAST & NOTIFICATIONS
    // ========================================================
    broadcastChange(topic) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flip_data_changed', { detail: { topic } }));
        // Cross-tab synchronization
        localStorage.setItem('flip_last_sync_event', JSON.stringify({ topic, timestamp: Date.now() }));
      }
    }

    async sha256Hex(text) {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  return new BackendClient();
}));
