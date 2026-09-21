-- Expand-only: keep imported ZUS evidence immutable even for direct SQL writers.
CREATE OR REPLACE FUNCTION reject_zus_source_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ZUS source_xml and sha256 are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER zus_source_immutable
BEFORE UPDATE OF source_xml, sha256 ON zus_declarations
FOR EACH ROW EXECUTE FUNCTION reject_zus_source_update();
