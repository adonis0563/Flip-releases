# Cloudflare Deployment Guide: Pages & R2

This guide outlines the production deployment setup for Flip's public download website (**Cloudflare Pages**) and binary distribution storage (**Cloudflare R2**).

---

## 1. Cloudflare R2 Binary Storage Setup

Cloudflare R2 provides S3-compatible, zero-egress fee object storage for hosting Android APKs and Windows executables.

### A. Create the Bucket
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left navigation, select **R2 Storage** → **Create bucket**.
3. Bucket name: `flip-releases`.
4. Location: Automatic (or closest to your primary audience).
5. Click **Create Bucket**.

### B. Configure Public Access & Custom Domain
By default, R2 buckets are private. Configure public read access:
1. Open the `flip-releases` bucket settings → **Settings** tab.
2. Under **Public Access**, choose either:
   - **Custom Domain**: Connect a domain/subdomain (Recommended: `releases.flip.app`), **or**
   - **R2.dev subdomain**: Enable the public `r2.dev` URL for testing.
3. If using a Custom Domain, Cloudflare will automatically provision an SSL certificate and configure CDN caching edge rules.

### C. CORS Configuration (Allows Browser Direct Downloads & Byte Resuming)
In bucket **Settings** → **CORS Policy**, add:
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```
*Why this permission is needed:* Flip's static website and client download managers issue `HEAD` and range requests to verify checksums and file sizes before initiating downloads.

### D. Generate R2 API Token (Minimal Scope)
To allow GitHub Actions / automated scripts to upload release binaries:
1. Go to **R2** → **Manage R2 API Tokens** → **Create API token**.
2. Token Name: `flip-r2-publisher`.
3. Permissions: **Object Read & Write**.
4. Specify bucket: Apply only to `flip-releases` (Principle of Least Privilege).
5. TTL: As appropriate for your security policy.
6. Copy the following credentials into your GitHub Repository Secrets:
   - `R2_ACCOUNT_ID`: Your Cloudflare Account ID (found on your dashboard URL or R2 overview).
   - `R2_ACCESS_KEY_ID`: S3 Access Key ID.
   - `R2_SECRET_ACCESS_KEY`: S3 Secret Access Key.
   - `R2_BUCKET_NAME`: `flip-releases`.

---

## 2. Cloudflare Pages Setup

### A. Public Download Website (`flip.app` or `download.flip.app`)
1. In Cloudflare Dashboard, go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Select repository: `adonis0563/flip-releases`.
3. Configure build settings:
   - **Project Name**: `flip-download`
   - **Framework preset**: `None`
   - **Build command**: Leave blank
   - **Build output directory**: `site`
4. Set custom domain: `download.flip.app` or `flip.app`.
5. Note: The public site bundle contains zero admin files or references.

### B. Dedicated Admin Operations Portal (`admin.flip.app`)
1. Go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Select the same repository: `adonis0563/flip-releases`.
3. Configure build settings:
   - **Project Name**: `flip-admin`
   - **Framework preset**: `None`
   - **Build command**: Leave blank
   - **Build output directory**: `admin`
4. Connect custom domain: **`admin.flip.app`**.
5. Enable **Cloudflare Zero Trust Access** on the entire application:
   - Route: `admin.flip.app/*`
   - Rule: Require email verification PIN for `flipdevelopmentsupport@gmail.com`.
   - Result: Unauthorized visitors receive HTTP 403 Forbidden at the Cloudflare edge; the admin HTML is never delivered to unauthenticated clients.

---

## 3. GitHub Actions CI Secrets Summary

In `https://github.com/adonis0563/flip-releases/settings/secrets/actions`, configure:

| Secret Name | Purpose | Scope / Permissions |
| :--- | :--- | :--- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier | Account identifier |
| `CLOUDFLARE_API_TOKEN` | Deploys Pages static site | `Cloudflare Pages: Edit` |
| `R2_ACCESS_KEY_ID` | Uploads binaries to R2 | Bucket `flip-releases` only |
| `R2_SECRET_ACCESS_KEY` | S3 signing secret for R2 | Object Read/Write |
| `R2_BUCKET_NAME` | Target storage bucket | `flip-releases` |
