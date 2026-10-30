/**
 * Flip Release Manifest & Retention Manager
 * 
 * Enforces schema validation, hash immutability (hard error on hash mismatch),
 * version preservation, and config-driven retention/eligibility logic.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '../releases.json');
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../config/distribution.config.json');
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '../schema/release-manifest.schema.json');

/**
 * Compare two semver strings (supports X.Y.Z, X.Y.Z-prerelease)
 */
function compareSemver(a, b) {
  const parse = (v) => {
    const [main, pre] = v.split('-');
    const parts = main.split('.').map(Number);
    while (parts.length < 3) parts.push(0);
    return { parts, pre: pre || null };
  };

  const pA = parse(a);
  const pB = parse(b);

  for (let i = 0; i < 3; i++) {
    if (pA.parts[i] > pB.parts[i]) return 1;
    if (pA.parts[i] < pB.parts[i]) return -1;
  }

  // Stable releases rank higher than pre-releases of same number
  if (!pA.pre && pB.pre) return 1;
  if (pA.pre && !pB.pre) return -1;
  if (pA.pre && pB.pre) return pA.pre.localeCompare(pB.pre);
  return 0;
}

/**
 * Validates manifest format and logical invariants
 */
function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  if (manifest.appName !== 'Flip') {
    errors.push(`Invalid appName: "${manifest.appName}", expected "Flip"`);
  }

  if (!manifest.schemaVersion || !/^\d+\.\d+\.\d+$/.test(manifest.schemaVersion)) {
    errors.push(`Invalid schemaVersion: "${manifest.schemaVersion}"`);
  }

  if (!manifest.lastUpdated || isNaN(Date.parse(manifest.lastUpdated))) {
    errors.push(`Invalid lastUpdated timestamp: "${manifest.lastUpdated}"`);
  }

  if (!Array.isArray(manifest.releases)) {
    errors.push('Manifest "releases" property must be an array');
    return { valid: false, errors };
  }

  const seenIds = new Set();
  const seenReleases = new Map(); // key -> sha256

  for (let idx = 0; idx < manifest.releases.length; idx++) {
    const rel = manifest.releases[idx];
    const prefix = `Release[${idx}] (${rel.id || 'unnamed'})`;

    if (!rel.id || typeof rel.id !== 'string') {
      errors.push(`${prefix}: Missing or invalid "id"`);
    } else if (seenIds.has(rel.id)) {
      errors.push(`${prefix}: Duplicate release id "${rel.id}"`);
    } else {
      seenIds.add(rel.id);
    }

    const validPlatforms = ['android', 'windows-installer', 'windows-portable', 'media'];
    if (!validPlatforms.includes(rel.platform)) {
      errors.push(`${prefix}: Invalid platform "${rel.platform}". Must be one of: ${validPlatforms.join(', ')}`);
    }

    if (!rel.version || !/^\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?$/.test(rel.version)) {
      errors.push(`${prefix}: Invalid semantic version "${rel.version}"`);
    }

    const validChannels = ['stable', 'prerelease', 'archived'];
    if (!validChannels.includes(rel.channel)) {
      errors.push(`${prefix}: Invalid channel "${rel.channel}". Must be one of: ${validChannels.join(', ')}`);
    }

    if (!rel.releaseDate || isNaN(Date.parse(rel.releaseDate))) {
      errors.push(`${prefix}: Invalid releaseDate timestamp "${rel.releaseDate}"`);
    }

    if (!rel.filename || typeof rel.filename !== 'string') {
      errors.push(`${prefix}: Missing or invalid filename`);
    }

    if (typeof rel.fileSize !== 'number' || rel.fileSize <= 0) {
      errors.push(`${prefix}: fileSize must be a positive integer`);
    }

    if (!rel.sha256 || !/^[a-fA-F0-9]{64}$/.test(rel.sha256)) {
      errors.push(`${prefix}: Invalid sha256 hash "${rel.sha256}". Must be 64-char hex`);
    }

    if (!rel.downloadLocations || typeof rel.downloadLocations !== 'object' || !rel.downloadLocations.primary) {
      errors.push(`${prefix}: Missing downloadLocations.primary URL`);
    }

    const validStatuses = ['active', 'eligible_for_archival', 'archived'];
    if (!validStatuses.includes(rel.status)) {
      errors.push(`${prefix}: Invalid status "${rel.status}". Must be one of: ${validStatuses.join(', ')}`);
    }

    // Check for duplicate platform + version combination
    const releaseKey = `${rel.platform}:${rel.version}:${rel.filename}`;
    if (seenReleases.has(releaseKey)) {
      errors.push(`${prefix}: Duplicate entry for platform "${rel.platform}", version "${rel.version}", and filename "${rel.filename}"`);
    } else {
      seenReleases.set(releaseKey, rel.sha256.toLowerCase());
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if incoming release changes an existing release hash (Tamper / Overwrite Guard)
 */
function verifyHashIntegrity(existingManifest, incomingRelease) {
  const match = existingManifest.releases.find(r => 
    r.id === incomingRelease.id ||
    (r.platform === incomingRelease.platform && r.version === incomingRelease.version && r.filename === incomingRelease.filename)
  );

  if (match) {
    const existingHash = match.sha256.toLowerCase();
    const incomingHash = incomingRelease.sha256.toLowerCase();

    if (existingHash !== incomingHash) {
      throw new Error(
        `[SECURITY ERROR: HASH MISMATCH] Release "${incomingRelease.id}" (v${incomingRelease.version} ${incomingRelease.platform}) ` +
        `already exists with hash: ${existingHash}, but incoming file has hash: ${incomingHash}. ` +
        `Silent overwriting of existing release binaries with different contents is strictly forbidden!`
      );
    }
    return { isUpdate: true, existing: match };
  }

  return { isUpdate: false, existing: null };
}

/**
 * Evaluates retention policy according to distribution.config.json
 */
function evaluateRetention(manifest, config) {
  const retention = config.retention || {
    maxStableReleasesPerPlatform: 2,
    maxPrereleasesPerPlatform: 2,
    totalR2SizeCapBytes: 10737418240
  };

  const driveEnabled = Boolean(config.googleDrive && config.googleDrive.enabled);
  const maxStable = retention.maxStableReleasesPerPlatform || 2;
  const sizeCap = retention.totalR2SizeCapBytes || 10737418240;

  const results = {
    evaluatedAt: new Date().toISOString(),
    driveEnabled,
    policy: {
      maxStableReleasesPerPlatform: maxStable,
      totalR2SizeCapBytes: sizeCap,
      driveEnabled
    },
    totalReleasesCount: manifest.releases.length,
    totalR2SizeBytes: 0,
    activeReleases: [],
    eligibleForArchival: [],
    archivedReleases: [],
    actionsPlanned: []
  };

  // Group by platform
  const byPlatform = {};
  for (const rel of manifest.releases) {
    if (!byPlatform[rel.platform]) {
      byPlatform[rel.platform] = [];
    }
    byPlatform[rel.platform].push({ ...rel });
  }

  let totalR2Size = 0;

  for (const [platform, items] of Object.entries(byPlatform)) {
    if (platform === 'media') {
      // Media (e.g. promo videos) are kept active or treated separately
      for (const item of items) {
        if (item.status === 'archived') {
          results.archivedReleases.push(item);
        } else {
          results.activeReleases.push(item);
          totalR2Size += item.fileSize;
        }
      }
      continue;
    }

    // Sort stable releases newest to oldest by version and date
    const stableItems = items
      .filter(i => i.channel === 'stable')
      .sort((a, b) => {
        const vDiff = compareSemver(b.version, a.version);
        if (vDiff !== 0) return vDiff;
        return new Date(b.releaseDate) - new Date(a.releaseDate);
      });

    // Prereleases
    const prereleases = items
      .filter(i => i.channel === 'prerelease')
      .sort((a, b) => compareSemver(b.version, a.version));

    // Archived
    const archived = items.filter(i => i.channel === 'archived' || i.status === 'archived');
    for (const arch of archived) {
      results.archivedReleases.push(arch);
    }

    // Stable retention window: Keep first N stable
    stableItems.forEach((rel, index) => {
      if (rel.status === 'archived') {
        results.archivedReleases.push(rel);
        return;
      }

      if (index < maxStable) {
        // Within retention window
        rel.status = 'active';
        results.activeReleases.push(rel);
        totalR2Size += rel.fileSize;
      } else {
        // Exceeds max count for stable releases
        rel.status = 'eligible_for_archival';
        results.eligibleForArchival.push(rel);
        totalR2Size += rel.fileSize; // Still in R2!
        results.actionsPlanned.push({
          id: rel.id,
          platform: rel.platform,
          version: rel.version,
          reason: `Exceeds maxStableReleasesPerPlatform (${maxStable}) for platform "${platform}" (rank #${index + 1})`,
          driveEnabled,
          r2Action: driveEnabled ? 'Pending manual/scripted Drive migration' : 'Preserve in R2 (Drive disabled)',
          statusApplied: 'eligible_for_archival'
        });
      }
    });

    // Prerelease retention window
    prereleases.forEach((rel, index) => {
      if (rel.status === 'archived') {
        results.archivedReleases.push(rel);
        return;
      }
      if (index < (retention.maxPrereleasesPerPlatform || 2)) {
        rel.status = 'active';
        results.activeReleases.push(rel);
        totalR2Size += rel.fileSize;
      } else {
        rel.status = 'eligible_for_archival';
        results.eligibleForArchival.push(rel);
        totalR2Size += rel.fileSize;
        results.actionsPlanned.push({
          id: rel.id,
          platform: rel.platform,
          version: rel.version,
          reason: `Exceeds maxPrereleasesPerPlatform for platform "${platform}"`,
          driveEnabled,
          r2Action: driveEnabled ? 'Pending Drive migration' : 'Preserve in R2 (Drive disabled)',
          statusApplied: 'eligible_for_archival'
        });
      }
    });
  }

  results.totalR2SizeBytes = totalR2Size;
  results.totalR2SizeFormatted = `${(totalR2Size / (1024 * 1024)).toFixed(2)} MB`;

  if (totalR2Size > sizeCap) {
    results.actionsPlanned.push({
      reason: `Total R2 size (${results.totalR2SizeFormatted}) exceeds configured cap (${(sizeCap / (1024 * 1024 * 1024)).toFixed(2)} GB)`,
      warning: 'Size threshold crossed. If Google Drive is enabled, oldest eligible releases should be archived.'
    });
  }

  return results;
}

/**
 * Apply retention flags back to manifest file without removing records
 */
function applyRetentionToManifest(manifestPath, configPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const evaluation = evaluateRetention(manifest, config);
  const eligibleMap = new Set(evaluation.eligibleForArchival.map(r => r.id));
  const activeMap = new Set(evaluation.activeReleases.map(r => r.id));

  let modifiedCount = 0;
  for (const rel of manifest.releases) {
    if (rel.status === 'archived') continue; // do not unarchive
    if (eligibleMap.has(rel.id) && rel.status !== 'eligible_for_archival') {
      rel.status = 'eligible_for_archival';
      modifiedCount++;
    } else if (activeMap.has(rel.id) && rel.status !== 'active') {
      rel.status = 'active';
      modifiedCount++;
    }
  }

  manifest.lastUpdated = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { modifiedCount, evaluation };
}

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const manifestPath = args.includes('--manifest') 
    ? args[args.indexOf('--manifest') + 1] 
    : DEFAULT_MANIFEST_PATH;
  const configPath = args.includes('--config')
    ? args[args.indexOf('--config') + 1]
    : DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found at ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};

  if (args.includes('--validate')) {
    console.log(`[INFO] Validating manifest: ${manifestPath}`);
    const res = validateManifest(manifest);
    if (!res.valid) {
      console.error('[FAILED] Manifest validation errors:');
      res.errors.forEach(e => console.error(` - ${e}`));
      process.exit(1);
    }
    console.log('[SUCCESS] Manifest passed all schema and validation rules.');
    console.log(` - App: ${manifest.appName}`);
    console.log(` - Schema Version: ${manifest.schemaVersion}`);
    console.log(` - Total Release Records: ${manifest.releases.length}`);
    process.exit(0);
  }

  if (args.includes('--dry-run') || args.includes('--check-retention')) {
    console.log('====================================================');
    console.log('FLIP RELEASE RETENTION EVALUATION (DRY-RUN MODE)');
    console.log('====================================================');
    const evaluation = evaluateRetention(manifest, config);
    console.log(`Google Drive Status : ${evaluation.driveEnabled ? 'ENABLED' : 'DISABLED (Last-resort fallback)'}`);
    console.log(`Retention Limit     : Latest ${evaluation.policy.maxStableReleasesPerPlatform} stable releases per platform`);
    console.log(`Total Releases      : ${evaluation.totalReleasesCount}`);
    console.log(`Active in R2        : ${evaluation.activeReleases.length}`);
    console.log(`Eligible Archival   : ${evaluation.eligibleForArchival.length}`);
    console.log(`Archived (Off R2)   : ${evaluation.archivedReleases.length}`);
    console.log(`Total R2 Footprint  : ${evaluation.totalR2SizeFormatted}`);
    console.log('----------------------------------------------------');
    
    if (evaluation.actionsPlanned.length === 0) {
      console.log('All releases are within current retention limits. No actions required.');
    } else {
      console.log('Retention actions calculated:');
      evaluation.actionsPlanned.forEach((a, i) => {
        console.log(` [${i + 1}] Release ${a.id} (v${a.version} ${a.platform}):`);
        console.log(`     Reason : ${a.reason}`);
        console.log(`     Action : ${a.r2Action}`);
        console.log(`     Status : ${a.statusApplied}`);
      });
    }

    if (!evaluation.driveEnabled) {
      console.log('----------------------------------------------------');
      console.log('[SAFETY NOTICE] Google Drive is DISABLED. Nothing is removed or deleted from R2.');
      console.log('Releases past retention limits are marked "eligible_for_archival" and remain active in R2.');
    }
    console.log('====================================================');
    process.exit(0);
  }

  if (args.includes('--apply-retention')) {
    const res = applyRetentionToManifest(manifestPath, configPath);
    console.log(`[SUCCESS] Retention updated. Modified ${res.modifiedCount} release record status(es).`);
    process.exit(0);
  }

  console.log('Usage: node manifest-manager.js [--validate] [--check-retention|--dry-run] [--apply-retention]');
}

module.exports = {
  validateManifest,
  verifyHashIntegrity,
  evaluateRetention,
  applyRetentionToManifest,
  compareSemver
};
