CREATE TABLE firm_licences (
    firm_id integer PRIMARY KEY REFERENCES firms(id) ON DELETE CASCADE,
    signed_blob text NOT NULL,
    installed_at timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(signed_blob) <= 16384)
);
