"""
app/main.py
────────────
FastAPI backend — Plugin Engine  (port 8000)

This service is ONE of three backends in the AnonyTech architecture:

  ┌─────────────────────────┬───────┬─────────────────────────────────────────┐
  │ Service                 │ Port  │ Responsibility                            │
  ├─────────────────────────┼───────┼───────────────────────────────────────────┤
  │ server.js (Node/Express)│ 5000  │ Main API, auth, OTP, voter/candidate CRUD │
  │ crypto_api.py (FastAPI) │ 8001  │ Paillier HE, ZKP, RSA blind signatures    │
  │ THIS — app/main.py      │ 8000  │ Plugin tallying engine + disaster recovery│
  └─────────────────────────┴───────┴───────────────────────────────────────────┘

All three share ONE PostgreSQL database (`evoting_system`, default port 5433).

── How this service is "connected" to the rest of the system ──────────────────
• election_config  → SHARED table. This engine reads/writes the SAME row that
                     server.js does, including the new election_name /
                     election_description columns. `/plugin/switch` persists the
                     chosen method here so server.js AND the React admin UI all
                     observe the same active method.
• plugin_ballots   → THIS engine's OWN ballot store (method-engine demo + the
                     graceful-degradation "ballot box"). It deliberately does
                     NOT touch the crypto layer's `ballots` table, so the two
                     never collide.
• recovery_events  → THIS engine's OWN table for the Graceful Degradation
                     Protocol (see core/graceful_degradation.py).

The React admin dashboard talks to this engine directly at VITE_PLUGIN_API_URL
(http://localhost:8000) for /plugin/info, /plugin/switch and /recovery/*.
server.js also proxies these at /api/plugin/* and /api/recovery/* so the Node
layer can orchestrate them too.
"""

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import asyncpg
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram, make_asgi_app
from pydantic import BaseModel

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

try:
    from app.core.plugin_loader import load_plugin, get_active_plugin
    from app.core.graceful_degradation import (
        GracefulDegradationProtocol, FailureType, classify_failure,
        ensure_recovery_tables, PLUGIN_BALLOTS_TABLE,
    )
except ImportError:
    from core.plugin_loader import load_plugin, get_active_plugin
    from core.graceful_degradation import (
        GracefulDegradationProtocol, FailureType, classify_failure,
        ensure_recovery_tables, PLUGIN_BALLOTS_TABLE,
    )

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Environment config ────────────────────────────────────────────────────────
# IMPORTANT: this MUST be the SAME database server.js and crypto_api.py use.
# server.js reads DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME from its .env;
# the equivalent DSN (default below) targets the same evoting_system DB on 5433.
PG_DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:123456789@localhost:5433/evoting_system",
)

REDIS_URL     = os.getenv("REDIS_URL", "redis://localhost:6379")
ACTIVE_METHOD = os.getenv("ACTIVE_METHOD", "plurality")

# Method name mapping between plugin (lowercase) and database (capitalized)
METHOD_TO_DB = {
    "plurality": "Plurality",
    "stv": "STV",
    "borda": "Borda",
    "liquid": "Liquid",
}
DB_TO_METHOD = {v: k for k, v in METHOD_TO_DB.items()}

# ── Prometheus metrics ────────────────────────────────────────────────────────
VOTES_SUBMITTED      = Counter("evoting_votes_submitted_total",      "Total votes submitted",       ["election_id", "method"])
VOTES_INVALID        = Counter("evoting_votes_invalid_total",        "Invalid ballots rejected",    ["election_id"])
CLIENT_DISCONNECTS   = Counter("evoting_client_disconnects_total",   "Client disconnections",       [])
WAL_ERRORS           = Counter("evoting_wal_errors_total",           "WAL write errors",            [])
PLUGIN_SUBSTITUTIONS = Counter("evoting_plugin_substitutions_total", "Plugin method switches",      ["from_method", "to_method"])
RECOVERY_LATENCY     = Histogram("evoting_recovery_latency_seconds", "Time to recover from failure", ["failure_type"])


# ── Helper: ensure the SHARED election_config table + columns ─────────────────
async def ensure_election_config_table(conn):
    """
    Create / migrate the SHARED election_config table.

    This is kept BYTE-COMPATIBLE with server.js's ensureElectionConfigTable():
    same columns, same election_name / election_description additions, so both
    backends agree on the schema regardless of which one starts first.
    """
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS election_config (
            id                   SERIAL PRIMARY KEY,
            election_name        VARCHAR(200) NOT NULL DEFAULT 'Student Election',
            election_description TEXT,
            voting_method        VARCHAR(20)  NOT NULL DEFAULT 'Plurality'
                                 CHECK (voting_method IN ('Plurality','STV','Borda','Liquid')),
            is_sealed            BOOLEAN      NOT NULL DEFAULT FALSE,
            is_tally_released    BOOLEAN      NOT NULL DEFAULT FALSE,
            start_date           TIMESTAMPTZ,
            end_date             TIMESTAMPTZ,
            created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """)
    # Idempotent migrations for installs created before these columns existed.
    for stmt in (
        "ALTER TABLE election_config ADD COLUMN IF NOT EXISTS election_name VARCHAR(200) NOT NULL DEFAULT 'Student Election'",
        "ALTER TABLE election_config ADD COLUMN IF NOT EXISTS election_description TEXT",
    ):
        try:
            await conn.execute(stmt)
        except Exception as e:  # pragma: no cover
            logger.debug("election_config migration skipped: %s", e)

    await conn.execute("""
        INSERT INTO election_config (election_name, voting_method, is_sealed, is_tally_released)
        SELECT 'Student Election', 'Plurality', FALSE, FALSE
        WHERE NOT EXISTS (SELECT 1 FROM election_config LIMIT 1)
    """)
    logger.info("✅ election_config table verified (shared schema)")


async def ensure_plugin_ballots_table(conn):
    """
    THIS engine's own ballot store. Separate from the crypto layer's `ballots`
    table so the two systems never conflict on columns or constraints.
    Includes log_hash for the cryptography-free integrity proof.
    """
    await conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {PLUGIN_BALLOTS_TABLE} (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            election_id  TEXT        NOT NULL,
            role_id      TEXT,
            content      JSONB       NOT NULL,
            log_hash     TEXT,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    await conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_plugin_ballots_election "
        f"ON {PLUGIN_BALLOTS_TABLE} (election_id)"
    )
    logger.info("✅ %s table verified", PLUGIN_BALLOTS_TABLE)


# ── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ensure shared + private tables exist, then load the active plugin."""
    try:
        conn = await asyncpg.connect(PG_DSN)
        try:
            await ensure_election_config_table(conn)   # shared
            await ensure_plugin_ballots_table(conn)     # private to this engine
            await ensure_recovery_tables(conn)          # private to this engine
        finally:
            await conn.close()
    except Exception as e:
        logger.error("Failed to prepare database at startup: %s", e)
        logger.error("Check DATABASE_URL points at the SAME DB as server.js: %s", PG_DSN)

    try:
        load_plugin(ACTIVE_METHOD)
        logger.info("Plugin engine started with method: %s", ACTIVE_METHOD)
    except Exception as e:
        logger.error("Failed to load plugin '%s': %s", ACTIVE_METHOD, e)

    # Sync the in-memory plugin to whatever method is persisted in the shared DB
    try:
        conn = await asyncpg.connect(PG_DSN)
        try:
            row = await conn.fetchrow(
                "SELECT voting_method FROM election_config ORDER BY id DESC LIMIT 1"
            )
            if row and row["voting_method"]:
                persisted_db = row["voting_method"]
                plugin_method = DB_TO_METHOD.get(persisted_db, persisted_db.lower())
                try:
                    if get_active_plugin().method_name != plugin_method:
                        load_plugin(plugin_method)
                        logger.info("Plugin synced from DB: %s → %s", persisted_db, plugin_method)
                except Exception as e:
                    logger.warning("Could not sync plugin: %s", e)
        finally:
            await conn.close()
    except Exception as e:
        logger.warning("Could not sync plugin from DB on startup: %s", e)

    yield
    logger.info("Plugin engine shutting down.")


app = FastAPI(title="E-Voting Plugin Engine", version="2.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev
        "http://localhost:3000",  # CRA / alt
        "http://localhost:5000",  # Node (server.js) proxy
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


# ── Dependencies ──────────────────────────────────────────────────────────────
async def get_db():
    try:
        conn = await asyncpg.connect(PG_DSN)
        try:
            await ensure_election_config_table(conn)
            yield conn
        finally:
            await conn.close()
    except Exception as e:
        logger.error("Database connection failed: %s", e)
        raise HTTPException(status_code=503, detail="Database unavailable")


async def get_redis():
    try:
        client = aioredis.from_url(REDIS_URL, decode_responses=True)
        try:
            yield client
        finally:
            await client.aclose()
    except Exception as e:
        logger.error("Redis connection failed: %s", e)
        raise HTTPException(status_code=503, detail="Redis unavailable")


# ── Request models ─────────────────────────────────────────────────────────────
class SubmitBallotRequest(BaseModel):
    election_id: str
    ballot: dict[str, Any]
    role_id: str | None = None

class SwitchMethodRequest(BaseModel):
    method: str

class RecoveryRequest(BaseModel):
    election_id: str
    failure_event: dict[str, Any]

class ConfigPatchRequest(BaseModel):
    votingMethod: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    isSealed: bool | None = None
    isTallyReleased: bool | None = None
    electionName: str | None = None
    electionDescription: str | None = None


def _serialize_config(row) -> dict:
    result = dict(row)
    result["voting_method"] = DB_TO_METHOD.get(
        result.get("voting_method"), str(result.get("voting_method", "")).lower()
    )
    # Make datetimes JSON-friendly
    for k in ("start_date", "end_date", "created_at", "updated_at"):
        if isinstance(result.get(k), datetime):
            result[k] = result[k].isoformat()
    return result


# ═════════════════════════════════════════════════════════════════════════════
# HEALTH & PLUGIN INFO
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    try:
        active_method = get_active_plugin().method_name
    except Exception:
        active_method = "none"
    db_ok = True
    try:
        conn = await asyncpg.connect(PG_DSN)
        await conn.execute("SELECT 1")
        await conn.close()
    except Exception:
        db_ok = False
    return {"status": "ok", "active_method": active_method, "db": db_ok}


@app.get("/plugin/info")
async def plugin_info():
    try:
        plugin = get_active_plugin()
        return {"method": plugin.method_name, "ballot_structure": plugin.define_ballot_structure()}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Plugin not loaded: {str(e)}")


# ═════════════════════════════════════════════════════════════════════════════
# PLUGIN SWITCH  (persists to the SHARED election_config row)
# ═════════════════════════════════════════════════════════════════════════════

@app.post("/plugin/switch")
async def switch_method(req: SwitchMethodRequest, db=Depends(get_db)):
    try:
        previous = get_active_plugin().method_name
    except Exception:
        previous = "none"

    valid_methods = {"plurality", "stv", "borda", "liquid"}
    method = req.method.lower()
    if method not in valid_methods:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown method '{req.method}'. Valid options: {sorted(valid_methods)}",
        )

    plugin = load_plugin(method)
    PLUGIN_SUBSTITUTIONS.labels(from_method=previous, to_method=plugin.method_name).inc()

    db_method_name = METHOD_TO_DB.get(method, method.capitalize())

    # FIX: UPDATE the existing single row instead of INSERT id=1.
    # The shared schema enforces ONE row via `unique_active_config ((TRUE))`,
    # so an INSERT (even ON CONFLICT (id)) could violate that index. server.js
    # updates the same way, keeping both backends consistent.
    try:
        updated = await db.fetchrow(
            """
            UPDATE election_config
               SET voting_method = $1, updated_at = NOW()
             WHERE id = (SELECT id FROM election_config LIMIT 1)
            RETURNING id
            """,
            db_method_name,
        )
        if not updated:
            # No config row yet — create one.
            await db.execute(
                "INSERT INTO election_config (voting_method, is_sealed, is_tally_released) "
                "VALUES ($1, FALSE, FALSE)",
                db_method_name,
            )
        logger.info("Persisted method '%s' to shared election_config", db_method_name)
    except Exception as e:
        logger.error("Failed to persist voting_method: %s", e)
        raise HTTPException(
            status_code=503,
            detail=f"Database error: {e}. Ensure PostgreSQL is running and DATABASE_URL is correct.",
        )

    logger.info("Plugin switched: %s → %s", previous, plugin.method_name)
    return {
        "switched_to": plugin.method_name,
        "from": previous,
        "ballot_structure": plugin.define_ballot_structure(),
    }


# ═════════════════════════════════════════════════════════════════════════════
# ELECTION CONFIG  (shared with server.js; now includes name/description)
# ═════════════════════════════════════════════════════════════════════════════

_CONFIG_COLS = (
    "id, election_name, election_description, voting_method, "
    "is_sealed, is_tally_released, start_date, end_date, created_at, updated_at"
)

@app.get("/api/config")
async def get_config(db=Depends(get_db)):
    try:
        row = await db.fetchrow(f"SELECT {_CONFIG_COLS} FROM election_config LIMIT 1")
        if not row:
            await db.execute(
                "INSERT INTO election_config (voting_method, is_sealed, is_tally_released) "
                "VALUES ($1, FALSE, FALSE)",
                METHOD_TO_DB.get(ACTIVE_METHOD, "Plurality"),
            )
            row = await db.fetchrow(f"SELECT {_CONFIG_COLS} FROM election_config LIMIT 1")
        return _serialize_config(row)
    except Exception as e:
        logger.error("Failed to get config: %s", e)
        return {
            "voting_method": ACTIVE_METHOD,
            "is_sealed": False,
            "is_tally_released": False,
            "start_date": None,
            "end_date": None,
            "election_name": None,
            "election_description": None,
        }


@app.patch("/api/config")
async def patch_config(req: ConfigPatchRequest, db=Depends(get_db)):
    updates, values, idx = [], [], 1

    if req.votingMethod is not None:
        method = req.votingMethod.lower()
        db_method = METHOD_TO_DB.get(method, method.capitalize())
        updates.append(f"voting_method = ${idx}"); values.append(db_method); idx += 1
        try:
            if get_active_plugin().method_name != method:
                load_plugin(method)
        except Exception:
            load_plugin(method)

    if req.electionName is not None:
        updates.append(f"election_name = ${idx}"); values.append(req.electionName); idx += 1
    if req.electionDescription is not None:
        updates.append(f"election_description = ${idx}"); values.append(req.electionDescription); idx += 1
    if req.startDate is not None:
        updates.append(f"start_date = ${idx}::timestamptz"); values.append(req.startDate); idx += 1
    if req.endDate is not None:
        updates.append(f"end_date = ${idx}::timestamptz"); values.append(req.endDate); idx += 1
    if req.isSealed is not None:
        updates.append(f"is_sealed = ${idx}"); values.append(req.isSealed); idx += 1
    if req.isTallyReleased is not None:
        updates.append(f"is_tally_released = ${idx}"); values.append(req.isTallyReleased); idx += 1

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = NOW()")
    query = (
        f"UPDATE election_config SET {', '.join(updates)} "
        f"WHERE id = (SELECT id FROM election_config LIMIT 1) RETURNING {_CONFIG_COLS}"
    )
    row = await db.fetchrow(query, *values)
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")
    return _serialize_config(row)


@app.post("/api/config/seal")
async def seal_config(db=Depends(get_db)):
    row = await db.fetchrow(
        f"UPDATE election_config SET is_sealed = TRUE, updated_at = NOW() "
        f"WHERE id = (SELECT id FROM election_config LIMIT 1) RETURNING {_CONFIG_COLS}"
    )
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")
    return _serialize_config(row)


@app.post("/api/config/tally")
async def release_tally(db=Depends(get_db)):
    row = await db.fetchrow(
        f"UPDATE election_config SET is_tally_released = TRUE, updated_at = NOW() "
        f"WHERE id = (SELECT id FROM election_config LIMIT 1) RETURNING {_CONFIG_COLS}"
    )
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")
    return _serialize_config(row)


# ═════════════════════════════════════════════════════════════════════════════
# BALLOT SUBMISSION  (method-engine demo; writes to plugin_ballots, with AOF)
# ═════════════════════════════════════════════════════════════════════════════

@app.post("/ballot/submit")
async def submit_ballot(req: SubmitBallotRequest, db=Depends(get_db), redis=Depends(get_redis)):
    try:
        plugin = get_active_plugin()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Plugin not loaded: {str(e)}")

    valid, errors = plugin.validate_ballot(req.ballot)
    if not valid:
        VOTES_INVALID.labels(election_id=req.election_id).inc()
        raise HTTPException(status_code=422, detail={"errors": errors})

    ballot_id = str(uuid.uuid4())
    content_json = json.dumps(req.ballot)

    # Disaster-recovery layer: write to Redis AOF FIRST (millisecond-granularity
    # state the GracefulDegradationProtocol can replay after a power failure).
    aof_record = {
        "id": ballot_id,
        "election_id": req.election_id,
        "content": req.ballot,
        "submitted_at": datetime.utcnow().isoformat(),
    }
    try:
        await redis.setex(
            f"vote:{req.election_id}:{ballot_id}", 86400, json.dumps(aof_record)
        )
    except Exception as e:
        logger.warning("Redis AOF backup failed: %s", e)

    # Durable write to PostgreSQL (WAL-protected).
    try:
        await db.execute(
            f"INSERT INTO {PLUGIN_BALLOTS_TABLE} (id, election_id, role_id, content, submitted_at) "
            f"VALUES ($1, $2, $3, $4, NOW())",
            ballot_id, req.election_id, req.role_id, content_json,
        )
    except Exception as e:
        WAL_ERRORS.inc()
        logger.error("WAL write failed: %s", e)
        raise HTTPException(status_code=500, detail="Vote storage failed")

    VOTES_SUBMITTED.labels(election_id=req.election_id, method=plugin.method_name).inc()
    return {"ballot_id": ballot_id, "status": "accepted", "method": plugin.method_name}


# ═════════════════════════════════════════════════════════════════════════════
# TALLY  (runs the ACTIVE plugin over plugin_ballots)
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/election/{election_id}/tally")
async def tally_election(election_id: str, db=Depends(get_db)):
    try:
        plugin = get_active_plugin()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Plugin not loaded: {str(e)}")

    rows = await db.fetch(
        f"SELECT content FROM {PLUGIN_BALLOTS_TABLE} WHERE election_id = $1", election_id
    )
    ballots = []
    for r in rows:
        c = r["content"]
        ballots.append(c if isinstance(c, dict) else json.loads(c))

    result = plugin.count_votes(ballots)
    description = plugin.describe_results(result)
    return {
        "method": plugin.method_name,
        "election_id": election_id,
        "ballot_count": len(ballots),
        "result": result,
        "description": description,
    }


# ═════════════════════════════════════════════════════════════════════════════
# RECOVERY & AUDIT  (Graceful Degradation Protocol)
# ═════════════════════════════════════════════════════════════════════════════

@app.post("/recovery/initiate")
async def initiate_recovery(req: RecoveryRequest):
    """Stages 1-3: detect failure type, run the matching recovery procedure."""
    failure_type = classify_failure(req.failure_event)
    protocol = GracefulDegradationProtocol(PG_DSN, REDIS_URL)
    with RECOVERY_LATENCY.labels(failure_type=failure_type.value).time():
        recovery_result = await protocol.recover(failure_type, req.election_id)
    return {"failure_type": failure_type, "recovery": recovery_result}


@app.get("/recovery/{election_id}/audit-report")
async def audit_report(election_id: str):
    """Stage 5: human-readable, cryptography-free integrity audit report."""
    protocol = GracefulDegradationProtocol(PG_DSN, REDIS_URL)
    conn = await asyncpg.connect(PG_DSN)
    try:
        integrity_hash = await protocol._compute_integrity_hash(conn, election_id)
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM {PLUGIN_BALLOTS_TABLE} WHERE election_id=$1", election_id
        )
    finally:
        await conn.close()
    report = await protocol.generate_audit_report(
        election_id, {"integrity_hash": integrity_hash, "votes_recovered": total}
    )
    return {"report": report, "integrity_hash": integrity_hash, "ballot_count": total}