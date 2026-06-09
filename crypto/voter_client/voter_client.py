"""
voter_client/voter_client.py
============================
Client-side crypto for the AnonyTech voting system.

Coercion-Resistance (Mode A / Mode B)
--------------------------------------
  Mode A (fake / coercion):
    • The voter gets a real blind signature from the Registration Server
      so that credential_issued = TRUE in Postgres.
    • They cast a ballot marked is_fake=True.
    • After the session, server.js resets has_voted=FALSE and
      credential_issued=FALSE so the voter can return for Mode B.
    • The fake ballot appears on the bulletin board indistinguishably from
      a real one — a coercer cannot tell the difference.

  Mode B (real / final):
    • Normal blind-signature registration → real ballot → has_voted=TRUE.
    • Counted in the homomorphic tally.

ZKP (Zero-Knowledge Proof)
---------------------------
  VoterClient uses ZKPProver which constructs a disjunctive Sigma-protocol
  proof that the encrypted vote is 0 or 1, without revealing which.
  BallotServer.ZKPVerifier verifies the proof before accepting the ballot.
"""

import hashlib
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import shared.paillier as _paillier
from shared.paillier import PaillierPublicKey, EncryptedNumber


# ---------------------------------------------------------------------------
# Token blinding  (RSA blind signature, voter side)
# ---------------------------------------------------------------------------

class TokenBlinder:
    def __init__(self, pub_key_params: dict):
        self.n = pub_key_params["n"]
        self.e = pub_key_params["e"]

    def generate_token(self) -> int:
        return random.randint(2, self.n - 1)

    def blind(self, token: int) -> tuple[int, int]:
        """Return (blinded_token, blinding_factor r)."""
        r = random.randint(2, self.n - 1)
        while math.gcd(r, self.n) != 1:
            r = random.randint(2, self.n - 1)
        blinded = (token * pow(r, self.e, self.n)) % self.n
        return blinded, r

    def unblind(self, blind_signature: int, blinding_factor: int) -> int:
        r_inv = pow(blinding_factor, -1, self.n)
        return (blind_signature * r_inv) % self.n


# ---------------------------------------------------------------------------
# Vote encryption  (Paillier)
# ---------------------------------------------------------------------------

class VoteEncryptor:
    def __init__(self, paillier_public_key: PaillierPublicKey):
        self._pk = paillier_public_key

    def encrypt_vote(self, vote_value: int) -> tuple["EncryptedNumber", int]:
        """
        Encrypt vote_value and return (EncryptedNumber, r_enc).

        r_enc is the Paillier encryption randomness.  The ZKPProver uses it
        as the witness for the real branch of the disjunctive Sigma-protocol.

        Changed from the original (which returned only EncryptedNumber):
        the randomness r_enc is now returned alongside the ciphertext so
        that ZKPProver.generate_proof() can construct a sound proof.
        """
        if vote_value not in (0, 1):
            raise ValueError("Vote value must be 0 or 1.")
        n    = self._pk.n
        n_sq = self._pk.n_sq
        g    = self._pk.g
        # Choose r_enc coprime to n (same logic as shared.paillier._raw_encrypt)
        r_enc = random.randrange(1, n)
        while math.gcd(r_enc, n) != 1:
            r_enc = random.randrange(1, n)
        gm  = (1 + vote_value * n) % n_sq
        rn  = pow(r_enc, n, n_sq)
        raw = (gm * rn) % n_sq
        return EncryptedNumber(self._pk, raw), r_enc

    @staticmethod
    def ciphertext_to_str(encrypted_number: EncryptedNumber) -> str:
        return json.dumps({
            "ciphertext": str(encrypted_number.ciphertext()),
            "exponent":   encrypted_number.exponent,
        })

    @staticmethod
    def str_to_ciphertext(ct_str: str, public_key: PaillierPublicKey) -> EncryptedNumber:
        data = json.loads(ct_str)
        return EncryptedNumber(public_key, int(data["ciphertext"]), data["exponent"])


# ---------------------------------------------------------------------------
# ZKP Prover — disjunctive Sigma-protocol (Image 5)
# ---------------------------------------------------------------------------

class ZKPProver:
    """
    Constructs a valid disjunctive Sigma-protocol proof that a Paillier
    ciphertext C encrypts either 0 or 1 — without revealing which.

    Proof structure (corrected single-pass OR-proof)
    -------------------------------------------------
    Given: C = g^v * r_enc^n mod n^2  (known to prover, v in {0,1})
    Witness: r_enc (Paillier encryption randomness for the real branch)

    For the SIMULATED branch w = 1-v  (no witness needed):
        Choose e_w, z_w randomly (coprime to n).
        Compute A_w = z_w^n * (C * g^(-w))^(-e_w) mod n^2.
        This satisfies the verifier equation by construction.

    For the REAL branch v  (witness = r_enc):
        Choose random k coprime to n (commitment randomness).
        Commit: A_v = k^n mod n^2  (before e_v is known).
        Build canonical A_list[v]=A_v, A_list[w]=A_w.
        Fiat-Shamir: e_total = SHA-256(C || A_list[0] || A_list[1]).
        Derive: e_v = (e_total - e_w) mod 2^256.
        Respond: z_v = k * r_enc^e_v mod n^2.

    Verifier equation (applied to BOTH branches by BallotServer.ZKPVerifier):
        A_check = z_i^n * (C * g^(-i))^(-e_i) mod n^2

    Correctness of real-branch response:
        z_v^n * (C * g^(-v))^(-e_v)
        = (k * r_enc^e_v)^n * (g^v * r_enc^n * g^(-v))^(-e_v)    [C = g^v * r_enc^n]
        = k^n * r_enc^(n*e_v) * (r_enc^n)^(-e_v)
        = k^n * r_enc^(n*e_v) * r_enc^(-n*e_v)
        = k^n = A_v  ✓

    The simulated branch satisfies the equation by construction. ✓
    Fiat-Shamir binding: SHA-256(C||A_0||A_1) == e_total. ✓
    (e_0 + e_1) mod 2^256 == e_total mod 2^256. ✓
    """

    def __init__(self, paillier_public_key: PaillierPublicKey):
        self._pk = paillier_public_key

    def generate_proof(
        self,
        vote_value: int,
        encrypted_vote: EncryptedNumber,
        r_enc: int,
    ) -> dict:
        """
        Generate a ZKP proof for the given ciphertext.

        Parameters
        ----------
        vote_value    : int — the actual vote (0 or 1), kept secret
        encrypted_vote: EncryptedNumber — Paillier ciphertext of vote_value
        r_enc         : int — the Paillier randomness used during encryption
                        (returned by VoteEncryptor.encrypt_vote)

        Returns
        -------
        dict with keys: ciphertext, entries (list of 2 branch dicts), challenge_total
        """
        n    = self._pk.n
        n_sq = n * n
        g    = n + 1

        v = vote_value    # real branch  (0 or 1)
        w = 1 - v         # simulated branch
        C = encrypted_vote.ciphertext()

        # ── Step 1: Simulate the w-branch (no witness needed) ────────
        # Choose e_w and z_w freely (z_w coprime to n).
        e_w = random.randint(1, 2 ** 128)
        z_w = random.randint(2, n - 1)
        while math.gcd(z_w, n) != 1:
            z_w = random.randint(2, n - 1)
        # A_w satisfies the verifier equation by construction:
        #   A_w = z_w^n * (C * g^(-w))^(-e_w) mod n^2
        g_w_inv  = pow(pow(g, w, n_sq), -1, n_sq)
        C_gw_inv = C * g_w_inv % n_sq
        A_w      = pow(z_w, n, n_sq) * pow(C_gw_inv, -e_w, n_sq) % n_sq

        # ── Step 2: Commit the v-branch (before knowing e_v) ─────────
        # Choose commitment randomness k coprime to n.
        k = random.randint(2, n - 1)
        while math.gcd(k, n) != 1:
            k = random.randint(2, n - 1)
        A_v = pow(k, n, n_sq)

        # ── Step 3: Fiat-Shamir hash ──────────────────────────────────
        A_list    = [None, None]
        A_list[v] = A_v
        A_list[w] = A_w
        e_total   = int(
            hashlib.sha256(
                str(C).encode()
                + str(A_list[0]).encode()
                + str(A_list[1]).encode()
            ).hexdigest(),
            16,
        )

        # ── Step 4: Derive e_v and respond ────────────────────────────
        e_v = (e_total - e_w) % (2 ** 256)
        # z_v = k * r_enc^e_v mod n^2
        # (all arithmetic in Z/n^2, not Z/n — see class docstring)
        z_v = k * pow(r_enc, e_v, n_sq) % n_sq

        # ── Step 5: Build canonical proof dict ────────────────────────
        entries       = [None, None]
        entries[v]    = {"A": str(A_v), "e": str(e_v), "z": str(z_v)}
        entries[w]    = {"A": str(A_w), "e": str(e_w), "z": str(z_w)}

        return {
            "ciphertext":      str(C),
            "entries":         entries,
            "challenge_total": str(e_total),
        }


# ---------------------------------------------------------------------------
# VoterClient
# ---------------------------------------------------------------------------

class VoterClient:
    """
    Represents a single voter's client-side session.

    Coercion resistance
    -------------------
    register() obtains ONE blind signature from the Registration Server,
    marking credential_issued=TRUE in Postgres.

    For Mode A (fake vote):
        cast_vote(value, is_fake=True) submits a ballot with is_fake=True.
        After returning from the ballot page, server.js resets
        credential_issued and has_voted in Postgres so the voter can
        return and register again for their real vote (Mode B).

    For Mode B (real vote):
        cast_vote(value, is_fake=False) submits the counted ballot.
    """

    def __init__(
        self,
        voter_id: str,
        reg_server,
        ballot_server,
        paillier_pk: PaillierPublicKey,
        rsa_pub_params: dict,
    ):
        self.voter_id      = voter_id
        self._reg          = reg_server
        self._ballot       = ballot_server
        self._paillier_pk  = paillier_pk

        self._blinder      = TokenBlinder(rsa_pub_params)
        self._encryptor    = VoteEncryptor(paillier_pk)
        self._prover       = ZKPProver(paillier_pk)

        # Credentials set after register()
        self.real_token:   int | None = None
        self.real_sig:     int | None = None

    # ------------------------------------------------------------------
    # Registration — obtains one blind signature
    # ------------------------------------------------------------------

    def register(self) -> bool:
        """
        Obtain a blind RSA credential from the Registration Server.

        Returns True on success.  On success, self.real_token and
        self.real_sig are populated and ready for cast_vote().
        """
        print(f"\n[Voter {self.voter_id}] Starting registration…")

        auth = self._reg.authenticate_voter(self.voter_id)
        if not auth["ok"]:
            print(f"  [FAIL] {auth['reason']}")
            return False

        token          = self._blinder.generate_token()
        blinded, r     = self._blinder.blind(token)
        result         = self._reg.issue_blind_signature(self.voter_id, blinded)

        if "error" in result:
            print(f"  [FAIL] {result['error']}")
            return False

        self.real_token = token
        self.real_sig   = self._blinder.unblind(result["blind_signature"], r)

        print(f"  [OK] Credential obtained for voter {self.voter_id}.")
        return True

    # ------------------------------------------------------------------
    # Voting — encrypts and submits the ballot
    # ------------------------------------------------------------------

    def cast_vote(
        self,
        vote_value: int,
        is_fake: bool = False,
        role_id: str = "unknown",
    ) -> dict:
        """
        Encrypt vote_value, generate ZKP, and submit to the Ballot Server.

        Parameters
        ----------
        vote_value : int  — 0 or 1
        is_fake    : bool — True for Mode A (coercion decoy), False for Mode B
        role_id    : str  — the role being voted for (passed through to Postgres)

        Returns
        -------
        dict with 'accepted' bool and either 'ballot_id' or 'reason'.
        """
        if self.real_token is None or self.real_sig is None:
            return {"accepted": False, "reason": "Not registered. Call register() first."}

        # encrypt_vote now returns (EncryptedNumber, r_enc) so ZKPProver
        # has access to the Paillier witness needed for the real branch.
        encrypted_vote, r_enc = self._encryptor.encrypt_vote(vote_value)
        ct_str                = VoteEncryptor.ciphertext_to_str(encrypted_vote)
        proof                 = self._prover.generate_proof(vote_value, encrypted_vote, r_enc)

        result = self._ballot.receive_ballot(
            token         = self.real_token,
            signature     = self.real_sig,
            ciphertext_str= ct_str,
            zkp_proof     = proof,
            is_fake       = is_fake,
            role_id       = role_id,
        )

        mode = "FAKE (Mode A)" if is_fake else "REAL (Mode B)"
        if result.get("accepted"):
            print(f"[Voter {self.voter_id}] Ballot accepted — {mode}.")
        else:
            print(f"[Voter {self.voter_id}] Ballot REJECTED — {mode}: {result.get('reason')}")

        return result


# ---------------------------------------------------------------------------
# Standalone smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=== VoterClient smoke test — import only ===")