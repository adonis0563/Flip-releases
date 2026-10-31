/**
 * Automated Verification Test Suite for Flip Release System
 * 
 * Tests:
 * 1. Manifest Schema Validation
 * 2. Hash Mismatch Tamper Rejection (Hard error)
 * 3. Config-Driven Retention & Archival Eligibility Calculation
 * 4. Idempotency (repeated runs do not duplicate or corrupt entries)
 * 5. Dry-Run Safety (no deletions without explicit authorization)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  validateManifest,
  verifyHashIntegrity,
  evaluateRetention,
  applyRetentionToManifest
} = require('../scripts/manifest-manager');

const { runArchivalWorkflow } = require('../scripts/drive-archival');

let totalTests = 0;
let passedTests = 0;

function it(description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function itAsync(description, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
  }
}

console.log('====================================================');
console.log('RUNNING FLIP DISTRIBUTION SYSTEM TEST SUITE');
console.log('====================================================\n');

// ------------------------------------------------------------------
// Test Group 1: Manifest Schema Validation
// ------------------------------------------------------------------
console.log('Suite 1: Schema & Manifest Validation');

it('should validate the production releases.json successfully', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../releases.json'), 'utf8'));
  const result = validateManifest(manifest);
  assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
});

it('should reject manifest missing required fields (e.g. appName or schemaVersion)', () => {
  const invalid = { schemaVersion: '1.0.0', releases: [] };
  const result = validateManifest(invalid);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('appName')));
});

it('should reject invalid sha256 checksum format (not 64-char hex)', () => {
  const invalid = {
    schemaVersion: '1.0.0',
    appName: 'Flip',
    lastUpdated: new Date().toISOString(),
    releases: [
      {
        id: 'flip-android-badhash',
        platform: 'android',
        version: '1.0.0',
        channel: 'stable',
        releaseDate: new Date().toISOString(),
        filename: 'Flip.apk',
        fileSize: 1000,
        sha256: 'not-a-valid-hex-hash',
        releaseNotes: 'Bad hash test',
        downloadLocations: { primary: 'https://example.com' },
        status: 'active'
      }
    ]
  };
  const result = validateManifest(invalid);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('sha256')));
});

// ------------------------------------------------------------------
// Test Group 2: Hash Mismatch / Tamper Protection
// ------------------------------------------------------------------
console.log('\nSuite 2: Hash Immutability & Overwrite Protection');

it('should allow idempotent updates when hash matches existing release', () => {
  const manifest = {
    schemaVersion: '1.0.0',
    appName: 'Flip',
    lastUpdated: new Date().toISOString(),
    releases: [
      {
        id: 'flip-android-1.0.0',
        platform: 'android',
        version: '1.0.0',
        filename: 'Flip.apk',
        sha256: '048520afaab0b6ab3005067a07a577bc8ddf862c83ec5a37e47c5a3545fabc57'
      }
    ]
  };

  const incomingSameHash = {
    id: 'flip-android-1.0.0',
    platform: 'android',
    version: '1.0.0',
    filename: 'Flip.apk',
    sha256: '048520afaab0b6ab3005067a07a577bc8ddf862c83ec5a37e47c5a3545fabc57'
  };

  const check = verifyHashIntegrity(manifest, incomingSameHash);
  assert.strictEqual(check.isUpdate, true);
});

it('should throw HARD ERROR when incoming release has differing SHA-256 for same version', () => {
  const manifest = {
    schemaVersion: '1.0.0',
    appName: 'Flip',
    lastUpdated: new Date().toISOString(),
    releases: [
      {
        id: 'flip-android-1.0.0',
        platform: 'android',
        version: '1.0.0',
        filename: 'Flip.apk',
        sha256: '048520afaab0b6ab3005067a07a577bc8ddf862c83ec5a37e47c5a3545fabc57'
      }
    ]
  };

  const incomingTampered = {
    id: 'flip-android-1.0.0',
    platform: 'android',
    version: '1.0.0',
    filename: 'Flip.apk',
    sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  };

  assert.throws(() => {
    verifyHashIntegrity(manifest, incomingTampered);
  }, /SECURITY ERROR: HASH MISMATCH/);
});

// ------------------------------------------------------------------
// Test Group 3: Retention & Archival Eligibility Logic
// ------------------------------------------------------------------
console.log('\nSuite 3: Retention & Archival Eligibility Logic');

it('should keep latest two stable releases per platform and flag older as eligible_for_archival', () => {
  const dummyManifest = {
    schemaVersion: '1.0.0',
    appName: 'Flip',
    lastUpdated: new Date().toISOString(),
    releases: [
      {
        id: 'android-1.0.0',
        platform: 'android',
        version: '1.0.0',
        channel: 'stable',
        releaseDate: '2026-01-01T00:00:00Z',
        filename: 'Flip-1.0.0.apk',
        fileSize: 50000000,
        sha256: '0000000000000000000000000000000000000000000000000000000000000001',
        releaseNotes: 'v1.0.0',
        downloadLocations: { primary: 'https://cdn.example.com/1.0.0.apk' },
        status: 'active'
      },
      {
        id: 'android-1.1.0',
        platform: 'android',
        version: '1.1.0',
        channel: 'stable',
        releaseDate: '2026-02-01T00:00:00Z',
        filename: 'Flip-1.1.0.apk',
        fileSize: 50000000,
        sha256: '0000000000000000000000000000000000000000000000000000000000000002',
        releaseNotes: 'v1.1.0',
        downloadLocations: { primary: 'https://cdn.example.com/1.1.0.apk' },
        status: 'active'
      },
      {
        id: 'android-1.2.0',
        platform: 'android',
        version: '1.2.0',
        channel: 'stable',
        releaseDate: '2026-03-01T00:00:00Z',
        filename: 'Flip-1.2.0.apk',
        fileSize: 50000000,
        sha256: '0000000000000000000000000000000000000000000000000000000000000003',
        releaseNotes: 'v1.2.0',
        downloadLocations: { primary: 'https://cdn.example.com/1.2.0.apk' },
        status: 'active'
      }
    ]
  };

  const config = {
    retention: { maxStableReleasesPerPlatform: 2 },
    googleDrive: { enabled: false }
  };

  const evaluation = evaluateRetention(dummyManifest, config);

  // v1.2.0 and v1.1.0 are kept active (top 2)
  const activeIds = evaluation.activeReleases.map(r => r.id);
  assert.ok(activeIds.includes('android-1.2.0'));
  assert.ok(activeIds.includes('android-1.1.0'));

  // v1.0.0 (3rd oldest) is flagged eligible for archival
  const eligibleIds = evaluation.eligibleForArchival.map(r => r.id);
  assert.ok(eligibleIds.includes('android-1.0.0'));
});

it('should never remove binaries from R2 when Google Drive is disabled', () => {
  const dummyManifest = {
    schemaVersion: '1.0.0',
    appName: 'Flip',
    lastUpdated: new Date().toISOString(),
    releases: [
      { id: 'rel-1', platform: 'android', version: '1.0.0', channel: 'stable', releaseDate: '2026-01-01T00:00:00Z', fileSize: 100, sha256: '0000000000000000000000000000000000000000000000000000000000000001', downloadLocations: { primary: 'https://test' }, status: 'active', filename: 'f1.apk', releaseNotes: 'r1' },
      { id: 'rel-2', platform: 'android', version: '1.1.0', channel: 'stable', releaseDate: '2026-02-01T00:00:00Z', fileSize: 100, sha256: '0000000000000000000000000000000000000000000000000000000000000002', downloadLocations: { primary: 'https://test' }, status: 'active', filename: 'f2.apk', releaseNotes: 'r2' },
      { id: 'rel-3', platform: 'android', version: '1.2.0', channel: 'stable', releaseDate: '2026-03-01T00:00:00Z', fileSize: 100, sha256: '0000000000000000000000000000000000000000000000000000000000000003', downloadLocations: { primary: 'https://test' }, status: 'active', filename: 'f3.apk', releaseNotes: 'r3' }
    ]
  };

  const config = {
    retention: { maxStableReleasesPerPlatform: 2 },
    googleDrive: { enabled: false }
  };

  const evaluation = evaluateRetention(dummyManifest, config);
  assert.strictEqual(evaluation.driveEnabled, false);
  // Total size still includes eligible releases (they stay downloadable from R2)
  assert.strictEqual(evaluation.totalR2SizeBytes, 300);
  assert.ok(evaluation.actionsPlanned.every(a => a.r2Action.includes('Preserve in R2')));
});

// ------------------------------------------------------------------
// Test Group 4: Google Drive Archival Safety & Dry Run
// ------------------------------------------------------------------
console.log('\nSuite 4: Archival Safety & Dry-Run Enforcement');

itAsync('should abort archival rotation if googleDrive.enabled is false', async () => {
  const result = await runArchivalWorkflow({
    configPath: path.resolve(__dirname, '../config/distribution.config.json'),
    manifestPath: path.resolve(__dirname, '../releases.json'),
    isLive: false
  });
  assert.strictEqual(result.status, 'skipped');
  assert.strictEqual(result.reason, 'drive_archival_disabled');
});

itAsync('should simulate archival without deleting R2 objects in dry-run mode', async () => {
  const tempManifestPath = path.resolve(__dirname, 'temp_manifest.json');
  const tempConfigPath = path.resolve(__dirname, 'temp_config.json');

  const testManifest = {
    schemaVersion: '1.0.0',
    appName: 'Flip',
    lastUpdated: new Date().toISOString(),
    releases: [
      { id: 'a1', platform: 'android', version: '1.0.0', channel: 'stable', releaseDate: '2026-01-01T00:00:00Z', fileSize: 10, sha256: 'a'.repeat(64), downloadLocations: { primary: 'https://cdn/1' }, status: 'active', filename: '1.apk', releaseNotes: '1' },
      { id: 'a2', platform: 'android', version: '1.1.0', channel: 'stable', releaseDate: '2026-02-01T00:00:00Z', fileSize: 10, sha256: 'b'.repeat(64), downloadLocations: { primary: 'https://cdn/2' }, status: 'active', filename: '2.apk', releaseNotes: '2' },
      { id: 'a3', platform: 'android', version: '1.2.0', channel: 'stable', releaseDate: '2026-03-01T00:00:00Z', fileSize: 10, sha256: 'c'.repeat(64), downloadLocations: { primary: 'https://cdn/3' }, status: 'active', filename: '3.apk', releaseNotes: '3' }
    ]
  };

  const testConfig = {
    retention: { maxStableReleasesPerPlatform: 2 },
    googleDrive: { enabled: true, dryRun: true, archiveFolderId: 'fake_folder' }
  };

  fs.writeFileSync(tempManifestPath, JSON.stringify(testManifest, null, 2));
  fs.writeFileSync(tempConfigPath, JSON.stringify(testConfig, null, 2));

  try {
    const res = await runArchivalWorkflow({
      manifestPath: tempManifestPath,
      configPath: tempConfigPath,
      isLive: false,
      confirmDeletion: false,
      forceEnableForTesting: true
    });

    assert.strictEqual(res.status, 'completed');
    assert.ok(res.results.some(r => r.id === 'a1' && r.status === 'dry_run_success'));
  } finally {
    if (fs.existsSync(tempManifestPath)) fs.unlinkSync(tempManifestPath);
    if (fs.existsSync(tempConfigPath)) fs.unlinkSync(tempConfigPath);
  }
});

// ------------------------------------------------------------------
// Test Group 5: Admin Auth, Recovery Link & Password Manager Compliance
// ------------------------------------------------------------------
console.log('\nSuite 5: Admin Login, Link Recovery & Password Manager Attributes');

it('should include Google Password Manager attributes, password visibility toggles, and link-based reset form in admin/index.html', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');
  assert.ok(!html.includes('id="otp-code"'), '6-digit OTP input should be removed');
  assert.ok(html.includes('id="login-email" name="username"') && html.includes('autocomplete="username"'), 'Login email must have name=username and autocomplete=username');
  assert.ok(html.includes('id="login-pass" name="password"') && html.includes('autocomplete="current-password"'), 'Login password must have name=password and autocomplete=current-password');
  assert.ok(html.includes('id="new-pass" name="new-password"') && html.includes('autocomplete="new-password"'), 'New password must have name=new-password and autocomplete=new-password');
  assert.ok(html.includes("togglePasswordVisibility('login-pass'"), 'Login password must have visibility toggle button');
  assert.ok(html.includes("togglePasswordVisibility('new-pass'"), 'New password must have visibility toggle button');
  assert.ok(html.includes("togglePasswordVisibility('confirm-pass'"), 'Confirm password must have visibility toggle button');
  assert.ok(html.includes('handleUpdatePassword(event)'), 'Reset form must call handleUpdatePassword(event)');
});

itAsync('should enforce generic "incorrect credentials" message, detect recovery link hash, and update password via link flow', async () => {
  const cryptoModule = require('crypto');
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  global.crypto = {
    subtle: {
      digest: async (algo, data) => {
        return cryptoModule.createHash('sha256').update(Buffer.from(data)).digest();
      }
    }
  };
  global.window = {
    location: {
      origin: 'https://flip-admin.pages.dev',
      pathname: '/',
      hash: '#access_token=mock_token_123&type=recovery',
      search: ''
    },
    dispatchEvent: () => {},
    addEventListener: () => {}
  };

  delete require.cache[require.resolve('../admin/js/backend.js')];
  const backend = require('../admin/js/backend.js');

  assert.strictEqual(backend.isRecoveryRedirect, true, 'Should detect #access_token=...&type=recovery in URL hash');

  await assert.rejects(() => backend.login('wrong@example.com', 'anypass123'), /incorrect credentials/);
  await assert.rejects(() => backend.requestPasswordReset('wrong@example.com'), /incorrect credentials/);

  const resetRes = await backend.requestPasswordReset('rajiadinoyi0@gmail.com');
  assert.strictEqual(resetRes.success, true);

  await backend.updatePassword('NewSecurePass2026!');
  assert.strictEqual(backend.isRecoveryRedirect, false, 'isRecoveryRedirect should be cleared after password update');

  const session = await backend.getSession();
  assert.ok(session && session.authenticated === true, 'Session should be authenticated after updatePassword');

  await assert.rejects(() => backend.login('rajiadinoyi0@gmail.com', 'WrongPass123!'), /incorrect credentials/);

  const user = await backend.login('rajiadinoyi0@gmail.com', 'NewSecurePass2026!');
  assert.strictEqual(user.email, 'rajiadinoyi0@gmail.com');
});

// ------------------------------------------------------------------
// Test Summary
// ------------------------------------------------------------------
setTimeout(() => {
  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} Tests Passed`);
  console.log('====================================================');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}, 100);
