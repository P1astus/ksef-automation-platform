# KSeF Automation Platform

A multi-tenant SaaS that automates Polish e-invoicing for accounting firms.

Since 2026 Polish businesses must issue and receive invoices through **KSeF** (Krajowy System e-Faktur), the
national e-invoice system. This platform lets an accounting firm manage many client companies in one place:
it syncs their invoices, watches legal upload deadlines, classifies costs, issues invoices, and prepares the
monthly **JPK_VAT** tax report.

> Status: built and exercised against the Ministry of Finance **test** environment. It is not deployed to
> production and is not affiliated with the Ministry.

## What it does

- **Invoice sync** - pulls sales and purchase invoices per client from KSeF on a schedule, resuming from a
  high-water mark so nothing is fetched twice or skipped.
- **Invoice issuing** - builds FA(3) XML (the current Polish invoice schema), including correction invoices,
  and submits it through an encrypted KSeF online session.
- **Offline deadline monitoring** - tracks invoices issued while KSeF was unavailable and escalates alerts
  as the statutory upload deadline approaches, using Polish business-day rules.
- **JPK_VAT preparation** - generates the JPK_V7M(3) report and validates it against the official XSD before
  offering it.
- **Document intake** - OCR and e-mail ingestion with a human review queue; clients can upload documents
  through expiring, tokenised links.
- **Accounting exports** - Optima, Symfonia and other accounting-software formats.
- **SaaS layer** - firms, team roles, subscription tiers with server-side entitlement checks, Stripe billing,
  GDPR erasure, and a read-only operator console.

## Architecture

```
            nginx (reverse proxy)
                   |
     +-------------+--------------+
     |                            |
  portal (Next.js 16 / React 19)  n8n (workflow engine)
     |          |                    |
     |          +----------+---------+
     |                     |
  ksef_db (Postgres)   xades-sidecar (Java 17 / Spring Boot)
                        XAdES-BES signing, RSA-OAEP / AES encryption
```

| Piece | Role |
|---|---|
| `portal/` | Next.js dashboard and API: auth, tenancy, invoices, JPK, billing. TypeScript, `pg` (no ORM), Tailwind. |
| `workflows/` | n8n workflows holding the scheduled business logic: KSeF auth, invoice retrieval, offline-deadline monitor, JPK preparation, alerting, client notifications. |
| `xades-sidecar/` | Java service for the cryptography KSeF requires (XAdES-BES signatures, RSA-OAEP token encryption, AES-256-CBC session encryption), which is awkward to do cleanly in Node. |
| `schemas/` | Official FA(3) and JPK_V7M(3) XSDs, used to validate generated documents. |
| `*.sql`, `migrations/` | Platform schema and ordered migrations. |

Design choices worth noting:

- Every table is scoped by `firm_id`; tenancy is enforced in the data layer, not just the UI.
- Money- and deadline-critical paths (VAT markers, offline deadlines, totals) are computed server-side and
  tested against realistic fixtures rather than trusted from the client.
- Generated tax documents are validated against the government's own schemas in the test suite.
- Failures surface loudly: notification, sync and signing paths return errors instead of reporting success.

## Running it

Requirements: Docker (Compose), Node 20+.

```bash
cp .env.template .env            # fill in secrets; see INSTALL.md
bash build-sidecar.sh
docker compose up -d --build
curl localhost:8090/actuator/health   # sidecar
curl localhost:5678/healthz           # n8n
```

`INSTALL.md` is the full deployment guide (env generation, workflow import order, first client, tests).
Nothing talks to KSeF production; the default target is the Ministry's test API.

## Tests

```bash
cd portal
npm install
npx tsc --noEmit
npx vitest run --pool=forks --poolOptions.forks.maxForks=2
```

The portal suite is about 480 tests across 75 files (route handlers against an in-memory Postgres, the JPK and
FA(3) builders validated with `xmllint` against the official schemas, workflow logic, entitlement matrix). The
sidecar has its own JUnit suite (`mvn test`).

## Further reading

- `INSTALL.md` - deployment and operations.

## License

Copyright (c) 2026 Antek Potrykowski. All rights reserved. Shared for review only - see `LICENSE`.
