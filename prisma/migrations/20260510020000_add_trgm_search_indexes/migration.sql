-- Enable pg_trgm for fast trigram-based ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes on message columns used in search
CREATE INDEX IF NOT EXISTS idx_messages_subject_trgm   ON messages USING GIN (subject gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_text_body_trgm ON messages USING GIN (text_body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_from_name_trgm ON messages USING GIN (from_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_from_email_trgm ON messages USING GIN (from_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_to_raw_trgm    ON messages USING GIN (to_raw gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_cc_raw_trgm    ON messages USING GIN (cc_raw gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_bcc_raw_trgm   ON messages USING GIN (bcc_raw gin_trgm_ops);
