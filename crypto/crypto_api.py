"""
crypto_api.py
=============
"""

import os
import sys
import json

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(_env_path, override=False)
    print(f"[Crypto API] Loaded .env from {_env_path}")
except ImportError:
    print("[Crypto API] python-dotenv not installed; relying on environment variables.")

sys.path.insert(0, os.path.dirname(__file__))

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from registration_server.registration_server import RegistrationServer, _pg_conn
from ballot_server.ballot_server             import BallotServer
from election_server.election_server         import ElectionServer
from tally_server.tally_server               import TallyServer
from voter_client.voter_client               import VoterClient


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

reg_server:      RegistrationServer | None = None
election_server: ElectionServer     | None = None
ballot_server:   BallotServer       | None = None
tally_server:    TallyServer        | None = None
rsa_pub_params:  dict               | None = None
paillier_pk                                = None

# voter_id → VoterClient (holds real_token for Mode B votes)
voter_sessions: dict[str, VoterClient] = {}

# voter_id+role_id → VoterClient (dedicated fake-credential sessions)
fake_voter_sessions: dict[str, VoterClient] = {}

active_election_id: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global reg_server, election_server, ballot_server, tally_server
    global rsa_pub_params, paillier_pk

    print("\n" + "=" * 60)
    print("  AnonyTech Crypto API — starting up")
    print("=" * 60)
    print(f"  DB_HOST={os.environ.get('DB_HOST', '(not set)')}")
    print(f"  DB_NAME={os.environ.get('DB_NAME', '(not set)')}")
    print(f"  DB_USER={os.environ.get('DB_USER', '(not set)')}")

    reg_server      = RegistrationServer()
    election_server = ElectionServer()
    paillier_pk     = election_server.get_public_key()
    ballot_server   = BallotServer(reg_server, paillier_pk)
    tally_server    = TallyServer(paillier_pk)
    # Fix: recreate tally_server's SQLite connection with check_same_thread=False
    # so it works from FastAPI's worker threads
    if hasattr(tally_server, '_db') and tally_server._db is not None:
        import sqlite3 as _sqlite3
        db_path = tally_server._db.execute("PRAGMA database_list").fetchone()[2]
        tally_server._db.close()
        tally_server._db = _sqlite3.connect(db_path, check_same_thread=False)
    rsa_pub_params  = reg_server.get_public_key_params()
    print("  All crypto servers initialised.")

# Recover active election from Postgres after container restart
    global active_election_id
    try:
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM election_config "
                    "WHERE is_sealed = TRUE AND is_tally_released = FALSE "
                    "LIMIT 1"
                )
                row = cur.fetchone()
                if row:
                    recovered_id = str(row["id"])
                    active_election_id = recovered_id
                    election_server.open_election(recovered_id)
                    print(f"  ✅ Recovered sealed election '{recovered_id}' from Postgres.")
                else:
                    print("  Waiting for admin to open election via /crypto/open-election")
        finally:
            conn.close()
    except Exception as exc:
        print(f"  ⚠️  Could not recover election state: {exc}")
        print("  Waiting for admin to open election via /crypto/open-election")

    print("=" * 60 + "\n")
    yield
    print("[Crypto API] Shutting down.")


app = FastAPI(title="AnonyTech Crypto API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SeedVotersRequest(BaseModel):
    voter_ids: list[str]

class RegisterRequest(BaseModel):
    voter_id: str

class CastVoteRequest(BaseModel):
    voter_id:   str
    vote_value: int
    role_id:    str
    is_fake:    bool = False

class CoercionResetRequest(BaseModel):
    voter_id: str

class OpenElectionRequest(BaseModel):
    election_id: str

class TallyRequest(BaseModel):
    election_id: str

class ResetVoterRequest(BaseModel):
    voter_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_servers():
    if not reg_server or not ballot_server or not election_server or not tally_server:
        raise HTTPException(503, "Crypto servers not ready")

def _require_open_election():
    if active_election_id is None:
        raise HTTPException(403, "No election is currently open.")


def _voter_count() -> int:
    try:
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS n FROM voters WHERE role = 'voter'")
                return cur.fetchone()["n"]
        finally:
            conn.close()
    except Exception:
        return -1


def _hard_reset_voter(voter_id: str) -> None:
    """
    Fully reset a voter's crypto state so they can re-register.
    Also clears any fake sessions for this voter.
    """
    reg_server.reset_voter(voter_id)
    voter_sessions.pop(voter_id, None)
    # Clear all fake sessions for this voter
    fake_keys = [k for k in fake_voter_sessions if k.startswith(voter_id + ":")]
    for k in fake_keys:
        fake_voter_sessions.pop(k, None)
    print(f"[Crypto API] Hard reset complete for {voter_id}.")


def _build_fresh_session(voter_id: str) -> VoterClient:
    """
    Create a new VoterClient and run register() to obtain real_token.
    Precondition: authenticate_voter(voter_id) must return ok=True.
    """
    client = VoterClient(
        voter_id, reg_server, ballot_server, paillier_pk, rsa_pub_params
    )
    ok = client.register()
    if not ok:
        auth2 = reg_server.authenticate_voter(voter_id)
        raise HTTPException(
            400,
            f"Could not issue anonymous credential for {voter_id}: "
            f"{auth2.get('reason', 'registration returned False')}",
        )
    voter_sessions[voter_id] = client
    print(f"[Crypto API] Fresh session registered for {voter_id}.")
    return client


def _ensure_voter_session(voter_id: str) -> VoterClient:
    """
    Return a VoterClient with a valid real_token for voter_id.

    Decision tree
    -------------
    1. In-memory session with real_token → return (happy path).
    2. No valid session:
       a. ok=True  → register fresh, return.
       b. "already issued" → reset + re-register (process restart recovery).
       c. other → voter ineligible → raise HTTP 400.
    """
    client = voter_sessions.get(voter_id)
    if client is not None and getattr(client, "real_token", None) is not None:
        return client

    auth = reg_server.authenticate_voter(voter_id)

    if auth["ok"]:
        return _build_fresh_session(voter_id)

    reason = auth.get("reason", "").lower()

    if "already issued" in reason:
        print(
            f"[Crypto API] Session recovery for {voter_id}: "
            "credential_issued=TRUE but no in-memory token. Resetting and re-registering."
        )
        _hard_reset_voter(voter_id)
        return _build_fresh_session(voter_id)

    raise HTTPException(
        400,
        f"Voter {voter_id} is not eligible: {auth.get('reason', 'unknown')}",
    )


def _refresh_token_for_next_role(voter_id: str) -> None:
    """
    After a real ballot is accepted for one role, invalidate the used token
    and register a fresh anonymous credential so the voter can cast a real
    ballot for the next role without hitting "duplicate token".

    Called only for real (non-fake) ballots after a successful cast_vote.
    """
    print(
        f"[Crypto API] Refreshing token for {voter_id} (multi-role next-role prep)."
    )
    _hard_reset_voter(voter_id)
    try:
        _build_fresh_session(voter_id)
    except HTTPException as exc:
        # Log but don't crash — the current role's ballot is already accepted.
        print(
            f"[Crypto API] WARNING: token refresh failed for {voter_id}: {exc.detail}. "
            "Next role cast-vote will attempt its own recovery."
        )


def _get_or_create_fake_session(voter_id: str, role_id: str) -> VoterClient:
    """
    Return a dedicated VoterClient for a fake (coercion) ballot.

    Fake sessions are keyed by voter_id:role_id so each fake vote gets its
    own token and never touches the voter's real_token.  This prevents the
    fake vote from consuming the real credential.
    """
    key = f"{voter_id}:{role_id}"
    client = fake_voter_sessions.get(key)
    if client is not None and getattr(client, "real_token", None) is not None:
        return client

    # Register a fresh anonymous credential for this fake vote slot.
    # We must reset first in case a previous fake attempt left a partial state.
    reg_server.reset_voter(voter_id)
    fake_client = VoterClient(
        voter_id, reg_server, ballot_server, paillier_pk, rsa_pub_params
    )
    ok = fake_client.register()
    if not ok:
        raise HTTPException(
            400,
            f"Could not issue fake credential for {voter_id} role {role_id}",
        )

    # Restore the real credential state so real votes still work.
    # reset_voter cleared credential_issued; we need to leave it consistent.
    # The simplest approach: store the fake client separately and re-ensure
    # the real session after the fake vote returns.
    fake_voter_sessions[key] = fake_client
    print(f"[Crypto API] Fake session created for {voter_id}:{role_id}.")
    return fake_client


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/crypto/status")
def status():
    _require_servers()
    return {
        "status":             "ok",
        "active_election_id": active_election_id,
        "election_status":    election_server.get_election_status(),
        "ballot_counts":      ballot_server.ballot_count(),
        "seeded_voters":      _voter_count(),
    }


@app.get("/crypto/rsa-public-key")
def rsa_public_key():
    _require_servers()
    params = reg_server.get_public_key_params()
    return {"n": str(params["n"]), "e": params["e"]}


@app.get("/crypto/paillier-public-key")
def paillier_public_key():
    _require_servers()
    return {"n": str(paillier_pk.n)}


# ---------------------------------------------------------------------------
# ZKP smoke-test endpoint
# ---------------------------------------------------------------------------

@app.get("/crypto/zkp-test")
def zkp_test():
    _require_servers()

    import hashlib
    import random
    import math

    import shared.paillier as phe
    from ballot_server.ballot_server import ZKPVerifier

    results = []
    overall_pass = True

    test_pk, test_sk = phe.generate_paillier_keypair(n_length=512)
    verifier = ZKPVerifier(test_pk)

    for vote_value in (0, 1):
        try:
            n    = test_pk.n
            n_sq = n * n
            g    = n + 1
            v    = vote_value
            w    = 1 - v

            r_enc = random.randrange(2, n)
            while math.gcd(r_enc, n) != 1:
                r_enc = random.randrange(2, n)
            gm    = (1 + v * n) % n_sq
            rn    = pow(r_enc, n, n_sq)
            C_int = (gm * rn) % n_sq
            ciphertext_str = json.dumps({"ciphertext": str(C_int), "exponent": 0})

            e_w   = random.randint(1, 2**128)
            z_w   = random.randrange(2, n_sq)
            g_w_inv  = pow(pow(g, w, n_sq), -1, n_sq)
            C_gw_inv = C_int * g_w_inv % n_sq
            A_w   = pow(z_w, n, n_sq) * pow(C_gw_inv, -e_w, n_sq) % n_sq

            k     = random.randrange(2, n)
            A_v   = pow(k, n, n_sq)

            if v == 0:
                A0, A1 = A_v, A_w
            else:
                A0, A1 = A_w, A_v

            commitment_bytes = (
                str(C_int).encode()
                + str(A0).encode()
                + str(A1).encode()
            )
            challenge_total = int(hashlib.sha256(commitment_bytes).hexdigest(), 16)

            e_v = (challenge_total - e_w) % (2**256)
            z_v = k * pow(r_enc, e_v, n_sq) % n_sq

            if v == 0:
                entries = [
                    {"A": str(A_v), "e": str(e_v), "z": str(z_v)},
                    {"A": str(A_w), "e": str(e_w), "z": str(z_w)},
                ]
            else:
                entries = [
                    {"A": str(A_w), "e": str(e_w), "z": str(z_w)},
                    {"A": str(A_v), "e": str(e_v), "z": str(z_v)},
                ]

            proof = {
                "ciphertext":      str(C_int),
                "entries":         entries,
                "challenge_total": str(challenge_total),
            }

            ok = verifier.verify_proof(ciphertext_str, proof)
            results.append({
                "vote_value":        vote_value,
                "passed":            ok,
                "ciphertext_prefix": str(C_int)[:20] + "…",
                "challenge_total":   str(challenge_total)[:20] + "…",
            })
            if not ok:
                overall_pass = False

        except Exception as exc:
            results.append({"vote_value": vote_value, "passed": False, "error": str(exc)})
            overall_pass = False

    tamper_passed = False
    try:
        bad_proof = {
            "ciphertext": "12345678901234567890",
            "entries": [
                {"A": "1", "e": "1", "z": "1"},
                {"A": "1", "e": "1", "z": "1"},
            ],
            "challenge_total": "9999",
        }
        bad_result = verifier.verify_proof("12345678901234567890", bad_proof)
        tamper_passed = not bad_result
    except Exception:
        tamper_passed = True

    return {
        "overall_pass":    overall_pass and tamper_passed,
        "vote_tests":      results,
        "tamper_rejected": tamper_passed,
        "key_bits":        512,
        "description": (
            "Full ZKP disjunctive Sigma-protocol round-trip. "
            "vote_tests shows prove+verify for vote=0 and vote=1. "
            "tamper_rejected confirms a malformed proof is correctly rejected."
        ),
    }


@app.post("/crypto/seed-voters")
def seed_voters(req: SeedVotersRequest):
    _require_servers()
    if not req.voter_ids:
        raise HTTPException(400, "voter_ids list is empty")
    reg_server.seed_real_voters(req.voter_ids)
    return {"seeded": len(req.voter_ids), "voter_ids": req.voter_ids}


@app.post("/crypto/register")
def register_voter(req: RegisterRequest):
    """
    Blind-signature registration for a single voter.  Idempotent.
    """
    _require_servers()
    voter_id = req.voter_id

    existing = voter_sessions.get(voter_id)
    if existing is not None and getattr(existing, "real_token", None) is not None:
        return {"success": True, "voter_id": voter_id, "message": "Already registered"}

    auth_check = reg_server.authenticate_voter(voter_id)

    if auth_check["ok"]:
        client = VoterClient(voter_id, reg_server, ballot_server, paillier_pk, rsa_pub_params)
        ok = client.register()
        if not ok:
            auth2 = reg_server.authenticate_voter(voter_id)
            raise HTTPException(
                400,
                f"Registration failed for voter {voter_id}: "
                f"{auth2.get('reason', 'unknown')}",
            )
        voter_sessions[voter_id] = client
        return {"success": True, "voter_id": voter_id, "message": "Registered successfully"}

    reason = auth_check.get("reason", "").lower()

    if "already issued" in reason:
        print(
            f"[Crypto API /register] Recovering lost session for {voter_id}: "
            "credential_issued=TRUE but no token in memory."
        )
        _hard_reset_voter(voter_id)
        client = _build_fresh_session(voter_id)
        return {
            "success":  True,
            "voter_id": voter_id,
            "message":  "Session recovered and credential re-issued",
        }

    raise HTTPException(
        400,
        f"Registration failed for voter {voter_id}: {auth_check.get('reason', 'unknown')}",
    )


@app.post("/crypto/cast-vote")
def cast_vote(req: CastVoteRequest):
    """
    Cast an encrypted ballot using Paillier HE + ZKP.
    """
    _require_servers()
    _require_open_election()

    if req.vote_value not in (0, 1):
        raise HTTPException(400, "vote_value must be 0 or 1")

    if req.is_fake:
        # ── Fake (coercion) ballot path ──────────────────────────────────────
        fake_key = f"{req.voter_id}:{req.role_id}"

        # Save the current real session (may be None)
        real_client = voter_sessions.get(req.voter_id)

        try:
            # Reset so the fake client can register
            reg_server.reset_voter(req.voter_id)
            fake_client = VoterClient(
                req.voter_id, reg_server, ballot_server, paillier_pk, rsa_pub_params
            )
            ok = fake_client.register()
            if not ok:
                raise HTTPException(
                    400,
                    f"Could not issue fake credential for {req.voter_id}",
                )

            result = fake_client.cast_vote(
                req.vote_value, is_fake=True, role_id=req.role_id
            )
        finally:
            # Always restore the real session state after fake vote attempt.
            voter_sessions.pop(req.voter_id, None)
            try:
                reg_server.reset_voter(req.voter_id)
                if real_client is not None:
                    new_real = VoterClient(
                        req.voter_id, reg_server, ballot_server, paillier_pk, rsa_pub_params
                    )
                    if new_real.register():
                        voter_sessions[req.voter_id] = new_real
                        print(
                            f"[Crypto API] Real session restored after fake vote for {req.voter_id}."
                        )
            except Exception as restore_err:
                print(
                    f"[Crypto API] WARNING: could not restore real session for "
                    f"{req.voter_id} after fake vote: {restore_err}"
                )

        if not result.get("accepted"):
            reason = result.get("reason", "Fake ballot rejected")
            raise HTTPException(409, reason)

        return {
            "success":            True,
            "ballot_id":          result["ballot_id"],
            "voter_id":           req.voter_id,
            "role_id":            req.role_id,
            "is_fake":            True,
            "active_election_id": active_election_id,
        }

    else:
        # ── Real ballot path ─────────────────────────────────────────────────
        client = _ensure_voter_session(req.voter_id)
        result = client.cast_vote(req.vote_value, is_fake=False, role_id=req.role_id)

        if not result.get("accepted"):
            reason = result.get("reason", "Ballot rejected")
            if "not registered" in reason.lower():
                raise HTTPException(
                    500,
                    f"Internal session error for {req.voter_id}: {reason}. "
                    "Please report this to the admin.",
                )
            raise HTTPException(409, reason)

        # Refresh the token so the next role can cast a real ballot.
        _refresh_token_for_next_role(req.voter_id)

        return {
            "success":            True,
            "ballot_id":          result["ballot_id"],
            "voter_id":           req.voter_id,
            "role_id":            req.role_id,
            "is_fake":            False,
            "active_election_id": active_election_id,
        }


@app.post("/crypto/reset-coercion")
def reset_coercion(req: CoercionResetRequest):
    """
    Called by server.js after a successful Mode A (fake) vote.
    Resets credential so the voter can return and cast their real ballot.
    """
    _require_servers()
    _hard_reset_voter(req.voter_id)
    print(f"[Crypto API] Coercion reset complete for {req.voter_id}.")
    return {
        "success":  True,
        "voter_id": req.voter_id,
        "message":  "Credential reset — voter may re-register for real vote (Mode B).",
    }


@app.post("/crypto/open-election")
def open_election(req: OpenElectionRequest):
    global active_election_id
    _require_servers()
    active_election_id = str(req.election_id)
    ok = election_server.open_election(active_election_id)
    return {
        "success":     ok,
        "election_id": active_election_id,
        "status":      "OPEN",
        "message":     f"Election {active_election_id} is now open for voting",
    }

def _recover_election_if_needed():
    """
    If active_election_id is None (e.g. after container restart) but Postgres
    says an election is sealed and untallied, re-open it in memory.
    """
    global active_election_id
    if active_election_id is not None:
        return
    try:
        conn = _pg_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM election_config "
                    "WHERE is_sealed = TRUE AND is_tally_released = FALSE "
                    "LIMIT 1"
                )
                row = cur.fetchone()
                if row:
                    eid = str(row["id"])
                    active_election_id = eid
                    election_server.open_election(eid)
                    print(f"[Crypto API] Recovered election '{eid}' from Postgres (mid-request).")
        finally:
            conn.close()
    except Exception as exc:
        print(f"[Crypto API] Election recovery failed: {exc}")

@app.post("/crypto/close-election")
def close_election():
    _require_servers()
    _recover_election_if_needed()
    _require_open_election()
    ok = election_server.close_election()
    return {"success": ok, "election_id": active_election_id, "status": "CLOSED"}


@app.post("/crypto/tally")
def run_tally(req: TallyRequest):
    """
    Run the homomorphic tally.

    Combines ciphertexts directly in memory from the Postgres ballot store,
    bypassing the election_server's internal SQLite entirely.
    """
    _require_servers()
    _recover_election_if_needed()

    if active_election_id is None:
        raise HTTPException(403, "No election has been opened yet.")

    if str(req.election_id) != active_election_id:
        raise HTTPException(
            400,
            f"election_id mismatch. Active: '{active_election_id}', got '{req.election_id}'",
        )

    # Retrieve real ciphertexts from Postgres ballot store
    try:
        real_cts = ballot_server.get_real_ciphertexts()
    except Exception as exc:
        raise HTTPException(
            500,
            f"Failed to retrieve ballots from database: {exc}. "
            "Check that DB_HOST and DB_PORT are correctly set in the crypto container's .env.",
        )

    if not real_cts:
        raise HTTPException(400, "No real ballots to tally")

    # ── Combine ciphertexts homomorphically directly in memory ──
    # Each ct from Postgres is a dict like {"ciphertext": "8464...", "exponent": 0}
    # We use election_server._deserialise_ct() to reconstruct EncryptedNumber objects
    # then add them together using Paillier's additive homomorphism:
    #   Enc(a) × Enc(b) ≡ Enc(a + b)
    combined = None
    error_count = 0
    for i, ct in enumerate(real_cts):
        try:
            # Convert to JSON string if it's a dict (Postgres JSONB auto-parses)
            if isinstance(ct, str):
                ct_str = ct
            elif hasattr(ct, 'items'):
                ct_str = json.dumps(ct, default=str)
            else:
                ct_str = str(ct)

            enc = election_server._deserialise_ct(ct_str)

            if combined is None:
                combined = enc
            else:
                combined = combined + enc
        except Exception as exc:
            error_count += 1
            print(f"[Tally] WARNING: could not parse ciphertext {i}: {exc}")

    print(
        f"[Tally] Combined {len(real_cts) - error_count}/{len(real_cts)} ciphertexts "
        f"in memory (skipped {error_count})."
    )

    if combined is None:
        raise HTTPException(400, f"No valid ciphertexts to combine ({error_count} parse errors)")

    # Ensure election is closed before decryption
    if election_server._is_open:
        election_server.close_election()

    result = tally_server.decrypt_and_publish(active_election_id, combined)
    return result


@app.get("/crypto/tally/{election_id}")
def get_tally(election_id: str):
    _require_servers()
    result = tally_server.get_result(election_id)
    if result is None:
        raise HTTPException(404, f"No tally found for election '{election_id}'")
    return result


@app.get("/crypto/bulletin-board")
def bulletin_board():
    _require_servers()
    return ballot_server.get_bulletin_board()


@app.post("/crypto/reset-voter")
def reset_voter(req: ResetVoterRequest):
    """Admin: clear a voter's credential so they can re-register."""
    _require_servers()
    _hard_reset_voter(req.voter_id)
    return {"success": True, "voter_id": req.voter_id, "message": "Voter credential reset"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CRYPTO_PORT", 8001))
    uvicorn.run("crypto_api:app", host="0.0.0.0", port=port, reload=False)