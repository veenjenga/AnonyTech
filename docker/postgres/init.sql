-- ─────────────────────────────────────────────────────────────────────────────
-- E-Voting Privacy-by-Design Schema
-- CRITICAL: voter identity (voters) and vote content (ballots) are in separate
--           tables with NO foreign key between them. This is structural privacy.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Elections ─────────────────────────────────────────────────────────────────
CREATE TABLE elections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    method      TEXT NOT NULL CHECK (method IN ('plurality','borda','stv','liquid')),
    status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','closed','recovered')),
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMPTZ
);

-- ── Voter Registry  (IDENTITY only — never joined to ballots) ─────────────────
CREATE TABLE voters (
    voter_token  TEXT PRIMARY KEY,          -- anonymous token handed to voter
    election_id  UUID NOT NULL REFERENCES elections(id),
    has_voted    BOOLEAN NOT NULL DEFAULT FALSE,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Ballots  (CONTENT only — never joined to voters) ─────────────────────────
CREATE TABLE ballots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id),
    content     JSONB NOT NULL,             -- ranked choices / delegation etc.
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    log_hash    TEXT                        -- WAL integrity hash
    -- NOTE: no voter_token column here — privacy by design
);

-- ── Plugin Audit Log ──────────────────────────────────────────────────────────
CREATE TABLE plugin_events (
    id           BIGSERIAL PRIMARY KEY,
    election_id  UUID REFERENCES elections(id),
    event_type   TEXT NOT NULL,            -- 'substitution','tally_start','tally_end'
    method       TEXT NOT NULL,
    config_hash  TEXT,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Failure / Recovery Log ────────────────────────────────────────────────────
CREATE TABLE recovery_events (
    id              BIGSERIAL PRIMARY KEY,
    election_id     UUID REFERENCES elections(id),
    failure_type    TEXT NOT NULL,         -- 'power','network','storage','client'
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recovered_at    TIMESTAMPTZ,
    votes_at_failure INT,
    votes_recovered  INT,
    wal_lsn_start   TEXT,
    wal_lsn_end     TEXT,
    integrity_hash   TEXT,
    status          TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','recovered','failed'))
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_ballots_election   ON ballots(election_id);
CREATE INDEX idx_voters_election    ON voters(election_id);
CREATE INDEX idx_plugin_events_time ON plugin_events(occurred_at);
