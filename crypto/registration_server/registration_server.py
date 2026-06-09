"""
registration_server/registration_server.py
==========================================
"""

import hashlib
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# ---------------------------------------------------------------------------
# Postgres connection helper
# ---------------------------------------------------------------------------

def _pg_conn():
    """
    Open a fresh psycopg2 connection using environment variables that
    match the server.js .env file:
        DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
    Falls back to sensible defaults so the service starts even without a
    fully-populated environment.
    """
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ.get("DB_PASSWORD", ""),
        dbname=os.environ.get("DB_NAME", "evoting_system"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


# ---------------------------------------------------------------------------
# Schema bootstrap (Postgres)
# ---------------------------------------------------------------------------

def _ensure_schema():
    """
    Create the `crypto_issued_tokens` table in Postgres if it does not
    exist.  The `voters` table is owned by the Node backend — we only
    read it and update `credential_issued` / `has_voted` columns.

    We also add the `credential_issued` column to `voters` if the Node
    schema hasn't added it yet, so the crypto layer can track issuance
    without breaking the existing schema.
    """
    conn = _pg_conn()
    try:
        with conn.cursor() as cur:
            # Table for recording blind-signature issuance hashes
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crypto_issued_tokens (
                    token_hash  TEXT        PRIMARY KEY,
                    issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)

            # Add credential_issued to voters if missing (non-destructive)
            cur.execute("""
                ALTER TABLE voters
                    ADD COLUMN IF NOT EXISTS credential_issued BOOLEAN NOT NULL DEFAULT FALSE
            """)

        conn.commit()
        print("[Reg Server] Postgres schema verified / migrated.")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Key management  (unchanged from original — RSA keys live on disk)
# ---------------------------------------------------------------------------

KEY_DIR = os.path.join(os.path.dirname(__file__), "..", "keys")


def _key_paths():
    os.makedirs(KEY_DIR, exist_ok=True)
    return (
        os.path.join(KEY_DIR, "reg_private.pem"),
        os.path.join(KEY_DIR, "reg_public.pem"),
    )


def generate_rsa_keypair(key_size: int = 2048):
    """Generate and persist the Registration Server's RSA key pair."""
    priv_path, pub_path = _key_paths()
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    public_key = private_key.public_key()

    with open(priv_path, "wb") as f:
        f.write(
            private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            )
        )
    with open(pub_path, "wb") as f:
        f.write(
            public_key.public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
        )
    print("[Reg Server] RSA-2048 key pair generated and saved.")
    return private_key, public_key


def load_private_key():
    priv_path, _ = _key_paths()
    with open(priv_path, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def load_public_key():
    _, pub_path = _key_paths()
    with open(pub_path, "rb") as f:
        return serialization.load_pem_public_key(f.read())


# ---------------------------------------------------------------------------
# RSA Blind Signature — mathematical core  (unchanged)
# ---------------------------------------------------------------------------
#
# Standard RSA parameters:  n = p*q,  e = public exponent,  d = private exponent
#
# Blinding  (voter side, not done here — see voter_client.py):
#     m' = m · r^e  (mod n)          where r is the blinding factor
#
# Signing   (server side — THIS FILE):
#     s' = (m')^d  (mod n)
#
# Unblinding (voter side, not done here — see voter_client.py):
#     s  = s' · r⁻¹  (mod n)         valid RSA signature on m
# ---------------------------------------------------------------------------

def sign_blinded_token(blinded_token_int: int, private_key) -> int:
    """
    Sign the blinded token with the RSA private key (raw modular exponentiation).

    The server receives only m' (the blinded token integer).
    It returns s' = (m')^d mod n.
    It never sees m (the actual token) or r (the blinding factor).
    """
    priv_numbers = private_key.private_numbers()
    d = priv_numbers.d
    n = priv_numbers.public_numbers.n
    return pow(blinded_token_int, d, n)


# ---------------------------------------------------------------------------
# Registration Server API
# ---------------------------------------------------------------------------

class RegistrationServer:
    """
    Implements the Registration Server role from Image 2.

    All voter data is now stored in / read from the shared Postgres
    database (same DB as server.js).  No SQLite files are created or
    used by this class.

    Public interface
    ----------------
    seed_real_voters(voter_ids)            → None  (upsert eligible voters)
    authenticate_voter(voter_id)           → dict
    issue_blind_signature(voter_id, m')    → dict  (s', the blind signature)
    verify_rsa_signature(token, sig)       → bool  (used by Ballot Server)
    get_public_key_params()                → dict {n, e}
    reset_voter(voter_id)                  → None  (admin/dev: clear credential)
    """

    def __init__(self):
        priv_path, _ = _key_paths()
        if not os.path.exists(priv_path):
            self._private_key, self._public_key = generate_rsa_keypair()
        else:
            self._private_key = load_private_key()
            self._public_key  = load_public_key()

        _ensure_schema()
        print("[Reg Server] Initialised (Postgres backend).")

    # ------------------------------------------------------------------
    # Seed real voters  (called by crypto_api seed-voters endpoint)
    # ------------------------------------------------------------------

    def seed_real_voters(self, voter_ids: list[str]) -> None:
        """
        No-op: voters are already in the shared Postgres `voters` table
        managed by server.js.  This method exists so crypto_api.py can
        call it without changes; we simply ensure credential_issued
        defaults to FALSE for any newly seen student_ids.

        If the voter does NOT exist in the `voters` table this call is
        still a no-op — the Node backend is the authoritative source for
        voter registration.
        """
        if not voter_ids:
            return

        # Make sure credential_issued is FALSE for voters that were just
        # added by the Node backend (INSERT by Node sets it to default=FALSE
        # so this is normally redundant, but keeps the contract clear).
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                # Only touch rows that actually exist in Postgres voters table
                cur.execute(
                    """
                    UPDATE voters
                       SET credential_issued = FALSE
                     WHERE student_id = ANY(%s)
                       AND credential_issued IS NULL
                    """,
                    (voter_ids,),
                )
            conn.commit()
        except Exception:
            conn.rollback()
        finally:
            conn.close()

        print(f"[Reg Server] seed_real_voters: acknowledged {len(voter_ids)} voter(s) from Postgres.")

    # ------------------------------------------------------------------
    # Step 1 — Authenticate voter & verify eligibility
    # ------------------------------------------------------------------

    def authenticate_voter(self, voter_id: str) -> dict:
        """
        Verify voter eligibility by querying the shared Postgres voters table.

        A voter is eligible if:
          • A row with student_id = voter_id exists in `voters`
          • credential_issued IS NOT TRUE  (no duplicate issuance)
        """
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT student_id, credential_issued
                      FROM voters
                     WHERE student_id = %s
                     LIMIT 1
                    """,
                    (voter_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()

        if row is None:
            return {"ok": False, "reason": "Voter not found in registry."}

        if row["credential_issued"]:
            return {"ok": False, "reason": "Credential already issued (duplicate check)."}

        return {"ok": True, "voter_id": voter_id}

    # ------------------------------------------------------------------
    # Step 2 — Sign blinded token
    # ------------------------------------------------------------------

    def issue_blind_signature(self, voter_id: str, blinded_token_int: int) -> dict:
        """
        Core blind-signature operation.

        1. Re-checks eligibility.
        2. Signs m' with its private key d → s' = (m')^d mod n.
        3. Records only a hash of the blinded token in crypto_issued_tokens.
        4. Marks the voter's credential_issued = TRUE in the Postgres voters table.
        """
        auth = self.authenticate_voter(voter_id)
        if not auth["ok"]:
            return {"error": auth["reason"]}

        token_hash = hashlib.sha256(str(blinded_token_int).encode()).hexdigest()

        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                # Prevent duplicate signing of the same blinded value
                cur.execute(
                    "SELECT 1 FROM crypto_issued_tokens WHERE token_hash = %s",
                    (token_hash,),
                )
                if cur.fetchone():
                    return {"error": "Blinded token already signed."}

                blind_sig = sign_blinded_token(blinded_token_int, self._private_key)

                # Record issuance hash (no raw token stored)
                cur.execute(
                    "INSERT INTO crypto_issued_tokens (token_hash) VALUES (%s)",
                    (token_hash,),
                )

                # Mark voter as having received their credential
                cur.execute(
                    "UPDATE voters SET credential_issued = TRUE WHERE student_id = %s",
                    (voter_id,),
                )

            conn.commit()
        except Exception as exc:
            conn.rollback()
            return {"error": f"Database error during issuance: {exc}"}
        finally:
            conn.close()

        print(
            f"[Reg Server] Blind signature issued for voter {voter_id}. "
            f"Token hash recorded: {token_hash[:16]}…"
        )
        return {"blind_signature": blind_sig}

    # ------------------------------------------------------------------
    # Step 3 — Verify RSA signature validity (called by Ballot Server)
    # ------------------------------------------------------------------

    def verify_rsa_signature(self, token_int: int, signature_int: int) -> bool:
        """
        Verify that (token, sig) is a valid RSA signature from this server.
        Uses the public key: check  sig^e ≡ token (mod n).
        """
        pub_numbers = self._public_key.public_numbers()
        e = pub_numbers.e
        n = pub_numbers.n
        return pow(signature_int, e, n) == token_int

    # ------------------------------------------------------------------
    # Public key export
    # ------------------------------------------------------------------

    def get_public_key_params(self) -> dict:
        """Return {n, e} so voters can blind tokens and Ballot Server can verify."""
        pub_numbers = self._public_key.public_numbers()
        return {"n": pub_numbers.n, "e": pub_numbers.e}

    # ------------------------------------------------------------------
    # Admin / dev: reset a voter's credential
    # ------------------------------------------------------------------

    def reset_voter(self, voter_id: str) -> None:
        """
        Clear a voter's credential_issued flag so they can re-register.
        For admin / dev use only.
        """
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE voters SET credential_issued = FALSE WHERE student_id = %s",
                    (voter_id,),
                )
            conn.commit()
        finally:
            conn.close()
        print(f"[Reg Server] Voter {voter_id} credential reset.")


# ---------------------------------------------------------------------------
# Quick smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import random

    # Load .env if python-dotenv is available
    try:
        from dotenv import load_dotenv
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        load_dotenv(env_path)
        print(f"[Smoke test] Loaded .env from {env_path}")
    except ImportError:
        print("[Smoke test] python-dotenv not installed; using existing environment vars.")

    server = RegistrationServer()
    params = server.get_public_key_params()
    print(f"\nPublic key  n={str(params['n'])[:40]}…  e={params['e']}")

    # Simulate a voter blinding a token (normally done in voter_client.py)
    n = params["n"]
    e = params["e"]
    token = random.randint(2, n - 1)
    r = random.randint(2, n - 1)
    blinded = (token * pow(r, e, n)) % n

    # Use first voter in Postgres for the smoke test
    conn = _pg_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT student_id FROM voters LIMIT 1")
        row = cur.fetchone()
    conn.close()

    if not row:
        print("[Smoke test] No voters in Postgres — add at least one voter first.")
        raise SystemExit(1)

    test_voter = row["student_id"]
    print(f"\n[Smoke test] Using voter: {test_voter}")

    # Reset first so we start clean
    server.reset_voter(test_voter)

    result = server.issue_blind_signature(test_voter, blinded)
    if "error" in result:
        print(f"[FAIL] {result['error']}")
    else:
        blind_sig = result["blind_signature"]
        r_inv = pow(r, -1, n)
        real_sig = (blind_sig * r_inv) % n
        valid = server.verify_rsa_signature(token, real_sig)
        print(f"\n[Smoke test] Signature valid: {valid}")
        assert valid, "Signature verification failed!"
        print("[Smoke test] PASSED — Registration Server works correctly.")

        # Clean up
        server.reset_voter(test_voter)