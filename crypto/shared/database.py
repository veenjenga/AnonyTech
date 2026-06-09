"""
shared/database.py
------------------
Creates and initialises the SQLite databases used by all four servers.

Servers and their databases
----------------------------
  - Registration Server  → registration.db  (voters, issued_tokens)
  - Ballot Server        → ballot.db        (ballots, bulletin_board)
  - Election Server      → election.db      (ciphertexts)
  - Tally Server         → tally.db         (results)

Anonymity / unlinkability guarantee
-------------------------------------
  The Registration Server and the Ballot Server share NO database and NO
  common field that could be used to join their records.  The only thing
  that crosses the boundary is a blind-signed token (stored as its SHA-256
  hash on the Ballot Server side), which is mathematically unlinkable to
  the voter identity on the Registration Server side.
"""

import sqlite3
import os

DB_DIR = os.path.join(os.path.dirname(__file__), "..", "databases")


def _db_path(name: str) -> str:
    os.makedirs(DB_DIR, exist_ok=True)
    return os.path.join(DB_DIR, name)


# ---------------------------------------------------------------------------
# Registration Server database
# ---------------------------------------------------------------------------

def init_registration_db() -> sqlite3.Connection:
    """
    Tables
    ------
    voters       – eligibility registry (no ballot data ever stored here)
    issued_tokens – SHA-256 hashes of tokens that have already been signed
                   (prevents a voter from getting two credentials)
    """
    conn = sqlite3.connect(_db_path("registration.db"))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS voters (
            voter_id      TEXT PRIMARY KEY,
            region_code   TEXT NOT NULL,
            eligible      INTEGER NOT NULL DEFAULT 1,   -- 1 = eligible
            credential_issued INTEGER NOT NULL DEFAULT 0 -- 1 = already signed
        );

        CREATE TABLE IF NOT EXISTS issued_tokens (
            token_hash    TEXT PRIMARY KEY,             -- SHA-256(blinded_token)
            issued_at     TEXT NOT NULL                 -- ISO-8601 timestamp
        );
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Ballot Server database
# ---------------------------------------------------------------------------

def init_ballot_db() -> sqlite3.Connection:
    """
    Tables
    ------
    ballots        – encrypted ciphertexts + ZKP proofs (no voter identity)
    bulletin_board – public view (ciphertext + proof, real and fake look identical)

    is_fake flag
    ------------
    Both real and fake credentials produce identical-looking entries on the
    bulletin board.  The is_fake column is used internally by the Tally
    Filter to exclude fake-credential ballots from the homomorphic count.
    A coercer viewing the bulletin board cannot distinguish real from fake.
    """
    conn = sqlite3.connect(_db_path("ballot.db"))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ballots (
            ballot_id     TEXT PRIMARY KEY,
            token_hash    TEXT NOT NULL UNIQUE,  -- SHA-256(token); no voter ID stored
            ciphertext    TEXT NOT NULL,          -- Paillier-encrypted vote
            zkp_proof     TEXT NOT NULL,          -- serialised Sigma-protocol proof
            is_fake       INTEGER NOT NULL DEFAULT 0, -- 0 = real, 1 = fake
            submitted_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bulletin_board (
            entry_id      TEXT PRIMARY KEY,
            ciphertext    TEXT NOT NULL,
            zkp_proof     TEXT NOT NULL,
            submitted_at  TEXT NOT NULL
            -- NOTE: no token_hash, no is_fake – coercer sees this view only
        );
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Election Server database
# ---------------------------------------------------------------------------

def init_election_db() -> sqlite3.Connection:
    """
    Tables
    ------
    election_config – public key and election window
    ciphertexts     – real-credential ciphertexts collected for aggregation
                      (Election Server never holds the private key)
    """
    conn = sqlite3.connect(_db_path("election.db"))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS election_config (
            key           TEXT PRIMARY KEY,
            value         TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ciphertexts (
            ct_id         TEXT PRIMARY KEY,
            ciphertext    TEXT NOT NULL,     -- Paillier ciphertext (integer as text)
            received_at   TEXT NOT NULL
        );
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Tally Server database
# ---------------------------------------------------------------------------

def init_tally_db() -> sqlite3.Connection:
    """
    Tables
    ------
    tally_results – the ONE decryption event that ever happens in the system.
                    Private key is held ONLY by the Tally Server.
    """
    conn = sqlite3.connect(_db_path("tally.db"))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tally_results (
            election_id   TEXT PRIMARY KEY,
            total_votes   INTEGER NOT NULL,
            decrypted_at  TEXT NOT NULL,
            published     INTEGER NOT NULL DEFAULT 0
        );
    """)
    conn.commit()
    return conn


def seed_voters(conn: sqlite3.Connection) -> None:
    """Insert 20 synthetic voter records for testing."""
    voters = [
        (f"VOTER_{i:03d}", f"REGION_{(i % 4) + 1}", 1)
        for i in range(1, 21)
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO voters (voter_id, region_code, eligible) VALUES (?,?,?)",
        voters,
    )
    conn.commit()
    print(f"[DB] Seeded {len(voters)} synthetic voter records.")