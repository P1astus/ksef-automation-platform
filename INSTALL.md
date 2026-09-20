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
├── db/                         # Schema: baseline-2026-09-20.sql (+ Polish holiday calendar 2026-2028) and post-cutover migrations/
├── ksef-schema*.sql, migrations/  # ARCHIVE of the historical SQL - no longer run by anything (see 13.11)
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
| `KSEF_CREDENTIALS_KEY` | 32-byte AES-256-GCM key encrypting stored KSeF tokens/certificates and per-firm IMAP passwords (`openssl rand -base64 32`). **Unset = those saves return 503.** Back it up; losing it makes the data unrecoverable. See §13.8 | |
| `ALLOW_DEV_RESET_URL` | `true` only outside production, to get the reset link in the API response | `false` |
| `DIGEST_SECRET` / `NOTIFY_SECRET` | Shared secrets for `/api/digest` and `/api/notify/*` (`openssl rand -hex 32`) | |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_START/BIZNES/PRO` | Stripe billing | |
| `ANTHROPIC_API_KEY` | AI classification during client sync (Biznes/Pro) | |
| `N8N_SYNC_WEBHOOK_URL` | Optional: sync webhook. (IMAP is now configured per firm in Settings, not via env) | |

**The portal container reads none of these from a `.env` file** — `.dockerignore` excludes `.env*`, so
each variable must be listed in `docker-compose.yml`'s `portal` `environment:` block (all of the above
are, since round 15). Before that fix Stripe/Resend/`NEXT_PUBLIC_APP_URL`/`DIGEST_SECRET` could not reach
the container at all. Adding a new `process.env.X` to the portal means adding `X` to that block too;
`env-and-email-truthfulness.test.ts` fails if you forget. After editing `.env`, recreate the portal:
`docker compose up -d portal` (then `docker restart ksef_nginx`).

**Upload size:** nginx accepts request bodies up to 12 MB (`client_max_body_size` in `nginx/nginx.conf`,
default was 1 MB, which rejected real scanned invoices with a 413); the portal itself caps a document at
10 MB. nginx also overwrites `X-Real-IP` with the TCP peer address and sends `X-Forwarded-For`; portal rate
limits deliberately trust only `X-Real-IP`, never a client-supplied forwarding chain. Apply an nginx change with
`docker exec ksef_nginx nginx -s reload`.

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
- Schema not loading: the schema is applied by the one-shot `ksef_migrate` service (`docker compose logs ksef_migrate`), on an empty volume or an existing database, and the portal will not start if it fails. See 13.11. To re-initialize from scratch, `docker compose down -v` (WARNING: destroys all data).

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

### VAT-marża migration

Before using VAT-marża invoice creation or JPK margin-base generation on an existing database, apply the
additive migration and rebuild the portal:

```bash
docker exec -i ksef_db psql -v ON_ERROR_STOP=1 -U ksef_app -d ksef_platform < migrations/2026-09-19-jpk-margin-taxable-base.sql
docker compose up -d --build portal nginx
docker restart ksef_nginx
```

The new taxable-margin amount is internal accounting input; it is deliberately excluded from FA(3) and PDFs.

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
nginx for production. The console's read-only audit feed is at `/admin/audit`; login is throttled by both e-mail
and nginx-provided client IP.

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

### 13.9 JPK gateway signing key (test only, optional)

The sidecar's `POST /sign-xades-bes` signs the MF JPK gateway's upload metadata (XAdES-BES). It needs a PKCS#12 key on the
server: put it in `./certificates/` (mounted at `/app/certificates`, gitignored) and set in the root `.env`
`JPK_SIGNING_KEYSTORE_PATH=/app/certificates/<file>.p12` and `JPK_SIGNING_KEYSTORE_PASSWORD=...`, then
`docker compose up -d --build xades-sidecar`. Unset = the endpoint answers 503 (never an unsigned document); a set-but-unreadable
keystore stops the sidecar from starting. A throwaway self-signed test key:
`keytool -genkeypair -alias jpk-test -keyalg RSA -keysize 2048 -validity 365 -dname "CN=JPK Test Signer, C=PL" -storetype PKCS12 -keystore certificates/jpk-test-signing.p12`.
The ministry's TEST gateway currently rejects such a certificate (423: it must carry the signer's NIP/PESEL in a format not
publicly documented); a production filing needs the taxpayer's or agent's own qualified certificate. See §13.10 before
enabling the optional portal action. Sidecar tests: `docker run --rm -v "$PWD/xades-sidecar":/app -w /app maven:3.9-eclipse-temurin-17 mvn -B test`.

### 13.10 JPK TEST gateway portal action (default off)

`/dashboard/jpk` can submit an already-generated XML to **only**
`https://test-e-dokumenty.mf.gov.pl`; it has no production URL or automatic trigger. Apply
`migrations/2026-09-19-jpk-test-gateway-submissions.sql`, then set both root `.env` values and rebuild the portal:

```bash
JPK_TEST_GATEWAY_ENABLED=true
# Current public MF TEST encryption certificate, encoded as one dotenv-safe line:
JPK_TEST_GATEWAY_CERTIFICATE_BASE64=<base64 of the current MF TEST .cer>
docker compose up -d --build portal nginx
```

The certificate is MF's public encryption key, not a taxpayer certificate or private key. The action is firm-scoped,
requires an active subscription, signs metadata only through the already configured sidecar, stores the MF reference/status
and exact error text, and polls Status during that manual request. It does **not** accept/store AuthData, a taxpayer
certificate or a private key. Keep the flag `false` until MF documents the accepted signer attribute or answers the helpdesk
question; filing with the tax office remains the accountant's responsibility.

### 13.8 Credential encryption key and legacy-row migration

1. `openssl rand -base64 32` -> `KSEF_CREDENTIALS_KEY=` in the root `.env`; **back it up together with `.env`**.
2. `docker compose up -d` (portal and n8n both receive it), then re-import/patch workflow `02-ksef-authenticate`
   in n8n (its Code node decrypts) - never activate it without sign-off.
3. Schema: nothing to apply by hand any more - every table these features need (IMAP settings, rate limits, member
   password reset, JPK envelope fields, ZUS register, the TEST gateway table) is in the baseline applied by `ksef_migrate`
   (13.11). JPK generation still refuses for a client with no tax-office code (client page) or no contact e-mail, and a
   sole-trader client needs first name, surname and date of birth on its page.
4. Re-encrypt existing rows (one-off; the legacy format must be stated because unprefixed rows are ambiguous):
   ```bash
   cd portal
   DATABASE_URL="postgresql://ksef_app:<KSEF_DB_PASSWORD>@localhost:5433/ksef_platform" \
   KSEF_CREDENTIALS_KEY='<the key>' KSEF_LEGACY_FORMAT=base64 node scripts/migrate-ksef-credentials.mjs
   ```
   Runs in one transaction. Rows already starting `enc:v1:` are skipped. Take a backup first (§13.1).

### 13.11 Schema management (`ksef_migrate`)

The schema is no longer applied by `docker-entrypoint-initdb.d` or by hand. A one-shot `ksef_migrate` service runs
`node scripts/migrate.mjs` before the portal starts (`docker compose logs ksef_migrate`); if it fails the portal does not
start. It has three paths and never guesses:

| Situation | What happens |
|---|---|
| **Empty database** (new install) | Applies `db/baseline-2026-09-20.sql` (schema + the Polish business-day calendar) and records it. |
| **Existing database** (installed before this change) | Runs a **read-only audit** against the baseline's invariants (`db/baseline-2026-09-20.invariants.json`, derived from the baseline, never hand-written). On a full match it records the baseline as *adopted* and applies nothing. On any mismatch it stops, prints exactly what is missing or different, and changes nothing. |
| **Baseline already recorded** | Applies any migrations listed in `db/migrations/manifest.json`, in order, each committed together with its `schema_migrations` row. Otherwise a no-op. |

**Adopting an existing database (once):**

```bash
docker exec ksef_db pg_dump -U ksef_app ksef_platform > ksef_before_adoption.sql     # 1. backup (13.1)
docker compose run --rm ksef_migrate                                                # 2. audit only: exit 3 = "passed, not recorded"
MIGRATIONS_CONFIRM_ADOPTION=1 docker compose run --rm ksef_migrate                 # 3. record it (only after a passing audit)
```

Exit codes: `0` ok, `1` unexpected failure, `2` audit mismatch (the report lists the objects to fix by hand; the historical SQL under
`migrations/` is the reference), `3` audit passed but adoption not yet confirmed.

**Rules.** A released baseline or an applied migration must never be edited: a checksum mismatch stops the upgrade
(`MIGRATIONS_ALLOW_CHECKSUM_DRIFT=true` is a documented one-time escape hatch; line-ending-only changes are not drift). Two runners
started together are safe - the second waits on a lock and then finds nothing to do. An older application image against a newer
database is allowed, so an upgrade can be rolled back by redeploying the previous image without restoring the database.
The `business_days` calendar is seeded through **2028-12-31** and must be extended before then (a new migration).
The historical SQL (`ksef-schema*.sql`, `migrations/*`, including the tenancy rollback) is archive material: it is not in the
image and nothing executes it.

### 13.12 Editions and first-run (local install)

One build runs as the hosted SaaS or as a local install, chosen by `DEPLOYMENT_MODE` (empty = hosted, exactly as before).
`DEPLOYMENT_MODE=local` means: registration is closed, there is no vendor console (`/admin`), no billing or paywall, mail goes
through SMTP, and the landing page redirects to the login. `ACCESS_PROVIDER` (local only) is `unmetered` (default) or `licence`.
`EMAIL_TRANSPORT`, `PUBLIC_UPLOAD_ENABLED` (default off locally: client document upload needs inbound internet) and
`SCHEDULER_ENABLED` are optional overrides. An invalid value stops the app at first use, and **a Stripe key together with a
non-Stripe access policy is refused at startup** (two sources of truth for account status).

**Creating the first account (local).** Registration needs a one-time setup token:

```bash
docker compose run --rm ksef_migrate node scripts/setup-token.mjs   # prints the token once
```

Only the token's SHA-256 is stored; the raw value is shown once, so copy it now. Run the command again to replace a lost,
unused token. It refuses once an account exists. The first firm is created as an active **Pro** firm with no trial clock. Two
people submitting the token at once cannot both succeed; a used token cannot be replayed.

#### 13.12.1 Secure local installation on a LAN

This is the supported local-install path. It requires Docker Compose **v2.24.4+** because the overlay uses `!reset` and
`!override` to remove unsafe settings inherited from the hosted stack. In zsh, use a function (not a quoted command string):

```zsh
dc() { docker compose -f docker-compose.yml -f docker-compose.local.yml "$@"; }
```

The overlay sets `DEPLOYMENT_MODE=local`, blanks Resend/Anthropic/Stripe configuration, and publishes only nginx on 80 and
443. Portal, both PostgreSQL services, n8n and the XAdES sidecar remain on the Compose network. The old n8n scheduler and its
database have the `legacy-n8n` profile and do not start by default. Only for deliberate migration/debug work, and never to
activate a workflow, start them with `dc --profile legacy-n8n up -d postgres n8n`.

**1. Configure local secrets and origin.** At minimum, generate the normal database/JWT/sidecar secrets plus the credential
key, and set the exact LAN origin in `.env` (no trailing slash):

```dotenv
NEXT_PUBLIC_APP_URL=https://ksef-box.local
KSEF_CREDENTIALS_KEY=<output of: openssl rand -base64 32>
SMTP_HOST=mail.example.internal
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM_EMAIL=ksef@example.pl
```

Keep `.env` and `KSEF_CREDENTIALS_KEY` together in the backup. Without that exact key, restored `enc:v1:` KSeF tokens,
certificates and IMAP passwords cannot be decrypted.

**2. Create a certificate with the real access names.** Give the script every hostname and IP that browsers will use; each
is written into `subjectAltName`. Regenerate it whenever the server address changes.

```bash
scripts/generate-local-certificate.sh ksef-box.local 192.168.1.40
openssl x509 -in certificates/local/tls.crt -noout -text
```

The private `tls.key` stays on the server and is mounted read-only into nginx. Copy only `tls.crt` to workstations. This is a
self-signed certificate, so install it as trusted only on devices managed by the firm, after comparing its SHA-256 fingerprint
with `openssl x509 -in certificates/local/tls.crt -noout -fingerprint -sha256` on the server.

- **Windows (Administrator PowerShell or Command Prompt):** copy `tls.crt` locally, then run
  `certutil -addstore -f Root tls.crt`. It should appear under *Trusted Root Certification Authorities → Certificates*.
  Remove it later with `certutil -delstore Root <certificate-serial-number>`.
- **macOS (administrator account):** copy `tls.crt` locally, then run
  `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain tls.crt`.
  Alternatively import it into the System keychain in Keychain Access and set SSL trust to *Always Trust*.

Restart the browser after installing trust. A warning means the accessed hostname/IP is absent from the SAN list, trust was
installed in the wrong store, or an old certificate is cached; do not train users to click through it.

**3. Start and claim the installation.** Generate the TLS files before nginx starts.

```zsh
dc up -d --build
dc ps
dc run --rm ksef_migrate node scripts/setup-token.mjs
```

Open `https://ksef-box.local/setup`, paste the one-time token, and enter the firm name, administrator e-mail and password.
Local `/register` redirects to `/setup`; after the first firm exists, `/setup` returns 404. Hosted registration is unchanged.

The built portal image sets `NODE_ENV=production`, and both session-creation paths therefore emit a `Secure`, `HttpOnly`,
`SameSite=Lax` cookie. Verify after login in browser DevTools → Network → the login/register response → `Set-Cookie`; it must
contain `Secure`. nginx still overwrites `X-Real-IP` from the TCP peer, so IP-keyed rate limiting does not trust a client header.

**4. Check exposure from another LAN device.** The host's LAN IP is a weaker fallback, but it still catches accidental Compose
port publication:

```bash
scripts/verify-local-network.sh 192.168.1.40
```

The gate requires HTTPS on 443, an HTTP 308 redirect on 80, and closed ports 3000, 5432, 5433, 5678 and 8090. Host firewalls
may expose fewer ports, never more; allow inbound TCP 80/443 only on the trusted LAN profile.

**5. Egress defaults.** The local overlay supplies no Resend, Anthropic, Stripe or n8n webhook credential, disables Next.js
telemetry, and n8n is absent by default. The portal CSP includes `connect-src 'self'`, with fonts and assets self-hosted, so a
workstation cannot silently contact those vendors either. Expected outbound traffic remains: configured company SMTP,
MF/KSeF endpoints required for the product, and the NIP white-list service. Review any explicitly configured integration before
promising an air-gapped installation.

**6. Back up and prove restoration.** Encrypt the secrets archive before any off-site copy:

```bash
openssl rand -base64 48 > /root/ksef-backup.pass
chmod 600 /root/ksef-backup.pass
BACKUP_ENCRYPT_PASSPHRASE_FILE=/root/ksef-backup.pass scripts/backup-local.sh
BACKUP_ENCRYPT_PASSPHRASE_FILE=/root/ksef-backup.pass scripts/verify-local-backup.sh
```

`backup-local.sh` captures `ksef_platform`, the `ocr_uploads` volume, `certificates/`, and `.env`, then writes checksums.
`verify-local-backup.sh` restores them into a fresh `ksef_verify_*` Compose project, requires `ksef_migrate` to report a no-op,
and decrypts one stored `enc:v1:` credential with the restored `KSEF_CREDENTIALS_KEY`. It fails if the backup has no encrypted
credential, because a key round-trip cannot otherwise be proved. The verification project and volumes are removed on exit.

### 13.13 Job worker (`ksef_worker`) - replacing n8n workflow by workflow

`ksef_worker` runs the platform's scheduled work in-process, replacing n8n one workflow at a time. It uses the portal image
(`node worker.js`) and is **inert by default**: with `JOBS_ENABLED` and `JOBS_SHADOW` empty it logs "idle" and runs nothing.
A typo in either list stops it at start with exit code 78 instead of running a subset.

| Variable | Meaning |
|---|---|
| `JOBS_ENABLED` | comma-separated jobs to run for real. Known jobs: `health-check` (replaces workflow 03) |
| `JOBS_SHADOW` | jobs to run in shadow mode: they compute and record what they would do, and write nothing else (no samples, markers, alerts or mail) |
| `ALERT_EMAIL` | where alerts are e-mailed. **No default.** Unset means alerts are still stored (`system_alerts`, `audit_log`) and the missing address is recorded on each alert |
| `JOBS_TICK_SECONDS` / `JOBS_LEASE_SECONDS` | optional tuning (defaults 30 / 300) |

**Never enable a job while the n8n workflow it replaces is still active** - both would do the work. The workflow exports in
`workflows/` are inactive; keep the live copy inactive too. Recommended migration per job: run it in `JOBS_SHADOW` for a cycle and
compare, then deactivate the workflow, then move the job to `JOBS_ENABLED`.

Occurrences, retries and outcomes are in the `job_occurrences` table; alerts in `system_alerts`. A crashed or hung worker's
occurrence is recovered automatically (its lease expires), retried with backoff, and after its last attempt fails permanently with
a critical alert. At most one occurrence of a job runs at once (enforced by a database index), so two workers cannot double-run it.
Schedules use an explicit timezone (Europe/Warsaw); a repeated DST hour runs once and a skipped one runs once at the next valid time.
