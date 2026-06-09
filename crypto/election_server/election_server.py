"""
election_server/election_server.py
===================================
"""

import json
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import shared.paillier as phe
from shared.paillier import (
    PaillierPublicKey, PaillierPrivateKey, EncryptedNumber,
    generate_paillier_keypair,
)

KEY_DIR = os.path.join(os.path.dirname(__file__), "..", "keys")
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "election.db")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS election_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ciphertexts (
            ct_id       TEXT PRIMARY KEY,
            ciphertext  TEXT NOT NULL,
            received_at TEXT NOT NULL
        );
    """)
    conn.commit()


@contextmanager
def _db():
    """
    Open a fresh SQLite connection for the current thread, yield it, then
    close it.  Using check_same_thread=False as belt-and-suspenders, but
    because every call site opens and closes its own connection there is no
    cross-thread sharing.
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        _init_schema(conn)
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Key management
# ---------------------------------------------------------------------------

def _paillier_key_paths():
    os.makedirs(KEY_DIR, exist_ok=True)
    return (
        os.path.join(KEY_DIR, "paillier_public.json"),
        os.path.join(KEY_DIR, "paillier_private.json"),
    )


def _generate_and_save_keypair(key_size: int = 1024):
    pub_path, priv_path = _paillier_key_paths()
    public_key, private_key = phe.generate_paillier_keypair(n_length=key_size)

    with open(pub_path, "w") as f:
        json.dump({"n": str(public_key.n)}, f)

    with open(priv_path, "w") as f:
        json.dump({"p": str(private_key.p), "q": str(private_key.q)}, f)

    print(f"[Election Server] Paillier-{key_size} key pair generated.")
    return public_key, private_key


def load_paillier_public_key() -> PaillierPublicKey:
    pub_path, _ = _paillier_key_paths()
    with open(pub_path) as f:
        data = json.load(f)
    return PaillierPublicKey(n=int(data["n"]))


def load_paillier_private_key(public_key: PaillierPublicKey) -> PaillierPrivateKey:
    _, priv_path = _paillier_key_paths()
    with open(priv_path) as f:
        data = json.load(f)
    return PaillierPrivateKey(public_key, p=int(data["p"]), q=int(data["q"]))


# ---------------------------------------------------------------------------
# Election Server
# ---------------------------------------------------------------------------

class ElectionServer:
    """
    Implements the Election Server / Election Administrator role from Image 3.

    All DB access uses _db() context manager (one fresh connection per call),
    eliminating the cross-thread SQLite ProgrammingError entirely.
    """

    def __init__(self):
        pub_path, _ = _paillier_key_paths()
        if not os.path.exists(pub_path):
            self._public_key, _ = _generate_and_save_keypair()
        else:
            self._public_key = load_paillier_public_key()

        # Ensure schema exists at startup (runs on main thread — fine)
        with _db():
            pass

        self._is_open = False
        self._election_id: str | None = None
        print("[Election Server] Initialised.")

    # ------------------------------------------------------------------
    # Election lifecycle
    # ------------------------------------------------------------------

    def get_public_key(self) -> phe.PaillierPublicKey:
        return self._public_key

    def open_election(self, election_id: str = "ELECTION_2026") -> bool:
        self._election_id = election_id
        self._is_open = True
        now = datetime.now(timezone.utc).isoformat()
        with _db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO election_config (key, value) VALUES (?,?)",
                ("election_id", election_id),
            )
            conn.execute(
                "INSERT OR REPLACE INTO election_config (key, value) VALUES (?,?)",
                ("opened_at", now),
            )
            conn.execute(
                "INSERT OR REPLACE INTO election_config (key, value) VALUES (?,?)",
                ("status", "OPEN"),
            )
            conn.commit()
        print(f"[Election Server] Election '{election_id}' OPENED at {now}.")
        return True

    def close_election(self) -> bool:
        if not self._is_open:
            print("[Election Server] Election is not open.")
            return False
        self._is_open = False
        now = datetime.now(timezone.utc).isoformat()
        with _db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO election_config (key, value) VALUES (?,?)",
                ("closed_at", now),
            )
            conn.execute(
                "INSERT OR REPLACE INTO election_config (key, value) VALUES (?,?)",
                ("status", "CLOSED"),
            )
            conn.commit()
        print(f"[Election Server] Election CLOSED at {now}.")
        return True

    def get_election_status(self) -> str:
        with _db() as conn:
            row = conn.execute(
                "SELECT value FROM election_config WHERE key='status'"
            ).fetchone()
        return row[0] if row else "NOT_STARTED"

    # ------------------------------------------------------------------
    # Ciphertext storage
    # ------------------------------------------------------------------

    def store_ciphertext(self, ciphertext_str: str) -> str | None:
        if not self._is_open:
            print("[Election Server] Ciphertext rejected — election is closed.")
            return None

        ct_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        with _db() as conn:
            conn.execute(
                "INSERT INTO ciphertexts (ct_id, ciphertext, received_at) VALUES (?,?,?)",
                (ct_id, ciphertext_str, now),
            )
            conn.commit()
        return ct_id

    def load_ciphertexts_from_ballot_server(self, ciphertext_strings: list[str]) -> int:
        """
        Bulk-load real-credential ciphertexts from the Ballot Server.
        Bypasses the is_open guard — called after close_election() in the
        tally pipeline, so we write directly.
        """
        count = 0
        now = datetime.now(timezone.utc).isoformat()
        with _db() as conn:
            for ct_str in ciphertext_strings:
                ct_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO ciphertexts (ct_id, ciphertext, received_at) VALUES (?,?,?)",
                    (ct_id, ct_str, now),
                )
                count += 1
            conn.commit()
        print(f"[Election Server] Loaded {count} real-credential ciphertexts.")
        return count

    # ------------------------------------------------------------------
    # Homomorphic aggregation
    # ------------------------------------------------------------------

    def combine_ciphertexts_homomorphically(self) -> phe.EncryptedNumber | None:
        """
        C_total = C_1 × C_2 × … × C_n  mod n²
        Enc(a) × Enc(b) ≡ Enc(a + b)  — Paillier additive homomorphism.
        """
        with _db() as conn:
            rows = conn.execute("SELECT ciphertext FROM ciphertexts").fetchall()

        if not rows:
            print("[Election Server] No ciphertexts to combine.")
            return None

        print(f"[Election Server] Combining {len(rows)} ciphertexts homomorphically…")
        combined = self._deserialise_ct(rows[0][0])
        for row in rows[1:]:
            combined = combined + self._deserialise_ct(row[0])

        print(
            f"[Election Server] Combined ciphertext computed.  "
            f"Value: {str(combined.ciphertext())[:40]}…  (unreadable without private key)"
        )
        return combined

    def _deserialise_ct(self, ct_str: str) -> phe.EncryptedNumber:
        data = json.loads(ct_str)
        return phe.EncryptedNumber(
            self._public_key, int(data["ciphertext"]), data["exponent"]
        )

    def ciphertext_count(self) -> int:
        with _db() as conn:
            return conn.execute("SELECT COUNT(*) FROM ciphertexts").fetchone()[0]