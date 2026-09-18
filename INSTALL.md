# KSeF 2.0 Accounting Platform - Deployment Guide

Complete guide for deploying the KSeF e-invoicing automation platform for an accounting company.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Setup](#2-project-setup)
3. [Generate Environment Configuration](#3-generate-environment-configuration)
4. [Build and Start the Stack](#4-build-and-start-the-stack)
5. [First-Time n8n Setup](#5-first-time-n8n-setup)
6. [Import Workflows](#6-import-workflows)
7. [Configure n8n Credentials](#7-configure-n8n-credentials)
8. [KSeF Tokens and Certificates](#8-ksef-tokens-and-certificates)
9. [Add Your First Client](#9-add-your-first-client)
10. [Test the Platform](#10-test-the-platform)
11. [Activate All Workflows](#11-activate-all-workflows)
12. [Production Deployment Checklist](#12-production-deployment-checklist)
13. [Maintenance and Operations](#13-maintenance-and-operations)

---

## 1. Prerequisites

### Hardware Requirements

| | Minimum | Recommended |
|---|---------|------------|
| RAM | 4 GB | 8 GB |
| CPU | 2 cores | 4 cores |
| Disk | 40 GB | 100 GB SSD |

Storage grows over time as invoices accumulate. Plan for ~1 GB per 100,000 invoices.

### Software Requirements

- **Docker Engine** 24.0+ — [Install Docker](https://docs.docker.com/engine/install/)
- **Docker Compose** v2 (plugin syntax: `docker compose`, not `docker-compose`)
- **Git** (for cloning the repository)
- **openssl** (for generating secure keys — pre-installed on Linux/macOS, available via Git Bash on Windows)
- **psql** (optional but recommended — can alternatively use the Docker container)

Verify your installations:
```bash
docker --version          # Docker Engine 24.0+
docker compose version    # Docker Compose v2.x
git --version
openssl version
```

### Network Requirements

- **Outbound HTTPS** to KSeF API:
  - Test: `ap-test.ksef.mf.gov.pl` (port 443)
  - Production: `api.ksef.mf.gov.pl` (port 443)
- **SMTP access** for sending alert emails and JPK reports (e.g., Gmail SMTP, company mail server)
- **Ports** used locally: 5432 (n8n Postgres), 5433 (KSeF Postgres), 5678 (n8n UI), 8090 (XAdES sidecar)

### KSeF Access

- A valid Polish NIP registered in the KSeF system
- Either an **API token** (obtained from KSeF portal) or a **PKCS12 certificate** (`.p12` file)

---

## 2. Project Setup

### Clone the Repository

```bash
git clone <your-repository-url> ksef-platform
cd ksef-platform
```

### Verify Directory Structure

```
ksef-platform/
├── docker-compose.yml          # Stack definition (4 services)
├── ksef-schema.sql             # Database schema (auto-runs on first start)
├── ksef-holidays-init.sql      # Polish holidays 2026-2028 (auto-runs on first start)
├── workflows/                  # 7 n8n workflow JSON files
│   ├── 01-send-alert.json
│   ├── 02-ksef-authenticate.json
│   ├── 03-health-check.json
│   ├── 04-ksef-invoice-retrieval.json
│   ├── 05-offline24-monitor.json
│   ├── 06-jpk-vat-preparation.json
│   └── 08-ksef-submit-test-invoice.json
├── xades-sidecar/              # Java XAdES-BES signing service (built by Docker)
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/
├── certificates/               # Place PKCS12 certs here (mounted into sidecar)
└── .env                        # Created in next step (NEVER commit this)
```

---

## 3. Generate Environment Configuration

### Create the `.env` File

The `.env` file contains 5 critical configuration values. Generate them using the commands below.

> **WARNING: The `N8N_ENCRYPTION_KEY` is used to encrypt ALL credentials stored in n8n. If this key is lost or changed after setup, all stored credentials become PERMANENTLY UNRECOVERABLE. Save this key in a password manager immediately after generating it.**

Generate each value:

```bash
# 1. N8N_ENCRYPTION_KEY — 32 random bytes, hex-encoded (64 characters)
echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)"

# 2. POSTGRES_PASSWORD — n8n's internal database password
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"

# 3. KSEF_DB_PASSWORD — KSeF platform database password
echo "KSEF_DB_PASSWORD=$(openssl rand -hex 16)"

# 4. N8N_API_KEY — API key for external integrations
echo "N8N_API_KEY=$(openssl rand -hex 24)"
```

Create the `.env` file with the generated values:

```bash
cat > .env << 'ENVEOF'
N8N_ENCRYPTION_KEY=<paste your 64-char hex key>
POSTGRES_PASSWORD=<paste your 32-char hex password>
KSEF_DB_PASSWORD=<paste your 32-char hex password>
KSEF_ENVIRONMENT=test
N8N_API_KEY=<paste your 48-char hex key>
ENVEOF
```

### Environment Variable Reference

| Variable | Purpose | Example |
|----------|---------|---------|
| `N8N_ENCRYPTION_KEY` | Encrypts n8n credentials at rest | `a3f2e1d4...` (64 hex chars) |
| `POSTGRES_PASSWORD` | Password for n8n's internal PostgreSQL | `d74ede0d...` (32 hex chars) |
| `KSEF_DB_PASSWORD` | Password for KSeF platform database (`ksef_app` user) | `faf36a94...` (32 hex chars) |
| `KSEF_ENVIRONMENT` | KSeF API target: `test` or `prod` | `test` |
| `N8N_API_KEY` | n8n REST API authentication key | `575cc0fe...` (48 hex chars) |
| `NEXT_PUBLIC_APP_URL` | Public origin of the portal, used in every emailed/redirect link (invites, reset, document requests, Stripe). No trailing slash | `https://portal.example.pl` |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Transactional e-mail. Unset = reset/invite/notification mail cannot be sent (the portal now says so instead of claiming success) | |
| `DIGEST_SECRET` / `NOTIFY_SECRET` | Shared secrets for `/api/digest` and `/api/notify/*` (`openssl rand -hex 32`) | |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_START/BIZNES/PRO` | Stripe billing | |
| `ANTHROPIC_API_KEY` | AI classification during client sync (Biznes/Pro) | |
| `IMAP_HOST/PORT/USER/PASSWORD`, `N8N_SYNC_WEBHOOK_URL` | Optional: shared mailbox for `/api/email/sync`; sync webhook | |

**The portal container reads none of these from a `.env` file** — `.dockerignore` excludes `.env*`, so
each variable must be listed in `docker-compose.yml`'s `portal` `environment:` block (all of the above
are, since round 15). Before that fix Stripe/Resend/`NEXT_PUBLIC_APP_URL`/`DIGEST_SECRET` could not reach
the container at all. Adding a new `process.env.X` to the portal means adding `X` to that block too;
`env-and-email-truthfulness.test.ts` fails if you forget. After editing `.env`, recreate the portal:
`docker compose up -d portal` (then `docker restart ksef_nginx`).

**Upload size:** nginx accepts request bodies up to 12 MB (`client_max_body_size` in `nginx/nginx.conf`,
default was 1 MB, which rejected real scanned invoices with a 413); the portal itself caps a document at
10 MB. Apply an nginx change with `docker exec ksef_nginx nginx -s reload`.

### Security

Add `.env` to `.gitignore` to prevent committing secrets:

```bash
echo ".env" >> .gitignore
echo "certificates/*.p12" >> .gitignore
```

---

## 4. Build and Start the Stack

### First Start

The first start builds the XAdES sidecar from source (takes 2-5 minutes):

```bash
docker compose up -d
```

### Verify All 4 Containers Are Running

```bash
docker compose ps
```

Expected output:
```
NAME            STATUS                 PORTS
ksef_db         Up (healthy)           0.0.0.0:5433->5432/tcp
n8n             Up                     0.0.0.0:5678->5678/tcp
n8n_postgres    Up (healthy)           0.0.0.0:5432->5432/tcp
xades_sidecar   Up                     0.0.0.0:8090->8090/tcp
```

### Verify Services

```bash
# XAdES sidecar health
curl http://localhost:8090/actuator/health
# Expected: {"status":"UP",...}

# n8n is responding
curl -s http://localhost:5678/healthz
# Expected: {"status":"ok"}

# KSeF database is accessible
docker exec ksef_db psql -U ksef_app -d ksef_platform -c "SELECT COUNT(*) FROM clients;"
# Expected: 0 (empty table on fresh install)
```

### Troubleshooting

If any container fails to start:

```bash
docker compose logs ksef_db         # Database init errors
docker compose logs n8n             # n8n startup errors
docker compose logs xades_sidecar   # Java build/runtime errors
docker compose logs postgres        # n8n internal DB errors
```

**Common issues:**
- Port conflict: Another service already using 5432, 5433, 5678, or 8090. Stop the conflicting service or change ports in `docker-compose.yml`.
- Low memory: The XAdES sidecar (Java) needs ~512 MB to build. Ensure Docker has at least 4 GB RAM allocated.
- Schema not loading: The `ksef-schema.sql` only runs on the FIRST start when the `ksef_db_data` volume is empty. If you need to re-initialize, remove the volume: `docker compose down -v` (WARNING: destroys all data).

---

## 5. First-Time n8n Setup

### Create Admin Account

1. Open `http://localhost:5678` in your browser
2. n8n will show the setup screen on first access
3. Enter your **email** and **password** — this is the n8n admin account
4. Complete the setup wizard

### Verify API Key

1. Go to **Settings** (gear icon) > **API**
2. You should see an API key already created (from `N8N_API_KEY` in `.env`)
3. This key is used for external API access to n8n

---

## 6. Import Workflows

The platform consists of 7 workflows that must be imported in a specific order (dependencies first).

> **Note:** `07-document-collection.json` (an unauthenticated webhook that wrote to `invoices`/
> `ocr_queue` for any NIP supplied in the payload, and that nothing in the codebase called) has been
> deleted rather than fixed. See `CLAUDE.md`'s Known Issues section.

### Import Order

| Order | File | Workflow Name | Why This Order |
|-------|------|---------------|----------------|
| 1 | `01-send-alert.json` | KSeF - Send Alert v2 | Other workflows call its webhook |
| 2 | `02-ksef-authenticate.json` | KSeF - Authenticate v2 | Invoice Retrieval calls this |
| 3 | `03-health-check.json` | KSeF - Health Check | Independent |
| 4 | `04-ksef-invoice-retrieval.json` | KSeF - Invoice Retrieval v2 | Depends on Authenticate |
| 5 | `05-offline24-monitor.json` | KSeF - Offline24 Monitor | Uses Send Alert |
| 6 | `06-jpk-vat-preparation.json` | KSeF - JPK_VAT Preparation | Uses Send Alert |
| 7 | `08-ksef-submit-test-invoice.json` | KSeF - Submit Test Invoice | Manual test tool |

### How to Import Each Workflow

For each workflow file:

1. In n8n, click **Add workflow** (+ icon in the sidebar)
2. Click the **three dots menu** (⋮) > **Import from file**
3. Select the JSON file from the `workflows/` directory
4. Click **Save** immediately after import
5. **Do NOT activate yet** — credentials must be configured first

> **Note:** After import, you will see credential errors on Postgres and Email nodes. This is expected — credentials from the original instance don't transfer. You'll fix this in the next step.

### Link Each Workflow's Error Path to Itself

`04-ksef-invoice-retrieval.json` (and the other workflows with an `On Error` node) contain an Error
Trigger node meant to catch unhandled failures and route them to an alert. n8n only invokes that
node when the workflow's own **Settings → Error Workflow** field points at a workflow — it does
nothing just by being present in the canvas (confirmed empirically: a disposable synthetic workflow
with the same shape produced zero error-path executions until `errorWorkflow` was set). Because
every import assigns fresh internal workflow IDs, this can't be baked into the tracked JSON — it
would silently point at a stale ID after the next re-import, the same class of problem as the
credential re-linking below. After importing each workflow that has an `On Error` node:

1. Open the workflow → **⋯ menu → Settings**
2. Set **Error Workflow** to itself (the workflow currently open)
3. Save

Do this again any time a workflow is deleted and re-imported (a full n8n wipe-and-rebuild, a manual
re-import), not just on first setup.

---

## 7. Configure n8n Credentials

Two credentials must be created in n8n.

### 7.1 KSeF App DB (PostgreSQL)

This credential connects n8n to the KSeF platform database.

1. Go to **Credentials** > **Add credential**
2. Search for and select **Postgres**
3. Configure:

| Field | Value |
|-------|-------|
| **Name** | `KSeF App DB` |
| **Host** | `ksef_db` |
| **Port** | `5432` |
| **Database** | `ksef_platform` |
| **User** | `ksef_app` |
| **Password** | *(the `KSEF_DB_PASSWORD` from your `.env` file)* |
| **SSL** | Disabled |

4. Click **Test connection** to verify, then **Save**

> **Important:** The host is `ksef_db` (Docker internal hostname), NOT `localhost`. The port is `5432` (internal), NOT `5433` (external).

### 7.2 SMTP Account (Email)

This credential is used for sending alert emails and JPK reports.

1. Go to **Credentials** > **Add credential**
2. Search for and select **SMTP**
3. Configure for your email provider:

**Gmail example:**

| Field | Value |
|-------|-------|
| **Name** | `SMTP account` |
| **Host** | `smtp.gmail.com` |
| **Port** | `465` |
| **SSL/TLS** | Enabled |
| **User** | `your-email@gmail.com` |
| **Password** | *(App-specific password — NOT your Gmail password)* |

> **Gmail note:** You must generate an App Password in Google Account > Security > 2-Step Verification > App Passwords. Regular passwords don't work with 2FA enabled.

4. Click **Save**

### 7.3 Re-link Credentials in All Workflows

After creating both credentials, you must select them in every Postgres and Email node across all 7 workflows:

1. Open each workflow
2. Click on each **Postgres** node > select `KSeF App DB` from the credential dropdown
3. Click on each **Email Send** node > select `SMTP account` from the credential dropdown
4. **Save** the workflow after updating all nodes

**Workflows with Postgres nodes:** All 7 workflows
**Workflows with Email nodes:** Send Alert v2, JPK_VAT Preparation

---

## 8. KSeF Tokens and Certificates

### 8.1 Test Environment

To get a test token:

1. Go to [ksef-test.mf.gov.pl](https://ksef-test.mf.gov.pl)
2. Log in using test authentication (BomTox)
3. Navigate to **API Tokens** section
4. Generate a token for your test NIP
5. Copy the raw token string

> **Note:** Test tokens typically expire after 7-10 days. You'll need to renew them periodically.

### 8.2 Production Environment

Production tokens are obtained from the real KSeF portal at [ksef.mf.gov.pl](https://ksef.mf.gov.pl). The process varies by authentication method (qualified signature, trusted profile, etc.).

### 8.3 Certificate Authentication (PKCS12)

For clients using certificate-based auth:

1. Place the `.p12` file in the `certificates/` directory
2. The xades-sidecar container mounts `./certificates:/app/certificates`
3. When adding the client to the database, set `auth_method = 'certificate'` and `certificate_id` to the filename

---

## 9. Add Your First Client

Connect to the KSeF database and insert a client record:

```bash
docker exec -it ksef_db psql -U ksef_app -d ksef_platform
```

```sql
INSERT INTO clients (
    client_name,
    nip,
    auth_method,
    ksef_token_encrypted,
    permission_level,
    sync_enabled,
    contact_email,
    contact_phone,
    monthly_invoice_volume,
    preferred_session_mode
) VALUES (
    'Nazwa Firmy Sp. z o.o.',       -- Company name
    '1234567890',                    -- 10-digit NIP (must pass checksum)
    'token',                         -- 'token' or 'certificate'
    'PASTE_YOUR_KSEF_TOKEN_HERE',    -- Raw KSeF API token
    'read_write',                    -- Permission level
    true,                            -- Enable automatic sync
    'ksiegowosc@firma.pl',           -- Email for JPK reports
    '+48 22 123 4567',               -- Contact phone
    150,                             -- Estimated monthly invoice volume
    'interactive'                    -- 'interactive' (default) or 'batch'
);
```

### Column Reference

| Column | Required | Description |
|--------|----------|-------------|
| `client_name` | Yes | Company display name |
| `nip` | Yes | 10-digit Polish NIP (must pass checksum algorithm) |
| `auth_method` | Yes | `'token'` or `'certificate'` |
| `ksef_token_encrypted` | For token auth | Raw KSeF API token string |
| `certificate_id` | For cert auth | Filename of `.p12` in `certificates/` |
| `certificate_expiry` | For cert auth | Certificate expiration date |
| `permission_level` | Yes | `'read_write'` (default) or `'read'` |
| `sync_enabled` | Yes | `true` to enable automatic invoice sync |
| `contact_email` | No | Email for JPK reports and alerts |
| `monthly_invoice_volume` | No | Estimated volume (helps with processing priority) |
| `preferred_session_mode` | Yes | `'interactive'` (most clients) or `'batch'` (high volume) |

### NIP Validation

The platform validates NIPs using the Polish checksum algorithm. An invalid NIP will be rejected by the Authenticate workflow. Verify your NIP before inserting:

```sql
-- Quick NIP checksum test (replace with your NIP):
SELECT '1234567890' AS nip,
    (6*1 + 5*2 + 7*3 + 2*4 + 3*5 + 4*6 + 5*7 + 6*8 + 7*9) % 11 AS expected_check_digit,
    0 AS actual_last_digit;
-- The expected_check_digit should equal the last digit of the NIP
```

---

## 10. Test the Platform

### 10.1 Health Check

Open the **KSeF - Health Check** workflow in n8n and click **Execute Workflow** (play button).

Verify it passes all 3 checks:
```bash
docker exec ksef_db psql -U ksef_app -d ksef_platform -c \
  "SELECT check_type, status, checked_at FROM system_health ORDER BY checked_at DESC LIMIT 3;"
```

Expected: `ksef_api`, `java_sidecar`, `app_database` — all with status `healthy`.

### 10.2 Authentication Test

Test the auth webhook with your client's NIP:

```bash
curl -s -X POST http://localhost:5678/webhook/ksef-auth \
  -H "Content-Type: application/json" \
  -d '{"client_nip":"YOUR_NIP_HERE"}'
```

Expected response:
```json
{
  "success": true,
  "accessToken": "eyJhbG...",
  "refreshToken": "...",
  "referenceNumber": "20260303-AU-..."
}
```

### 10.3 Alert System Test

```bash
curl -s -X POST http://localhost:5678/webhook/ksef-alert \
  -H "Content-Type: application/json" \
  -d '{"severity":"info","message":"Installation test","source":"manual","client_nip":"YOUR_NIP_HERE"}'
```

Expected: `{"status":"ok","severity":"processed","message":"Alert logged"}`

Verify in the audit log:
```bash
docker exec ksef_db psql -U ksef_app -d ksef_platform -c \
  "SELECT action, details, created_at FROM audit_log ORDER BY created_at DESC LIMIT 1;"
```

### 10.4 Submit Test Invoice (Optional)

If you want to test invoice submission to KSeF:

1. Temporarily activate the **KSeF - Submit Test Invoice** workflow
2. Execute it manually in the n8n UI
3. It will submit a test invoice and return a KSeF reference number
4. **Deactivate it after testing** — it's a manual tool, not for production use

---

## 11. Activate All Workflows

Activate workflows in this order (dependencies first):

| Order | Workflow | Schedule | Description |
|-------|----------|----------|-------------|
| 1 | KSeF - Send Alert v2 | Webhook (always on) | Centralized alerting hub |
| 2 | KSeF - Authenticate v2 | Webhook (always on) | Authentication service |
| 3 | KSeF - Health Check | Every 15 minutes | Monitors all services |
| 4 | KSeF - Invoice Retrieval v2 | Every 30 minutes | Pulls invoices from KSeF |
| 5 | KSeF - Offline24 Monitor | Every 2 hours | Tracks offline upload deadlines |
| 6 | KSeF - JPK_VAT Preparation | 5th of month, 08:00 | Monthly JPK report generation |

**Do NOT activate** KSeF - Submit Test Invoice in production.

To activate each workflow:
1. Open the workflow in n8n
2. Toggle the **Active** switch in the top bar
3. Confirm activation

### Verify Activation

Wait 15 minutes and check that Health Check has run:

```bash
docker exec ksef_db psql -U ksef_app -d ksef_platform -c \
  "SELECT COUNT(*) FROM system_health WHERE checked_at > NOW() - INTERVAL '20 minutes';"
```

---

## 12. Production Deployment Checklist

Before going live with real client data:

### 12.1 Switch to Production KSeF API

1. Edit `.env`:
   ```
   KSEF_ENVIRONMENT=prod
   ```

2. **Update all KSeF API URLs in workflows** from `api-test.ksef.mf.gov.pl` to `api.ksef.mf.gov.pl`. The following workflows contain hardcoded KSeF URLs that must be updated:
   - **KSeF - Authenticate v2**: 4 HTTP Request nodes (Get Public Key, Request Challenge, Submit Auth, Redeem Token)
   - **KSeF - Invoice Retrieval v2**: 4 HTTP Request nodes (Open Session, Query Sales, Query Purchases, Close Session)
   - **KSeF - Submit Test Invoice**: 5 HTTP Request nodes

3. Restart the stack:
   ```bash
   docker compose restart xades_sidecar n8n
   ```

### 12.2 Replace Test Tokens

Update each client's `ksef_token_encrypted` with production tokens obtained from the real KSeF portal.

### 12.3 Add a Reverse Proxy with TLS

The default setup exposes n8n on HTTP without encryption. For production:

1. Add **nginx** or **Traefik** as a reverse proxy with Let's Encrypt TLS certificates
2. Update internal webhook URLs in workflows. Several workflows call the Send Alert webhook at `http://localhost:5678/webhook/ksef-alert` — these should be updated to use the production hostname if the reverse proxy changes the internal routing.

### 12.4 Configure Alert Email

The Send Alert v2 workflow may have test email addresses. Update the "To" field in the Email Send nodes to your production admin email address.

### 12.5 Review Schedules

| Workflow | Default Schedule | Adjust For Production? |
|----------|-----------------|----------------------|
| Health Check | Every 15 min | Usually fine as-is |
| Invoice Retrieval | Every 30 min | Consider business hours only (e.g., Mon-Fri 6-22) |
| Offline24 Monitor | Every 2 hours | Consider every 1 hour for tighter monitoring |
| JPK_VAT Preparation | 5th of month 08:00 | Confirm this aligns with your filing deadlines |

### 12.6 Client Onboarding Best Practice

For each new client:
1. Insert the client with `sync_enabled = false`
2. Test authentication: `curl POST /webhook/ksef-auth` with their NIP
3. Verify auth succeeds, then set `sync_enabled = true`
4. Wait for the next Invoice Retrieval cycle and verify invoices appear

### 12.7 Backup Before Go-Live

```bash
# Backup n8n database (contains workflows, credentials, execution history)
docker exec n8n_postgres pg_dump -U n8n n8n > n8n_backup_prelaunch.sql

# Backup KSeF platform database
docker exec ksef_db pg_dump -U ksef_app ksef_platform > ksef_backup_prelaunch.sql

# Save your encryption key separately
echo "N8N_ENCRYPTION_KEY is in .env — save it in your password manager NOW"
```

---

## 13. Maintenance and Operations

### 13.1 Backups

**Daily automated backup** — `scripts/backup-ksef.sh` (add to the host's crontab):

```bash
0 3 * * * /path/to/ksef-platform/scripts/backup-ksef.sh >> /path/to/ksef-platform/backups/backup.log 2>&1
```

It writes a timestamped directory under `backups/` (override with `BACKUP_DIR`) containing the
`ksef_platform` and `n8n` dumps, the `ocr_uploads` volume, and a secrets archive (`.env`,
`portal/.env.local`, `certificates/`), then verifies it (`gzip -t`, expected tables present, SHA256SUMS)
and rotates runs older than `BACKUP_RETENTION_DAYS` (default 30). Optional env vars:

- `BACKUP_ENCRYPT_PASSPHRASE_FILE` — AES-256 encrypts the secrets archive. **Set this before any off-site copy.**
- `BACKUP_OFFSITE_CMD` — run after a verified backup with `$BACKUP_RUN_DIR` set, e.g.
  `rclone copy "$BACKUP_RUN_DIR" remote:ksef-backups/$(basename "$BACKUP_RUN_DIR")`. A failing hook keeps the local backup and alerts.
- `BACKUP_ALERT_URL` — webhook POSTed `{"message": ...}` on failure (e.g. `01-send-alert`).

**Prove it restores** (monthly, and once before go-live): `scripts/verify-backup.sh` restores the newest
dump into a throwaway Postgres container and compares every table's row count with the live DB.

> **Critical:** If you restore a PostgreSQL backup onto an n8n instance with a DIFFERENT `N8N_ENCRYPTION_KEY`, all credentials will be unreadable. Always backup `.env` alongside the database.

### 13.2 Data Cleanup

Run monthly to prevent unlimited table growth:

```sql
-- Delete system_health records older than 90 days
DELETE FROM system_health WHERE checked_at < NOW() - INTERVAL '90 days';

-- Delete audit_log records older than 1 year
DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '1 year';

-- Check table sizes
SELECT relname AS table_name,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

### 13.3 Updating n8n

```bash
# Pull latest n8n image
docker compose pull n8n

# Restart with new version
docker compose up -d n8n
```

> **After updating n8n:** Open each workflow and verify it still works. Node behavior can change between versions. Consider testing in a separate environment first.

### 13.4 Updating the XAdES Sidecar

If you've modified the sidecar source code:

```bash
docker compose build xades_sidecar --no-cache
docker compose up -d xades_sidecar
```

### 13.5 KSeF Token Renewal

KSeF API tokens expire (validity depends on how they were issued — typically 7 days for test, longer for production). Monitor expiration and update tokens in the `clients` table:

```sql
-- Update a client's token
UPDATE clients
SET ksef_token_encrypted = 'NEW_TOKEN_STRING',
    updated_at = NOW()
WHERE nip = 'CLIENT_NIP';
```

The Invoice Retrieval workflow will automatically use the new token on its next scheduled run.

### 13.6 Monitoring

Key queries to check platform health:

```sql
-- Recent sync status per client
SELECT c.client_name, c.nip, c.last_sync_success, c.last_sync_error,
       (SELECT COUNT(*) FROM invoices i WHERE i.client_nip = c.nip) AS total_invoices
FROM clients c
WHERE c.sync_enabled = true
ORDER BY c.last_sync_success DESC NULLS LAST;

-- Invoice counts by month
SELECT jpk_period, direction, COUNT(*) AS cnt
FROM invoices
GROUP BY jpk_period, direction
ORDER BY jpk_period DESC, direction;

-- Recent errors in audit log
SELECT client_nip, action, error_message, created_at
FROM audit_log
WHERE success = false
ORDER BY created_at DESC
LIMIT 20;

-- Pending offline invoice uploads
SELECT client_nip, invoice_number, upload_deadline,
       upload_deadline - NOW() AS time_remaining
FROM offline_invoices
WHERE uploaded_to_ksef = false
ORDER BY upload_deadline;
```

---

### 13.7 Vendor console operators (`/admin`)

The read-only operator console lives at `/admin` (login at `/admin/login`). There is no sign-up: apply
`migrations/2026-09-19-operators.sql`, then create an operator from `portal/` on a machine that can reach the DB
(the password comes from the environment so it stays out of shell history/`ps`):

```bash
cd portal
DATABASE_URL="postgresql://ksef_app:<KSEF_DB_PASSWORD>@localhost:5433/ksef_platform" \
OPERATOR_PASSWORD='<12+ characters>' node scripts/create-operator.mjs you@example.com
```

Re-running for the same email resets its password. Disable an operator with
`UPDATE operators SET is_active = false WHERE email = '...'` (takes effect on their next request). Logins and
every view of tenant data are recorded in `operator_audit_log`. Put `/admin` behind an IP allowlist or VPN at
nginx for production - the app's own throttle is per-email only.

## Architecture Overview

```
                         ┌─────────────────┐
                         │   KSeF API       │
                         │ (mf.gov.pl)      │
                         └────────┬─────────┘
                                  │ HTTPS
                    ┌─────────────┼──────────────┐
                    │             │               │
              ┌─────┴─────┐ ┌────┴────┐  ┌──────┴──────┐
              │   n8n     │ │  XAdES  │  │   KSeF DB   │
              │ Workflows │ │ Sidecar │  │ (PostgreSQL) │
              │ :5678     │ │ :8090   │  │ :5433        │
              └─────┬─────┘ └─────────┘  └─────────────┘
                    │
              ┌─────┴─────┐
              │  n8n DB   │
              │(PostgreSQL)│
              │ :5432     │
              └───────────┘
```

### Workflow Summary

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **Send Alert v2** | Webhook | Centralized alert routing (email for critical/warning, log for info) |
| **Authenticate v2** | Webhook | KSeF authentication (token or certificate) |
| **Health Check** | Every 15 min | Monitors KSeF API, XAdES sidecar, and database |
| **Invoice Retrieval v2** | Every 30 min | Pulls sales + purchase invoices from KSeF, deduplicates, classifies |
| **Offline24 Monitor** | Every 2 hours | Tracks offline upload deadlines, sends urgency alerts |
| **JPK_VAT Preparation** | 5th of month | Generates JPK-ready CSV reports per client, emails them |
| **Submit Test Invoice** | Manual | Test tool for submitting invoices to KSeF |

### Database Tables

| Table | Purpose |
|-------|---------|
| `clients` | Client configuration (NIP, auth method, sync settings) |
| `invoices` | All invoices synced from KSeF |
| `offline_invoices` | Invoices issued during KSeF offline periods |
| `jpk_preparations` | Monthly JPK report generation status |
| `audit_log` | All workflow actions and errors |
| `system_health` | Service health check history |
| `business_days` | Polish business day calendar (2026-2028) |
| `ocr_queue` | Document OCR processing queue |

---

## Support

For issues with the platform:
1. Check n8n execution history for error details
2. Review container logs: `docker compose logs <service-name>`
3. Verify database connectivity: `docker exec ksef_db psql -U ksef_app -d ksef_platform -c "SELECT 1;"`
4. Check KSeF API status: `curl https://api-test.ksef.mf.gov.pl/api/system/status`

### 13.3 Plans and entitlements

Tier features are enforced server-side (`portal/src/lib/entitlements.ts`), not just in the UI. Start is a
read-only monitoring/reporting plan; invoice issuance (creation, offline modes, KSeF sending), accounting
exports, AI classification and team seats need Biznes or Pro. A firm's tier is `firms.subscription_tier`.
Note: the Stripe webhook currently sets the tier only on `checkout.session.completed`, not on later plan
changes — see `HANDOVER.md` before going live with billing.
