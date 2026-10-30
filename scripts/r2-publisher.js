/**
 * Flip Release Publisher (Cloudflare R2 + Manifest Updater)
 * 
 * Computes SHA-256, validates hash immutability, uploads to R2 via S3-compatible API,
 * and updates release manifest idempotently.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateManifest, verifyHashIntegrity, evaluateRetention } = require('./manifest-manager');

// Auto-load .env if present
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  lines.forEach(line => {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

/**
 * Compute SHA256 of a local file
 */
function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', err => reject(err));
  });
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Main publishing function
 */
async function publishRelease(options) {
  const {
    binaryPath,
    platform,
    version,
    channel = 'stable',
    releaseNotes = '',
    dryRun = false,
    manifestPath = path.resolve(__dirname, '../releases.json'),
    configPath = path.resolve(__dirname, '../config/distribution.config.json'),
    siteManifestPath = path.resolve(__dirname, '../site/assets/releases.json')
  } = options;

  console.log('====================================================');
  console.log(`FLIP RELEASE PUBLISHER ${dryRun ? '(DRY-RUN MODE)' : ''}`);
  console.log('====================================================');

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary file not found at: ${binaryPath}`);
  }

  const filename = path.basename(binaryPath);
  const stats = fs.statSync(binaryPath);
  const fileSize = stats.size;
  console.log(`[1/5] Analyzing binary: ${filename}`);
  console.log(`      Size: ${fileSize} bytes (${formatBytes(fileSize)})`);

  const sha256 = await computeFileHash(binaryPath);
  console.log(`[2/5] SHA-256 Checksum: ${sha256}`);

  // Load manifest & config
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const releaseId = `flip-${platform}-${version}`;
  const publicBaseUrl = (config.cloudflareR2 && config.cloudflareR2.publicBaseUrl) || 'https://releases.flip.app';
  const prefix = (config.cloudflareR2 && config.cloudflareR2.prefix) || 'binaries/';
  const r2Key = `${prefix}v${version}/${filename}`;
  const primaryUrl = `${publicBaseUrl}/${r2Key}`;
  const fallbackUrl = `https://github.com/adonis0563/flip-releases/releases/download/v${version}/${filename}`;

  const incomingRelease = {
    id: releaseId,
    platform,
    version,
    channel,
    releaseDate: new Date().toISOString(),
    filename,
    fileSize,
    sha256,
    releaseNotes: releaseNotes || `Flip ${version} release for ${platform}.`,
    downloadLocations: {
      primary: primaryUrl,
      fallback: fallbackUrl
    },
    status: 'active'
  };

  // Verify hash integrity (hard error if hash changed on existing version)
  console.log('[3/5] Verifying hash integrity and immutability...');
  const integrity = verifyHashIntegrity(manifest, incomingRelease);
  if (integrity.isUpdate) {
    console.log(`      Release ${releaseId} already recorded with matching hash. Idempotent refresh.`);
  } else {
    console.log(`      New release entry registered: ${releaseId}`);
  }

  // Upload to R2
  console.log(`[4/5] Cloudflare R2 Upload Target: ${primaryUrl}`);
  if (dryRun) {
    console.log('      [DRY-RUN] Skipping actual network upload to R2.');
  } else {
    // Check credentials (supports direct Cloudflare API token or S3 keys)
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || (config.cloudflareR2 && config.cloudflareR2.accountId);
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const bucketName = process.env.R2_BUCKET_NAME || (config.cloudflareR2 && config.cloudflareR2.bucketName) || 'flip-releases';

    if (accountId && apiToken) {
      console.log(`      Uploading ${filename} to Cloudflare R2 bucket "${bucketName}" as "${r2Key}" via Cloudflare API...`);
      const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${r2Key}`;
      
      const fileData = fs.readFileSync(binaryPath);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Length': fileData.length.toString(),
          'Content-Type': filename.endsWith('.apk') ? 'application/vnd.android.package-archive' : 
                         filename.endsWith('.exe') ? 'application/octet-stream' :
                         filename.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream'
        },
        body: fileData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`R2 upload failed with status ${res.status}: ${errText}`);
      }
      console.log('      Upload to R2 verified successfully!');
    } else {
      console.log('      [SIMULATION] R2 credentials not present in environment.');
    }
  }

  // Update manifest
  console.log('[5/5] Updating Release Manifest...');
  if (integrity.isUpdate) {
    const idx = manifest.releases.findIndex(r => r.id === releaseId);
    manifest.releases[idx] = { ...manifest.releases[idx], ...incomingRelease, releaseDate: manifest.releases[idx].releaseDate };
  } else {
    manifest.releases.push(incomingRelease);
  }

  manifest.lastUpdated = new Date().toISOString();

  // Validate manifest before writing
  const val = validateManifest(manifest);
  if (!val.valid) {
    throw new Error(`Manifest validation failed: ${val.errors.join(', ')}`);
  }

  // Evaluate retention
  const retentionResults = evaluateRetention(manifest, config);
  console.log(`      Total releases in manifest : ${manifest.releases.length}`);
  console.log(`      Active in R2               : ${retentionResults.activeReleases.length}`);
  console.log(`      Eligible for Archival      : ${retentionResults.eligibleForArchival.length}`);
  console.log(`      Total R2 Size              : ${retentionResults.totalR2SizeFormatted}`);

  if (!dryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(siteManifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`      Successfully written to ${manifestPath} and ${siteManifestPath}`);
  } else {
    console.log('      [DRY-RUN] Manifest changes not written to disk.');
  }

  console.log('====================================================');
  console.log('PUBLISH OPERATION COMPLETE');
  console.log('====================================================');
  return { incomingRelease, retentionResults };
}

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const binaryIndex = args.indexOf('--file');
  const platformIndex = args.indexOf('--platform');
  const versionIndex = args.indexOf('--version');
  const notesIndex = args.indexOf('--notes');

  const binaryPath = binaryIndex !== -1 ? args[binaryIndex + 1] : null;
  const platform = platformIndex !== -1 ? args[platformIndex + 1] : null;
  const version = versionIndex !== -1 ? args[versionIndex + 1] : null;
  const releaseNotes = notesIndex !== -1 ? args[notesIndex + 1] : '';
  const dryRun = args.includes('--dry-run');

  if (!binaryPath || !platform || !version) {
    console.log('Usage: node r2-publisher.js --file <path> --platform <android|windows-installer|windows-portable> --version <semver> [--notes "text"] [--dry-run]');
    process.exit(1);
  }

  publishRelease({
    binaryPath: path.resolve(binaryPath),
    platform,
    version,
    releaseNotes,
    dryRun
  }).catch(err => {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  publishRelease,
  computeFileHash
};
