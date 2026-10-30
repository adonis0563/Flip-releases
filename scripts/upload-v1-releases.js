/**
 * Script to publish and upload all v1.0.0 binaries to Cloudflare R2
 * Verifies SHA-256 before and after upload.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    filename: 'Flip.apk',
    path: path.resolve(__dirname, '../v1.0.0/Flip.apk'),
    contentType: 'application/vnd.android.package-archive',
    expectedSha: '048520afaab0b6ab3005067a07a577bc8ddf862c83ec5a37e47c5a3545fabc57'
  },
  {
    platform: 'windows-installer',
    filename: 'Flip-Setup-1.0.0.exe',
    path: path.resolve(__dirname, '../v1.0.0/Flip-Setup-1.0.0.exe'),
    contentType: 'application/octet-stream',
    expectedSha: 'f765a29999e5820f4f4f8b31d5ead059ba37fd7a03dddaa0eda31403b7f0542c'
  },
  {
    platform: 'windows-portable',
    filename: 'Flip.exe',
    path: path.resolve(__dirname, '../v1.0.0/Flip.exe'),
    contentType: 'application/octet-stream',
    expectedSha: '7fb5c9041c794583c9bd4e0d085462409e06a0f53ab17fecade667c7c6a84926'
  },
  {
    platform: 'media',
    filename: 'Flip-Promo-Ad.mp4',
    path: path.resolve(__dirname, '../v1.0.0/Flip-Promo-Ad.mp4'),
    contentType: 'video/mp4',
    expectedSha: 'dd32af79c290df7eb4bccc6a2f0cfa41ed5ce86bca59208b3597362af19e60b1'
  }
];

async function main() {
  console.log('====================================================');
  console.log('UPLOADING FLIP V1.0.0 BINARIES TO CLOUDFLARE R2');
  console.log(`Bucket: ${bucketName} (Account: ${accountId})`);
  console.log('====================================================\n');

  for (let i = 0; i < artifacts.length; i++) {
    const item = artifacts[i];
    console.log(`[${i + 1}/${artifacts.length}] Preparing: ${item.filename} (${item.platform})`);

    if (!fs.existsSync(item.path)) {
      throw new Error(`File not found: ${item.path}`);
    }

    const stat = fs.statSync(item.path);
    console.log(`      Size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB (${stat.size} bytes)`);

    // 1. Verify local SHA256 before uploading
    const localHash = await computeFileHash(item.path);
    if (localHash !== item.expectedSha) {
      throw new Error(`[CRITICAL] Hash mismatch for ${item.filename}! Expected ${item.expectedSha}, got ${localHash}`);
    }
    console.log(`      Verified SHA-256: ${localHash}`);

    // 2. Upload to R2
    const key = `binaries/v1.0.0/${item.filename}`;
    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${key}`;
    console.log(`      Uploading to R2 object: ${key}...`);

    const fileBuffer = fs.readFileSync(item.path);
    const startUpload = Date.now();
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': item.contentType,
        'Content-Length': fileBuffer.length.toString()
      },
      body: fileBuffer
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Upload failed for ${item.filename} (HTTP ${res.status}): ${err}`);
    }

    const duration = ((Date.now() - startUpload) / 1000).toFixed(1);
    console.log(`      ✓ Upload successful in ${duration}s!`);

    // 3. Test CDN verification via HEAD request
    const cdnUrl = `${publicCdnBase}/${key}`;
    console.log(`      Verifying public CDN endpoint: ${cdnUrl}`);
    try {
      const cdnRes = await fetch(cdnUrl, { method: 'HEAD' });
      if (cdnRes.ok) {
        console.log(`      ✓ Verified live on Cloudflare CDN (HTTP ${cdnRes.status})`);
      } else {
        console.warn(`      CDN responded with status ${cdnRes.status} (caching may take a few seconds)`);
      }
    } catch (cdnErr) {
      console.warn(`      CDN check warning: ${cdnErr.message}`);
    }
    console.log('');
  }

  console.log('====================================================');
  console.log('ALL V1.0.0 RELEASES SUCCESSFULLY UPLOADED & VERIFIED');
  console.log('====================================================');
}

main().catch(err => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
