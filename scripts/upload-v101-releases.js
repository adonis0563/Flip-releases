/**
 * Upload Flip v1.0.1 binaries to Cloudflare R2, update releases.json, and sync Supabase.
 * Uses native streaming https.request for robust large file transfers.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawn } = require('child_process');

// Load environment variables from .env
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

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const bucketName = process.env.R2_BUCKET_NAME || 'flip-releases';
const publicCdnBase = 'https://pub-6c3c9d95f8fb414aa1fc8e027fb62601.r2.dev';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!accountId || !apiToken) {
  console.error('[ERROR] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in .env');
  process.exit(1);
}

function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', err => reject(err));
  });
}

const artifacts = [
  {
    platform: 'android',
    platformName: 'Android',
    version: '1.0.1',
    format: 'APK (Universal)',
    filename: 'Flip.apk',
    sourcePath: 'c:\\Users\\User\\Downloads\\Flip\\Flip(1).apk',
    contentType: 'application/vnd.android.package-archive',
    compatibility: 'Android 10+ (API 29-36)',
    notes: 'Flip v1.0.1: Dynamic PC/Hotspot/Wi-Fi Direct labels, fast connection loss detection, bidirectional BYE protocol, background IP monitoring, storage categorization, and performance polish.'
  },
  {
    platform: 'windows-installer',
    platformName: 'Windows Setup',
    version: '1.0.1',
    format: 'Setup Wizard (.exe)',
    filename: 'Flip-Setup-1.0.1.exe',
    sourcePath: path.resolve(__dirname, '../../flip/flip-windows/Flip-Setup-1.0.1.exe'),
    contentType: 'application/octet-stream',
    compatibility: 'Windows 10 / 11 (64-bit)',
    notes: 'Flip v1.0.1: Full installer with desktop shortcuts, non-blocking 1.5s disconnect, clean BYE protocol, dynamic QR scanner, and automated firewall rules.'
  },
  {
    platform: 'windows-portable',
    platformName: 'Windows Portable',
    version: '1.0.1',
    format: 'Standalone (.exe)',
    filename: 'Flip.exe',
    sourcePath: path.resolve(__dirname, '../../flip/flip-windows/publish/app/Flip.exe'),
    contentType: 'application/octet-stream',
    compatibility: 'Windows 10 / 11 (x64)',
    notes: 'Flip v1.0.1: Portable standalone executable. Instant disconnect without freezing, full duplex file & text transfers, no installation needed.'
  }
];

function streamUploadToR2(item) {
  return new Promise((resolve, reject) => {
    const key = `binaries/v1.0.1/${item.filename}`;
    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${key}`;

    const args = [
      '-sS',
      '--progress-bar',
      '--keepalive-time', '15',
      '--retry', '3',
      '-X', 'PUT',
      uploadUrl,
      '-H', `Authorization: Bearer ${apiToken}`,
      '-H', `Content-Type: ${item.contentType}`,
      '--data-binary', `@${item.sourcePath}`,
      '-w', '\nHTTP_CODE:%{http_code}'
    ];

    const proc = spawn('curl.exe', args);
    let output = '';

    proc.stdout.on('data', chunk => {
      output += chunk.toString();
    });

    proc.stderr.on('data', chunk => {
      process.stderr.write(chunk);
    });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`curl exited with code ${code}`));
      }
      const match = output.match(/HTTP_CODE:(\d+)/);
      const httpCode = match ? parseInt(match[1], 10) : 0;
      if (httpCode >= 200 && httpCode < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed for ${item.filename} (HTTP ${httpCode}): ${output}`));
      }
    });

    proc.on('error', err => reject(err));
  });
}

async function uploadItem(item) {
  const stat = fs.statSync(item.sourcePath);
  const size = stat.size;
  const hash = await computeFileHash(item.sourcePath);
  item.fileSize = size;
  item.sha256 = hash;

  console.log(`[UPLOAD] ${item.filename} (${(size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`         SHA-256: ${hash}`);

  const key = `binaries/v1.0.1/${item.filename}`;
  const cdnUrl = `${publicCdnBase}/${key}`;
  item.downloadUrl = cdnUrl;

  try {
    const headRes = await fetch(cdnUrl, { method: 'HEAD' });
    const cl = headRes.headers.get('content-length');
    if (headRes.ok && cl && parseInt(cl, 10) === size) {
      console.log(`         ✓ Already uploaded to R2 and verified on CDN (${cl} bytes): ${cdnUrl}`);
      return;
    }
  } catch (e) {
    // proceed with upload
  }

  console.log(`         Streaming to R2: ${key}...`);
  const t0 = Date.now();

  await streamUploadToR2(item);

  const duration = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n         ✓ R2 Upload finished in ${duration}s!`);

  // Verify CDN
  try {
    const cdnRes = await fetch(cdnUrl, { method: 'HEAD' });
    if (cdnRes.ok) {
      console.log(`         ✓ Verified live on CDN: ${cdnUrl}`);
    } else {
      console.log(`         CDN responded with status ${cdnRes.status} (propagating...)`);
    }
  } catch (e) {
    console.warn(`         CDN check warning: ${e.message}`);
  }
}

async function updateReleasesJson() {
  const releasesJsonPath = path.resolve(__dirname, '../releases.json');
  let data = { schemaVersion: '1.0.0', appName: 'Flip', releases: [] };
  if (fs.existsSync(releasesJsonPath)) {
    data = JSON.parse(fs.readFileSync(releasesJsonPath, 'utf8'));
  }

  data.lastUpdated = new Date().toISOString();

  artifacts.forEach(item => {
    const id = `flip-${item.platform}-1.0.1`;
    const existingIndex = data.releases.findIndex(r => r.id === id);
    const releaseObj = {
      id: id,
      platform: item.platform,
      version: '1.0.1',
      channel: 'stable',
      releaseDate: new Date().toISOString(),
      filename: item.filename,
      fileSize: item.fileSize,
      sha256: item.sha256,
      releaseNotes: item.notes,
      downloadLocations: {
        primary: item.downloadUrl,
        fallback: `https://github.com/adonis0563/flip/releases/download/v1.0.1/${item.filename}`
      },
      status: 'active',
      metadata: {
        compatibility: item.compatibility,
        architecture: 'x64'
      }
    };

    if (existingIndex >= 0) {
      data.releases[existingIndex] = releaseObj;
    } else {
      data.releases.unshift(releaseObj);
    }
  });

  fs.writeFileSync(releasesJsonPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[SUCCESS] Updated ${releasesJsonPath}`);
}

async function syncBackendDefaults() {
  const adminBackendPath = path.resolve(__dirname, '../admin/js/backend.js');
  const siteBackendPath = path.resolve(__dirname, '../site/js/backend.js');

  const newReleases = artifacts.map((item, idx) => ({
    id: `rel_${item.platform.replace(/-/g, '_')}_1_0_1`,
    platform: item.platform,
    platformName: item.platformName,
    version: '1.0.1',
    format: item.format,
    filename: item.filename,
    fileSize: item.fileSize,
    sha256: item.sha256,
    compatibility: item.compatibility,
    notes: item.notes,
    downloadUrl: item.downloadUrl,
    isPublished: true,
    orderIndex: idx,
    updatedAt: new Date().toISOString()
  }));

  console.log('[LOCAL DEFAULTS] Syncing DEFAULT_RELEASES in admin and site backend.js...');
  [adminBackendPath, siteBackendPath].forEach(filePath => {
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      const startTag = '  const DEFAULT_RELEASES = [';
      const endTag = '  ];';
      const startIdx = content.indexOf(startTag);
      if (startIdx !== -1) {
        const endIdx = content.indexOf(endTag, startIdx);
        if (endIdx !== -1) {
          const replacement = `  const DEFAULT_RELEASES = ${JSON.stringify(newReleases, null, 4)};`;
          content = content.slice(0, startIdx) + replacement + content.slice(endIdx + endTag.length);
          fs.writeFileSync(filePath, content, 'utf8');
          console.log(`   ✓ Updated ${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`);
        }
      }
    }
  });
}

async function syncSupabase() {
  if (!supabaseUrl || !supabaseKey) {
    console.log('[INFO] No Supabase credentials provided; skipping Supabase table sync.');
    return;
  }

  console.log('[SUPABASE] Checking Supabase releases table...');
  try {
    for (let i = 0; i < artifacts.length; i++) {
      const item = artifacts[i];
      const record = {
        id: `rel_${item.platform.replace(/-/g, '_')}_1_0_1`,
        platform: item.platform,
        platform_name: item.platformName,
        version: '1.0.1',
        format: item.format,
        filename: item.filename,
        file_size: item.fileSize,
        sha256: item.sha256,
        compatibility: item.compatibility,
        notes: item.notes,
        download_url: item.downloadUrl,
        is_published: true,
        order_index: i,
        updated_at: new Date().toISOString()
      };

      const res = await fetch(`${supabaseUrl}/rest/v1/releases`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(record)
      });

      if (res.ok) {
        console.log(`[SUPABASE] Synced ${item.filename} (HTTP ${res.status})`);
      } else {
        const text = await res.text();
        console.warn(`[SUPABASE] Table upsert response (${res.status}): ${text}`);
      }
    }
  } catch (err) {
    console.warn(`[SUPABASE] Sync warning: ${err.message}`);
  }
}

async function main() {
  console.log('========================================================');
  console.log('UPLOADING FLIP V1.0.1 RELEASES (ANDROID APK + PC FILES)');
  console.log('========================================================\n');

  for (const item of artifacts) {
    if (!fs.existsSync(item.sourcePath)) {
      throw new Error(`Source file missing: ${item.sourcePath}`);
    }
    await uploadItem(item);
    console.log('');
  }

  await updateReleasesJson();
  await syncBackendDefaults();
  await syncSupabase();

  console.log('\n========================================================');
  console.log('ALL V1.0.1 ARTIFACTS SUCCESSFULLY UPLOADED & CONFIGURED');
  console.log('========================================================');
}

main().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
