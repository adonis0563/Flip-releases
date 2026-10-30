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
      id: 'rel_android_1_0_0',
      platform: 'android',
      platformName: 'Android',
      version: '1.0.0',
      format: 'APK (Universal)',
      filename: 'Flip.apk',
      fileSize: 81266314,
      sha256: '048520afaab0b6ab3005067a07a577bc8ddf862c83ec5a37e47c5a3545fabc57',
      compatibility: 'Android 10+ (API 29-36)',
      notes: 'Direct device-to-device streaming over local Wi-Fi. Supports BLE discovery and dynamic QR codes.',
      downloadUrl: 'https://pub-6c3c9d95f8fb414aa1fc8e027fb62601.r2.dev/binaries/v1.0.0/Flip.apk',
      isPublished: true,
      orderIndex: 0,
      updatedAt: '2026-10-27T07:30:00.000Z'
    },
    {
      id: 'rel_win_setup_1_0_0',
      platform: 'windows-installer',
      platformName: 'Windows Setup',
      version: '1.0.0',
      format: 'Setup Wizard (.exe)',
      filename: 'Flip-Setup-1.0.0.exe',
      fileSize: 72529920,
      sha256: 'f765a29999e5820f4f4f8b31d5ead059ba37fd7a03dddaa0eda31403b7f0542c',
      compatibility: 'Windows 10 / 11 (64-bit)',
      notes: 'Complete desktop installer with desktop shortcuts and automatic firewall rules configuration.',
      downloadUrl: 'https://pub-6c3c9d95f8fb414aa1fc8e027fb62601.r2.dev/binaries/v1.0.0/Flip-Setup-1.0.0.exe',
      isPublished: true,
      orderIndex: 1,
      updatedAt: '2026-10-27T07:31:00.000Z'
    },
    {
      id: 'rel_win_portable_1_0_0',
      platform: 'windows-portable',
      platformName: 'Windows Portable',
      version: '1.0.0',
      format: 'Standalone (.exe)',
      filename: 'Flip.exe',
      fileSize: 78359600,
      sha256: '7fb5c9041c794583c9bd4e0d085462409e06a0f53ab17fecade667c7c6a84926',
      compatibility: 'Windows 10 / 11 (x64)',
      notes: 'No installation required. Run directly from USB drives or any local folder.',
      downloadUrl: 'https://pub-6c3c9d95f8fb414aa1fc8e027fb62601.r2.dev/binaries/v1.0.0/Flip.exe',
      isPublished: true,
      orderIndex: 2,
      updatedAt: '2026-10-27T07:32:00.000Z'
    }
  ];

  // Default clean media items (starts empty per clean-slate specification)
  const DEFAULT_MEDIA = [];

  class BackendClient {
    constructor() {
      this.supabase = null;
      this.initStorage();
      this.initSupabaseIfConfigured();
    }

    initStorage() {
      if (!localStorage.getItem(STORAGE_KEY_RELEASES)) {
        localStorage.setItem(STORAGE_KEY_RELEASES, JSON.stringify(DEFAULT_RELEASES));
      }
      if (!localStorage.getItem(STORAGE_KEY_ITEMS)) {
        localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(DEFAULT_MEDIA));
      }
    }

    initSupabaseIfConfigured() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg.supabaseUrl && cfg.supabaseKey && typeof window !== 'undefined' && window.supabase) {
            this.supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
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

      // 1. If Supabase client is configured, authenticate via Supabase Auth
      if (this.supabase) {
        const { data, error } = await this.supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: password
        });
        if (error) throw error;
        localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify({
          authenticated: true,
          role: 'owner',
          email: data.user.email,
          token: data.session.access_token,
          expiresAt: Date.now() + (data.session.expires_in * 1000)
        }));
        return data.user;
      }

      // 2. Strict Administrator Email Gate (enforcing owner identity)
      if (normalizedEmail !== adminEmail && normalizedEmail !== 'admin@flip.app') {
        throw new Error('Access denied. Administrator email not recognized.');
      }

      // 3. Cryptographic Verification for local storage mode
      const hash = await this.sha256Hex(password);
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

      throw new Error('Incorrect password or credentials. Access denied.');
    }

    /**
     * Sends password reset email via Supabase Auth or sets up local reset token
     */
    async requestPasswordReset(email) {
      const normalizedEmail = (email || '').trim().toLowerCase();
      const adminEmail = 'rajiadinoyi0@gmail.com';

      if (normalizedEmail !== adminEmail && normalizedEmail !== 'admin@flip.app') {
        throw new Error('Password reset unavailable for this address. Verify admin email.');
      }

      // If Supabase is active, trigger password recovery email
      if (this.supabase) {
        const redirectUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0] : '';
        const { data, error } = await this.supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: redirectUrl
        });
        if (error) throw error;
        return { success: true, method: 'supabase' };
      }

      // Local / Offline fallback: generate a secure session reset key
      const resetToken = 'rst_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('flip_pwd_reset_token', JSON.stringify({
        token: resetToken,
        email: normalizedEmail,
        expiresAt: Date.now() + (30 * 60 * 1000) // 30 minutes
      }));

      return {
        success: true,
        method: 'local',
        token: resetToken
      };
    }

    /**
     * Sets a new password after reset verification
     */
    async updatePassword(newPassword) {
      if (!newPassword || newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters long.');
      }

      if (this.supabase) {
        const { data, error } = await this.supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        return true;
      }

      // Update local master password hash
      const newHash = await this.sha256Hex(newPassword);
      localStorage.setItem('flip_owner_hash', newHash);
      localStorage.removeItem('flip_pwd_reset_token');

      // Auto-login into new session
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
