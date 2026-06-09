-- ============================================================
--  AnonyTech E-Voting System — PostgreSQL Schema
--  Updated: Added password_hash to voters table
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ------------------------------------------------------------
-- 1. ELECTION CONFIGURATION
-- ------------------------------------------------------------
CREATE TABLE election_config (
  id                SERIAL PRIMARY KEY,
  voting_method     VARCHAR(20)  NOT NULL DEFAULT 'Plurality'
                    CHECK (voting_method IN ('Plurality','STV','Borda','Liquid')),
  is_sealed         BOOLEAN      NOT NULL DEFAULT FALSE,
  is_tally_released BOOLEAN      NOT NULL DEFAULT FALSE,
  start_date        TIMESTAMPTZ,
  end_date          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX unique_active_config ON election_config ((TRUE));


-- ------------------------------------------------------------
-- 2. DEPARTMENTS
-- ------------------------------------------------------------
CREATE TABLE departments (
  id          VARCHAR(64)  PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL,
  full_name   VARCHAR(200) NOT NULL,
  prefix      CHAR(3)      NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX dept_prefix_unique ON departments (prefix);


-- ------------------------------------------------------------
-- 3. ROLES  (positions up for election)
-- ------------------------------------------------------------
CREATE TABLE roles (
  id            VARCHAR(64)  PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  voting_logic  VARCHAR(20)  NOT NULL DEFAULT 'Plurality'
                CHECK (voting_logic IN ('Plurality','STV','Borda','Liquid')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
-- 4. CANDIDATES
-- ------------------------------------------------------------
CREATE TABLE candidates (
  id             VARCHAR(64)   PRIMARY KEY,
  role_id        VARCHAR(64)   NOT NULL REFERENCES roles(id)        ON DELETE CASCADE,
  department_id  VARCHAR(64)   NOT NULL REFERENCES departments(id)  ON DELETE CASCADE,
  name           VARCHAR(200)  NOT NULL,
  course         VARCHAR(200),
  image_url      TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_candidates_role       ON candidates (role_id);
CREATE INDEX idx_candidates_department ON candidates (department_id);


-- ------------------------------------------------------------
-- 5. VOTERS
--    ✅ UPDATED: Added password_hash column for credential auth.
--    password_hash uses bcrypt (60-char output from pgcrypto's
--    crypt() or bcryptjs in Node).  NULL allowed so existing
--    rows and CSV-imported voters without a password can still
--    be patched later via PATCH /api/voters/:id/password.
-- ------------------------------------------------------------
CREATE TABLE voters (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       VARCHAR(50)  NOT NULL UNIQUE,
  email            VARCHAR(200) NOT NULL UNIQUE,
  full_name        VARCHAR(200),
  department_id    VARCHAR(64)  REFERENCES departments(id) ON DELETE SET NULL,
  role             VARCHAR(20)  NOT NULL DEFAULT 'voter'
                                CHECK (role IN ('voter', 'admin')),
  -- ✅ NEW: bcrypt hash of the voter's chosen password
  password_hash    TEXT,
  has_voted        BOOLEAN      NOT NULL DEFAULT FALSE,
  credential_hash  TEXT,
  registered_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  voted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voters_email      ON voters (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_voters_student_id ON voters (student_id);
CREATE INDEX IF NOT EXISTS idx_voters_role       ON voters (role) WHERE role = 'admin';
CREATE INDEX idx_voters_department               ON voters (department_id);

-- ─── Migration: run on existing installs ─────────────────────
-- ALTER TABLE voters ADD COLUMN IF NOT EXISTS password_hash TEXT;


-- ------------------------------------------------------------
-- 6. DEPT ELECTION STATES
-- ------------------------------------------------------------
CREATE TABLE dept_election_states (
  department_id     VARCHAR(64) PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  is_sealed         BOOLEAN NOT NULL DEFAULT FALSE,
  is_tally_released BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
-- 7. ENCRYPTED BALLOTS
-- ------------------------------------------------------------
CREATE TABLE ballots (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id      VARCHAR(64) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  ciphertext   JSONB       NOT NULL,
  zkp_proof    JSONB       NOT NULL,
  is_real      BOOLEAN     NOT NULL DEFAULT TRUE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ballots_role       ON ballots (role_id);
CREATE INDEX idx_ballots_token_hash ON ballots (token_hash);
CREATE INDEX idx_ballots_submitted  ON ballots (submitted_at DESC);


-- ------------------------------------------------------------
-- 8. TALLY RESULTS
-- ------------------------------------------------------------
CREATE TABLE tally_results (
  id            SERIAL      PRIMARY KEY,
  role_id       VARCHAR(64) NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  candidate_id  VARCHAR(64) NOT NULL REFERENCES candidates(id)  ON DELETE CASCADE,
  vote_count    INTEGER     NOT NULL DEFAULT 0,
  tallied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, candidate_id)
);

CREATE INDEX idx_tally_role      ON tally_results (role_id);
CREATE INDEX idx_tally_candidate ON tally_results (candidate_id);


-- ------------------------------------------------------------
-- 9. VOTER JOURNEY TIMESTAMPS
-- ------------------------------------------------------------
CREATE TABLE voter_journey (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id          UUID        NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
  identity_verified TIMESTAMPTZ,
  tunnel_active     TIMESTAMPTZ,
  choices_made      TIMESTAMPTZ,
  ledger_updated    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_journey_voter ON voter_journey (voter_id);


-- ------------------------------------------------------------
-- 10. AUDIT LOG
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGSERIAL    PRIMARY KEY,
  actor       VARCHAR(200),
  action      VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id   VARCHAR(200),
  metadata    JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor    ON audit_log (actor);
CREATE INDEX idx_audit_action   ON audit_log (action);
CREATE INDEX idx_audit_occurred ON audit_log (occurred_at DESC);


-- ------------------------------------------------------------
-- 11. SUPPORT TICKETS
-- ------------------------------------------------------------
CREATE TABLE support_tickets (
  id         BIGSERIAL    PRIMARY KEY,
  voter_id   UUID         REFERENCES voters(id) ON DELETE SET NULL,
  email      VARCHAR(200),
  full_name  VARCHAR(200),
  message    TEXT         NOT NULL,
  status     VARCHAR(20)  NOT NULL DEFAULT 'open'
             CHECK (status IN ('open','in_progress','resolved','closed')),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
-- 12. FEEDBACK
-- ------------------------------------------------------------
CREATE TABLE feedback (
  id           BIGSERIAL    PRIMARY KEY,
  voter_id     UUID         REFERENCES voters(id) ON DELETE SET NULL,
  rating       SMALLINT     CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  submitted_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
-- AUTO-UPDATE updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_election_config_updated_at
  BEFORE UPDATE ON election_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_dept_election_states_updated_at
  BEFORE UPDATE ON dept_election_states
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ------------------------------------------------------------
-- SEED: default election_config row
-- ------------------------------------------------------------
INSERT INTO election_config (voting_method, is_sealed, is_tally_released)
VALUES ('Plurality', FALSE, FALSE);