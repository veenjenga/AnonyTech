"""
ballot_server/ballot_server.py
==============================
"""

import hashlib
import json
import math
import os
import sys
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import shared.paillier as phe
from shared.paillier import PaillierPublicKey, EncryptedNumber


# ---------------------------------------------------------------------------
# Postgres connection helper (same pattern as registration_server.py)
# ---------------------------------------------------------------------------

def _pg_conn():
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ.get("DB_PASSWORD", ""),
        dbname=os.environ.get("DB_NAME", "evoting_system"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


# ---------------------------------------------------------------------------
# Schema bootstrap
# ---------------------------------------------------------------------------

def _ensure_ballot_schema():
    """
    Ensure the ballots table has an `is_fake` column and that the
    bulletin_board table exists.  Both operations are non-destructive.
    """
    conn = _pg_conn()
    try:
        with conn.cursor() as cur:
            # Add is_fake to the existing ballots table if absent
            cur.execute("""
                ALTER TABLE ballots
                    ADD COLUMN IF NOT EXISTS is_fake BOOLEAN NOT NULL DEFAULT FALSE
            """)

            # Add crypto_ballot_id (uuid) for internal reference if absent
            cur.execute("""
                ALTER TABLE ballots
                    ADD COLUMN IF NOT EXISTS crypto_ballot_id TEXT
            """)

            # Public bulletin board — coercer-visible view (no is_fake, no voter link)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bulletin_board (
                    entry_id     TEXT        PRIMARY KEY,
                    ciphertext   TEXT        NOT NULL,
                    zkp_proof    TEXT        NOT NULL,
                    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)

        conn.commit()
        print("[Ballot Server] Postgres schema verified / migrated.")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# ZKP Verifier — Image 5: Vote Validity
# ---------------------------------------------------------------------------

class ZKPVerifier:
    """
    Verifies the disjunctive Sigma-protocol proof that a ciphertext
    encrypts 0 or 1.

    Verifier equation (per branch i in {0, 1}):
        A_check = z_i^n * (C * g^(-i))^(-e_i)  mod n^2

    This matches the corrected ZKPProver in voter_client.py, where:
      • Simulated branch: A_w = z_w^n * (C * g^(-w))^(-e_w)  (by construction)
      • Real branch:      A_v = k^n,  z_v = k * r_enc^(e_v) mod n^2
        Verification:     z_v^n * (C * g^(-v))^(-e_v)
                        = k^n * r_enc^(n*e_v) * (r_enc^n)^(-e_v)   [C·g^(-v) = r_enc^n]
                        = k^n = A_v  ✓

    Also checks Fiat-Shamir: SHA-256(C || A_0 || A_1) == challenge_total
    And: (e_0 + e_1) mod 2^256 == challenge_total mod 2^256

    Changed from the original implementation:
        The original verifier used:
            e_i_mod  = e_i % n_sq
            C_inv_e  = pow(C_int, n_sq - e_i_mod, n_sq)   # = C^(-(e_i % n_sq))
            A_check  = pow(g, i, n_sq) * pow(z_i, n, n_sq) * C_inv_e % n_sq

        This had two problems that caused every ballot to be rejected:
          1. It reduced e_i modulo n_sq before the exponent, but the prover
             derived e_v from a 256-bit Fiat-Shamir hash — different moduli
             made the verification inconsistent.
          2. The equation g^i * z_i^n * C^(-e_i) cannot be satisfied by a
             prover that only knows the Paillier randomness r_enc as a witness
             (the g^i factor does not cancel cleanly for i=1).

        The corrected equation z_i^n * (C * g^(-i))^(-e_i) uses Python's
        built-in pow(base, -exp, mod) (available since Python 3.8) which
        computes modular inverses correctly for arbitrary-size exponents,
        and the g^i cancellation works cleanly for both i=0 and i=1.
    """

    def __init__(self, paillier_public_key: PaillierPublicKey):
        self._pk = paillier_public_key

    def verify_proof(self, ciphertext_str: str, proof: dict) -> bool:
        try:
            n    = self._pk.n
            n_sq = n * n
            g    = n + 1

            if "ciphertext" not in proof:
                print("  [ZKP] Missing ciphertext in proof")
                return False

            C_int = int(proof["ciphertext"])

            if "entries" not in proof or len(proof["entries"]) != 2:
                print("  [ZKP] Invalid entries in proof")
                return False

            entries = proof["entries"]

            if "challenge_total" not in proof:
                print("  [ZKP] Missing challenge_total")
                return False

            claimed_total = int(proof["challenge_total"])
            A_values      = []
            e_sum         = 0

            for i, entry in enumerate(entries):
                if entry is None:
                    print(f"  [ZKP] Entry {i} is None")
                    return False

                if not all(k in entry for k in ("A", "e", "z")):
                    print(f"  [ZKP] Entry {i} missing required fields")
                    return False

                A_i = int(entry["A"])
                e_i = int(entry["e"])
                z_i = int(entry["z"])

                # Corrected verifier equation:
                #   A_check = z_i^n * (C * g^(-i))^(-e_i)  mod n^2
                #
                # pow(g, i, n_sq) gives g^i mod n^2.
                # pow(..., -1, n_sq) is the modular inverse (Python 3.8+).
                # pow(C_gi_inv, -e_i, n_sq) correctly handles 256-bit e_i
                # without reducing it to a different modulus first.
                g_i_inv  = pow(pow(g, i, n_sq), -1, n_sq)
                C_gi_inv = C_int * g_i_inv % n_sq
                A_check  = pow(z_i, n, n_sq) * pow(C_gi_inv, -e_i, n_sq) % n_sq

                if A_check != A_i:
                    print(f"  [ZKP] Branch {i} commitment mismatch.")
                    return False

                A_values.append(A_i)
                e_sum = (e_sum + e_i) % (2 ** 256)

            # Fiat-Shamir binding
            commitment_bytes = (
                str(C_int).encode()
                + str(A_values[0]).encode()
                + str(A_values[1]).encode()
            )
            expected_total = int(hashlib.sha256(commitment_bytes).hexdigest(), 16)

            if expected_total != claimed_total:
                print(f"  [ZKP] Fiat-Shamir mismatch.")
                return False

            if e_sum != claimed_total % (2 ** 256):
                print(f"  [ZKP] Challenge sum mismatch.")
                return False

            return True

        except Exception as exc:
            print(f"  [ZKP] Verification error: {exc}")
            return False


# ---------------------------------------------------------------------------
# Ballot Server
# ---------------------------------------------------------------------------

class BallotServer:
    """
    Implements the Ballot Server role 

    All persistent state is in Postgres.  An in-memory set tracks fake
    token hashes within the current process lifetime for fast lookup
    (Postgres is the source of truth for cross-restart durability).

    Public interface
    ----------------
    receive_ballot(token, signature, ciphertext_str, zkp_proof, is_fake,
                   role_id="unknown")
        → {'accepted': bool, 'ballot_id': str} | {'accepted': False, 'reason': str}

    get_real_ciphertexts()   → list[str]
    get_bulletin_board()     → list[dict]
    ballot_count()           → dict
    """

    def __init__(self, reg_server, paillier_public_key: PaillierPublicKey):
        self._reg              = reg_server
        self._verifier         = ZKPVerifier(paillier_public_key)
        self._paillier_pk      = paillier_public_key
        # In-memory fast-lookup set for fake token hashes (seeded from DB on init)
        self._fake_token_hashes: set[str] = set()

        _ensure_ballot_schema()
        self._load_fake_hashes_from_db()
        print("[Ballot Server] Initialised (Postgres backend).")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_fake_hashes_from_db(self):
        """Restore fake token hash set from Postgres after a restart."""
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT token_hash FROM ballots WHERE is_fake = TRUE AND token_hash IS NOT NULL"
                )
                for row in cur.fetchall():
                    self._fake_token_hashes.add(row["token_hash"])
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Fake credential management (Image 4: coercion resistance)
    # ------------------------------------------------------------------

    def issue_fake_credential_hash(self, fake_token: int) -> str:
        """Register a token hash as belonging to a fake credential."""
        token_hash = hashlib.sha256(str(fake_token).encode()).hexdigest()
        self._fake_token_hashes.add(token_hash)
        print(f"  [Ballot Server] Fake credential registered: {token_hash[:16]}…")
        return token_hash

    # ------------------------------------------------------------------
    # Core ballot reception
    # ------------------------------------------------------------------

    def receive_ballot(
        self,
        token: int,
        signature: int,
        ciphertext_str: str,
        zkp_proof: dict,
        is_fake: bool = False,
        role_id: str = "unknown",
    ) -> dict:
        """
        Accept or reject an incoming ballot.

        Steps
        -----
        1. RSA signature verification (skip for fake ballots)
        2. Duplicate token check
        3. ZKP proof verification
        4. Classify real vs fake
        5. Store anonymously in Postgres (no voter_id anywhere)
        6. Post to public bulletin board
        """
        token_hash = hashlib.sha256(str(token).encode()).hexdigest()

        # 1. RSA signature verification
        if not is_fake:
            if not self._reg.verify_rsa_signature(token, signature):
                return {"accepted": False, "reason": "Invalid RSA token signature."}
            print(f"  [Signature] Valid RSA signature verified")
        else:
            if token_hash not in self._fake_token_hashes:
                self._fake_token_hashes.add(token_hash)
                print(f"  [Fake ballot] Auto-registered fake credential: {token_hash[:16]}…")

        # 2. Duplicate token check (Postgres)
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM ballots WHERE token_hash = %s",
                    (token_hash,),
                )
                if cur.fetchone():
                    return {"accepted": False, "reason": "Duplicate token — ballot already submitted."}

            # 3. ZKP validity verification
            proof_valid = self._verifier.verify_proof(ciphertext_str, zkp_proof)
            if not proof_valid:
                print("  [WARNING] ZKP verification failed — rejecting ballot.")
                return {
                    "accepted": False,
                    "reason": "ZKP proof invalid — ballot rejected (vote must be 0 or 1).",
                }

            # 4. Classify
            is_fake_flag = is_fake or (token_hash in self._fake_token_hashes)

            # 5. Store anonymously — no voter_id, no student_id anywhere
            ballot_id = str(uuid.uuid4())
            now       = datetime.now(timezone.utc).isoformat()
            proof_str = json.dumps(zkp_proof)

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ballots
                        (role_id, token_hash, ciphertext, zkp_proof, is_real, is_fake,
                         crypto_ballot_id, submitted_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        role_id,
                        token_hash,
                        ciphertext_str,
                        proof_str,
                        not is_fake_flag,   # is_real  (server.js column)
                        is_fake_flag,       # is_fake  (our new column)
                        ballot_id,
                        now,
                    ),
                )

                # 6. Public bulletin board
                cur.execute(
                    """
                    INSERT INTO bulletin_board (entry_id, ciphertext, zkp_proof, submitted_at)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (ballot_id, ciphertext_str, proof_str, now),
                )

            conn.commit()

        except Exception as exc:
            conn.rollback()
            print(f"[Ballot Server] DB error: {exc}")
            return {"accepted": False, "reason": f"Database error: {exc}"}
        finally:
            conn.close()

        cred_type = "FAKE" if is_fake_flag else "REAL"
        print(
            f"[Ballot Server] Ballot {ballot_id[:8]}… accepted. "
            f"Credential: {cred_type}. Token hash: {token_hash[:16]}…"
        )
        return {"accepted": True, "ballot_id": ballot_id}

    # ------------------------------------------------------------------
    # Tally Filter
    # ------------------------------------------------------------------

    def get_real_ciphertexts(self) -> list[str]:
        """Return only real-credential ciphertexts for homomorphic aggregation."""
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT ciphertext FROM ballots WHERE is_fake = FALSE AND is_real = TRUE"
                )
                return [row["ciphertext"] for row in cur.fetchall()]
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Public bulletin board
    # ------------------------------------------------------------------

    def get_bulletin_board(self) -> list[dict]:
        """All entries look identical — real and fake are indistinguishable."""
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT entry_id, ciphertext, zkp_proof, submitted_at FROM bulletin_board"
                )
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def ballot_count(self) -> dict:
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS n FROM ballots")
                total = cur.fetchone()["n"]
                cur.execute("SELECT COUNT(*) AS n FROM ballots WHERE is_fake = TRUE")
                fake = cur.fetchone()["n"]
            return {"total": total, "real": total - fake, "fake": fake}
        finally:
            conn.close()