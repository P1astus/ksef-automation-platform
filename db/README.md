# db/ - schema for a fresh install, and what comes after

- `baseline-2026-09-20.sql` - the complete schema plus reference data (the Polish business-day calendar) as of the cutover.
  Generated from the documented historical order applied to an empty database (plus `activity_log`, which application code
  used to create lazily), then reviewed. **Never edit it after release** - the runner checksums it.
- `baseline-2026-09-20.invariants.json` - what an existing database must match to be adopted. **Derived**, not hand-written:
  `DATABASE_URL=... node portal/scripts/generate-baseline-invariants.mjs` against a database built from the baseline, and a test
  asserts the checked-in file equals a fresh apply.
- `migrations/manifest.json` - the ordered list of migrations created **after** the cutover. Hand-maintained, never a glob.

The historical SQL at the repository root (`ksef-schema*.sql`) and in `../migrations/` is archive material only.
See INSTALL.md section 13.11.
- `contract/` - CONTRACT steps that are written but deliberately NOT in the manifest yet (each file says what must hold before it is promoted).
