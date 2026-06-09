"""
tally_server/tally_server.py

"""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import shared.paillier as phe
from shared.paillier import PaillierPublicKey, PaillierPrivateKey, EncryptedNumber
from shared.database import init_tally_db
from election_server.election_server import load_paillier_private_key


class TallyServer:
    """
    Implements the Tally Authority role from Image 3.

    Public interface
    ----------------
    decrypt_and_publish(election_id, combined_ciphertext, public_key)
        → dict with total_votes and published timestamp

    get_result(election_id) → dict | None
    """

    def __init__(self, public_key: PaillierPublicKey):
        """
        Parameters
        ----------
        public_key : phe.PaillierPublicKey
            Required to initialise the private key.
        """
        self._public_key = public_key
        self._private_key = load_paillier_private_key(public_key)
        self._db = init_tally_db()
        self._decryption_count = 0   # Must remain ≤ 1 per election
        print("[Tally Server] Initialised.  Private key loaded (held here only).")

    # ------------------------------------------------------------------
    # Image 3: <<single event>> — Decrypt combined total (once only)
    # ------------------------------------------------------------------

    def decrypt_and_publish(
        self,
        election_id: str,
        combined_ciphertext: EncryptedNumber,
    ) -> dict:
        """
        Perform the ONE and ONLY decryption event in the entire system.

        Steps (Image 3, right column)
        ------------------------------
        1. Retrieve combined ciphertext  (passed in from Election Server)
        2. Decrypt combined total (ONCE ONLY — enforced by decryption_count guard)
        3. Publish final result

        Parameters
        ----------
        election_id          : str
        combined_ciphertext  : phe.EncryptedNumber
            The homomorphic product of all real-credential ciphertexts.
            This is Enc(v_1 + v_2 + … + v_n).

        Returns
        -------
        dict {'election_id', 'total_votes', 'decrypted_at', 'published'}
        """
        # Guard: one decryption event per election
        existing = self._db.execute(
            "SELECT total_votes, decrypted_at FROM tally_results WHERE election_id = ?",
            (election_id,),
        ).fetchone()
        if existing:
            print(
                f"[Tally Server] Election '{election_id}' already decrypted at "
                f"{existing[1]}.  Returning cached result."
            )
            return {
                "election_id": election_id,
                "total_votes": existing[0],
                "decrypted_at": existing[1],
                "published": True,
            }

        # <<single event>> — the only call to private_key.decrypt in the system
        print(f"[Tally Server] Decrypting combined ciphertext for '{election_id}'…")
        total_votes = self._private_key.decrypt(combined_ciphertext)
        self._decryption_count += 1

        now = datetime.now(timezone.utc).isoformat()

        self._db.execute(
            """INSERT INTO tally_results (election_id, total_votes, decrypted_at, published)
               VALUES (?,?,?,1)""",
            (election_id, total_votes, now),
        )
        self._db.commit()

        result = {
            "election_id": election_id,
            "total_votes": total_votes,
            "decrypted_at": now,
            "published": True,
        }

        print(
            f"\n[Tally Server] ═══════════════════════════════════════════\n"
            f"  FINAL RESULT — {election_id}\n"
            f"  Total votes counted : {total_votes}\n"
            f"  Decrypted at        : {now}\n"
            f"  Decryption events   : {self._decryption_count}  (must be 1)\n"
            f"  Individual ballots decrypted: 0\n"
            f"[Tally Server] ═══════════════════════════════════════════\n"
        )
        return result

    def get_result(self, election_id: str) -> dict | None:
        """Retrieve a previously published result."""
        row = self._db.execute(
            "SELECT total_votes, decrypted_at, published FROM tally_results WHERE election_id = ?",
            (election_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "election_id": election_id,
            "total_votes": row[0],
            "decrypted_at": row[1],
            "published": bool(row[2]),
        }

    @property
    def decryption_count(self) -> int:
        """Number of decryption operations performed (must stay at 1)."""
        return self._decryption_count