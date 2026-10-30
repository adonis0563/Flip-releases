# Google Drive Archival Setup (Optional / Disabled by Default)

> [!IMPORTANT]
> **Google Drive is a last-resort fallback** designed to run only when specifically enabled.
> It ships **DISABLED BY DEFAULT** behind a configuration flag (`googleDrive.enabled: false` in `config/distribution.config.json`).
> **No Google credentials or OAuth tokens are required** until you intentionally activate this feature.

---

## Why Drive Archival is Disabled by Default

1. **Storage Behavior Differences**: Google Drive is personal cloud storage, not an edge CDN. Large files (e.g., Flip's ~80 MB APKs and executables) trigger Google Drive confirmation / virus-scan bypass interstitial screens, rather than direct instant HTTP downloads.
2. **Download Quotas**: Public files on Google Drive are subject to bandwidth and daily download limits. Cloudflare R2 has zero egress fees and no rate-limit drops for public visitors.
3. **Safety & Zero Unexpected Charges**: While Drive is disabled, older releases beyond the retention window remain active and safely downloadable from Cloudflare R2, labeled clearly on the website as *Eligible for Archival*.

---

## Architecture & Storage Quota Caveat

### The Service Account Quota Problem
In Google Cloud Platform, **Service Accounts do NOT have independent Google Drive storage quota**. If an automated script authenticates as a Service Account and attempts to create a file in the root of its own Drive, Google returns an error (`403: Storage quota exceeded`).

### The Solution: Shared Dedicated Folder
1. Create a dedicated folder inside a real Google Workspace or personal Google account (e.g. named `Flip-Historical-Releases`).
2. Share this folder with the Service Account email address, granting the role of **Editor**.
3. All files uploaded by the script are created inside this parent folder ID, utilizing the human account's storage.

---

## Setup Steps (Only When Activating Drive Archival)

### Step 1: Create Google Cloud Project & Enable Drive API
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project named `flip-distribution`.
3. Navigate to **APIs & Services** → **Library**.
4. Search for **Google Drive API** and click **Enable**.

### Step 2: Create a Service Account with Minimal Permissions
1. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **Service Account**.
2. Service account name: `flip-archive-bot`.
3. Do not grant broad project-level IAM roles (leave empty).
4. Go to **Keys** tab for the newly created service account → **Add Key** → **Create new key** → **JSON**.
5. Save the JSON key securely (NEVER commit this file to Git!).

### Step 3: Create and Share Dedicated Archive Folder
1. Open [Google Drive](https://drive.google.com/) under your administrator account.
2. Create a new folder: `Flip-Historical-Releases`.
3. Right-click the folder → **Share**:
   - Add the service account email (e.g., `flip-archive-bot@flip-distribution.iam.gserviceaccount.com`) as **Editor**.
   - Under *General access*, select **Anyone with the link** and set role to **Viewer** (allows public downloads).
4. Copy the Folder ID from the URL:
   `https://drive.google.com/drive/folders/<FOLDER_ID_HERE>`

### Step 4: Minimal OAuth Scopes
When configured, the script requests only:
`https://www.googleapis.com/auth/drive.file`
*Why this scope:* It restricts the application to creating and managing files that the application itself created or that were shared with it, never granting access to the rest of the account's Drive.

### Step 5: Enable in Configuration
In `config/distribution.config.json`:
```json
{
  "googleDrive": {
    "enabled": true,
    "dryRun": true,
    "archiveFolderId": "YOUR_FOLDER_ID_HERE"
  }
}
```

### Step 6: Safe Dry-Run Testing
Always test in dry-run mode first:
```bash
node scripts/drive-archival.js
```
The script will simulate the full verification without uploading or deleting real binaries. Real deletion from R2 requires the `--confirm-deletion` flag and explicit authorization.
