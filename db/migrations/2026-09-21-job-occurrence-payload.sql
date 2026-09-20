-- A job occurrence can carry input: a manual "sync this client now" is an occurrence of invoice-retrieval scoped to one client.
-- Additive (expand-only): NULL for every scheduled occurrence and invisible to an older worker.
ALTER TABLE job_occurrences ADD COLUMN payload JSONB;
