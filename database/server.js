require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const bcrypt   = require("bcryptjs");
const { Pool } = require("pg");
const { exec } = require('child_process');
const path     = require('path');
const crypto   = require('crypto');

const CRYPTO_API_URL = process.env.CRYPTO_API_URL || "http://localhost:8001";
// ── Plugin Engine (FastAPI, app/main.py) — voting-method tally + disaster recovery ──
const PLUGIN_API_URL = process.env.PLUGIN_API_URL || "http://localhost:8000";

// ─── DB Pool ────────────────────────────────────────────────
const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT) || 5432,
});

pool.on("error", (err) => {
  console.error("Unexpected DB error:", err);
  process.exit(-1);
});

const otpStore = new Map();

function toDbMethod(method) {
  if (!method) return null;
  const map = { plurality: 'Plurality', stv: 'STV', borda: 'Borda', liquid: 'Liquid' };
  return map[method.toLowerCase()] || method;
}

function toFrontendMethod(method) {
  if (!method) return 'plurality';
  const map = { Plurality: 'plurality', STV: 'stv', Borda: 'borda', Liquid: 'liquid' };
  return map[method] || method.toLowerCase();
}

async function cryptoProxy(res, method, cryptoPath, body = null) {
  const url  = `${CRYPTO_API_URL}${cryptoPath}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r    = await fetch(url, opts);
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || "Non-JSON response from crypto service" };
    }
    return res.status(r.status).json(data);
  } catch (err) {
    console.error("[Crypto Proxy] Error:", err.message);
    return res.status(502).json({ error: "Crypto service unavailable", detail: err.message });
  }
}

// ── Plugin Engine proxy (mirror of cryptoProxy, pointed at PLUGIN_API_URL) ──
async function pluginProxy(res, method, pluginPath, body = null) {
  const url  = `${PLUGIN_API_URL}${pluginPath}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r    = await fetch(url, opts);
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || "Non-JSON response from plugin engine" };
    }
    return res.status(r.status).json(data);
  } catch (err) {
    console.error("[Plugin Proxy] Error:", err.message);
    return res.status(502).json({ error: "Plugin engine unavailable", detail: err.message });
  }
}

async function logEmailDev(to, subject, text) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📧 EMAIL (DEV MODE) - ${new Date().toLocaleTimeString()}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   To:      ${to}`);
  console.log(`   Subject: ${subject}`);
  text.split('\n').forEach(line => console.log(`   ${line}`));
  console.log(`${'='.repeat(60)}\n`);
  return true;
}

async function sendEmail(to, subject, text) {
  if (process.env.NODE_ENV !== "production") {
    return logEmailDev(to, subject, text);
  }
  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host:   process.env.EMAIL_HOST,
      port:   parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === "true",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to, subject, text,
    });
    return true;
  } catch (err) {
    console.error("[Email] Failed to send:", err.message);
    throw err;
  }
}

async function ensureElectionConfigTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS election_config (
        id                  SERIAL PRIMARY KEY,
        election_name       VARCHAR(200) NOT NULL DEFAULT 'Student Election',
        election_description TEXT,
        voting_method       VARCHAR(20) NOT NULL DEFAULT 'Plurality'
                            CHECK (voting_method IN ('Plurality','STV','Borda','Liquid')),
        is_sealed           BOOLEAN NOT NULL DEFAULT FALSE,
        is_tally_released   BOOLEAN NOT NULL DEFAULT FALSE,
        start_date          TIMESTAMPTZ,
        end_date            TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE election_config
        ADD COLUMN IF NOT EXISTS election_name VARCHAR(200) NOT NULL DEFAULT 'Student Election',
        ADD COLUMN IF NOT EXISTS election_description TEXT
    `).catch(() => {});

    await client.query(`
      INSERT INTO election_config (election_name, voting_method, is_sealed, is_tally_released)
      SELECT 'Student Election', 'Plurality', FALSE, FALSE
      WHERE NOT EXISTS (SELECT 1 FROM election_config LIMIT 1)
    `);
    console.log(" election_config table verified");
  } catch (err) {
    console.error("Failed to ensure election_config table:", err);
  } finally {
    client.release();
  }
}

ensureElectionConfigTable();

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

async function requireAdmin(req, res, next) {
  const email = req.headers["x-admin-email"];
  if (!email) return res.status(401).json({ error: "x-admin-email header required" });
  const { rows } = await pool.query(
    "SELECT id, role FROM voters WHERE LOWER(email) = LOWER($1) LIMIT 1",
    [email]
  );
  if (!rows.length || rows[0].role !== "admin") {
    return res.status(403).json({ error: "Forbidden: admin access required" });
  }
  req.adminId    = rows[0].id;
  req.adminEmail = email;
  next();
}

async function audit(actor, action, targetType, targetId, metadata = {}) {
  await pool.query(
    `INSERT INTO audit_log (actor, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [actor, action, targetType, targetId, JSON.stringify(metadata)]
  );
}

async function autoSeedCryptoVoters() {
  try {
    const { rows } = await pool.query(
      "SELECT student_id FROM voters WHERE role = 'voter' AND student_id IS NOT NULL"
    );
    const voter_ids = rows.map(r => r.student_id).filter(Boolean);
    if (!voter_ids.length) {
      console.log("[Crypto] No voters in Postgres yet — skipping auto-seed.");
      return;
    }
    const r = await fetch(`${CRYPTO_API_URL}/crypto/seed-voters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_ids }),
    });
    if (r.ok) {
      console.log(` [Crypto] Auto-seeded ${voter_ids.length} voters.`);
    } else {
      const err = await r.json().catch(() => ({}));
      console.warn("[Crypto] Auto-seed failed:", err);
    }
  } catch (e) {
    console.warn("[Crypto] Auto-seed skipped:", e.message);
  }
}

async function ensureCryptoRegistration(studentId) {
  const regResp = await fetch(`${CRYPTO_API_URL}/crypto/register`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ voter_id: studentId }),
  });
  const text = await regResp.text();
  let regData;
  try { regData = JSON.parse(text); } catch { regData = { error: text }; }
  if (!regResp.ok) {
    const msg = regData?.detail || regData?.error || "re-registration failed";
    throw new Error(`[Crypto] Re-registration for ${studentId}: ${msg}`);
  }
  console.log(`[Crypto] Registration ensured for ${studentId}: ${regData.message}`);
  return regData;
}

// ============================================================
// OTP / BLIND SIGNATURE
// ============================================================

app.post("/api/otp/send", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const { rows } = await pool.query(
    `SELECT v.id, v.student_id, v.email, v.full_name, v.has_voted
     FROM voters v WHERE LOWER(v.email) = LOWER($1) LIMIT 1`,
    [email]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "No voter found with that email address" });
  }

  const voter = rows[0];
  if (voter.has_voted) {
    return res.status(403).json({ error: "This voter has already cast their ballot" });
  }

  const otp       = String(crypto.randomInt(100000, 999999));
  const expiresAt = Date.now() + 10 * 60 * 1000;

  otpStore.set(email.toLowerCase(), { otp, expiresAt, voterId: voter.student_id });

  const subject = "Your AnonyTech Voting OTP";
  const text = [
    `Hello${voter.full_name ? ` ${voter.full_name}` : ""},`,
    ``,
    `Your one-time password (OTP) for the AnonyTech election system is:`,
    ``,
    `    ${otp}`,
    ``,
    `This code expires in 10 minutes.`,
    ``,
    `If you did not request this, please ignore this email.`,
    ``,
    `— AnonyTech Voting System`,
  ].join("\n");

  try {
    await sendEmail(email, subject, text);
  } catch (err) {
    otpStore.delete(email.toLowerCase());
    return res.status(500).json({ error: "Failed to send OTP email. Please try again." });
  }

  const devPayload = process.env.NODE_ENV !== "production" ? { _dev_otp: otp } : {};
  res.json({ success: true, message: "OTP sent to your email address", expiresIn: 600, ...devPayload });
});

app.post("/api/otp/verify", async (req, res) => {
  const { otp, email, voterId } = req.body;
  if (!otp || !email) return res.status(400).json({ error: "OTP and email are required" });

  const key        = email.toLowerCase();
  const storedData = otpStore.get(key);
  if (!storedData)                        return res.status(400).json({ error: "No OTP found. Please request a new OTP." });
  if (storedData.expiresAt < Date.now()) { otpStore.delete(key); return res.status(400).json({ error: "OTP has expired." }); }
  if (storedData.otp !== otp)             return res.status(400).json({ error: "Invalid OTP code." });

  const targetVoterId = voterId || storedData.voterId;
  if (!targetVoterId) return res.status(400).json({ error: "Voter ID is required for blind signature" });

  try {
    const safeJson = async (response) => {
      const text = await response.text();
      try { return JSON.parse(text); } catch { return { _raw: text }; }
    };

    const seedResp = await fetch(`${CRYPTO_API_URL}/crypto/seed-voters`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_ids: [targetVoterId] }),
    });
    if (!seedResp.ok) {
      const seedData = await safeJson(seedResp);
      console.warn("[Blind Signature] seed-voters warning:", seedData);
    }

    const regResp = await fetch(`${CRYPTO_API_URL}/crypto/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_id: targetVoterId }),
    });
    const regData = await safeJson(regResp);
    if (!regResp.ok) {
      console.error("[Blind Signature] register failed:", regData);
      return res.status(500).json({
        error: regData?.detail || regData?._raw || "Failed to issue blind signature",
      });
    }

    otpStore.delete(key);

    const keyResp = await fetch(`${CRYPTO_API_URL}/crypto/rsa-public-key`);
    const keyData = await safeJson(keyResp);
    if (!keyResp.ok) {
      console.error("[Blind Signature] rsa-public-key failed:", keyData);
      return res.status(500).json({ error: "Failed to retrieve RSA public key" });
    }

    res.json({
      success: true,
      voter_id: targetVoterId,
      rsa_public_key: keyData,
      message: "Identity verified and blind-signature credential issued",
    });
  } catch (error) {
    console.error("[Blind Signature] Error:", error);
    res.status(500).json({ error: "Failed to issue blind signature. Please try again." });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.post("/api/otp/test-verify", async (req, res) => {
    const { email, voterId } = req.body;
    if (!email || !voterId) return res.status(400).json({ error: "Email and voterId are required" });

    const safeJsonTV = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t }; } };
    try {
      const seedR = await fetch(`${CRYPTO_API_URL}/crypto/seed-voters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voter_ids: [voterId] }),
      });
      if (!seedR.ok) console.warn("[test-verify] seed-voters warning:", await safeJsonTV(seedR));

      const regResp = await fetch(`${CRYPTO_API_URL}/crypto/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voter_id: voterId }),
      });
      const regData = await safeJsonTV(regResp);
      if (!regResp.ok) return res.status(500).json({ error: regData?.detail || regData?._raw || "Failed to issue blind signature" });

      const keyResp = await fetch(`${CRYPTO_API_URL}/crypto/rsa-public-key`);
      const keyData = await safeJsonTV(keyResp);

      res.json({ success: true, voter_id: voterId, rsa_public_key: keyData,
                 message: "TEST MODE: Identity verified without OTP" });
    } catch (error) {
      res.status(500).json({ error: "Failed to issue blind signature" });
    }
  });
}
// ============================================================
// ELECTION CONFIG
// ============================================================

app.get("/api/config", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, election_name, election_description, voting_method,
            is_sealed, is_tally_released,
            start_date, end_date, created_at, updated_at
     FROM election_config LIMIT 1`
  );
  if (!rows.length) return res.status(404).json({ error: "No config found" });
  res.json({ ...rows[0], voting_method: toFrontendMethod(rows[0].voting_method) });
});

app.patch("/api/config", requireAdmin, async (req, res) => {
  const { votingMethod, startDate, endDate, isSealed, isTallyReleased,
          electionName, electionDescription } = req.body;
  const { rows } = await pool.query(
    `UPDATE election_config SET
       election_name        = COALESCE($1, election_name),
       election_description = COALESCE($2, election_description),
       voting_method        = COALESCE($3, voting_method),
       start_date           = COALESCE($4::timestamptz, start_date),
       end_date             = COALESCE($5::timestamptz, end_date),
       is_sealed            = COALESCE($6, is_sealed),
       is_tally_released    = COALESCE($7, is_tally_released),
       updated_at           = NOW()
     WHERE id = (SELECT id FROM election_config LIMIT 1)
     RETURNING *`,
    [
      electionName    ?? null,
      electionDescription !== undefined ? electionDescription : null,
      votingMethod ? toDbMethod(votingMethod) : null,
      startDate ?? null,
      endDate   ?? null,
      isSealed  ?? null,
      isTallyReleased ?? null,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: "Config not found" });
  await audit(req.adminEmail, "UPDATE_CONFIG", "election", rows[0].id, req.body);
  res.json({ ...rows[0], voting_method: toFrontendMethod(rows[0].voting_method) });
});

app.post("/api/config/seal", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE election_config SET is_sealed = TRUE, updated_at = NOW()
     WHERE id = (SELECT id FROM election_config LIMIT 1)
     RETURNING *`
  );
  if (!rows.length) return res.status(404).json({ error: "Config not found" });

  const electionId = String(rows[0].id);
  await audit(req.adminEmail, "SEAL_ELECTION", "election", rows[0].id);

  try {
    const cryptoResp = await fetch(`${CRYPTO_API_URL}/crypto/open-election`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ election_id: electionId }),
    });
    const text = await cryptoResp.text();
    let cryptoData;
    try { cryptoData = JSON.parse(text); } catch { cryptoData = { error: text }; }
    if (!cryptoResp.ok) console.warn("[Crypto] open-election failed:", cryptoData);
    else console.log(` [Crypto] Election ${electionId} opened.`);
  } catch (e) {
    console.warn("[Crypto] Could not open election:", e.message);
  }

  autoSeedCryptoVoters();
  res.json({ ...rows[0], voting_method: toFrontendMethod(rows[0].voting_method) });
});

app.post("/api/config/tally", requireAdmin, async (req, res) => {
  const { rows: cfgRows } = await pool.query("SELECT * FROM election_config LIMIT 1");
  if (!cfgRows.length) return res.status(404).json({ error: "Config not found" });

  const electionId = String(cfgRows[0].id);

  const safeJson = async (resp) => {
    const t = await resp.text();
    try { return JSON.parse(t); } catch { return { error: t }; }
  };

  // ── Step 1: Close the crypto election (idempotent — 403 means already closed)
  try {
    const r = await fetch(`${CRYPTO_API_URL}/crypto/close-election`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    const d = await safeJson(r);
    if (r.ok || r.status === 403) {
      console.log(` [Crypto] Election ${electionId} close confirmed (status ${r.status}).`);
    } else {
      console.warn("[Crypto] close-election unexpected response:", r.status, d);
    }
  } catch (e) {
    console.warn("[Crypto] close-election failed (non-fatal for tally):", e.message);
  }

  // ── Step 2: Run the tally
  let tallyResult = null;
  let tallyOk = false;
  try {
    const tallyResp = await fetch(`${CRYPTO_API_URL}/crypto/tally`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ election_id: electionId }),
    });
    tallyResult = await safeJson(tallyResp);
    if (!tallyResp.ok) {
      // Surface the actual error detail from the crypto layer
      const errDetail = tallyResult?.detail || tallyResult?.error || "Unknown crypto error";
      console.error(`[Crypto] tally failed (${tallyResp.status}):`, errDetail);
      // Return early with the actual error so the admin sees what went wrong
      return res.status(tallyResp.status).json({
        error: `Tally failed: ${errDetail}`,
        crypto_detail: tallyResult,
      });
    }
    tallyOk = true;
    console.log(`[Crypto] Tally complete:`, tallyResult);
  } catch (e) {
    console.error("[Crypto] tally call failed:", e.message);
    return res.status(502).json({
      error: `Crypto service error during tally: ${e.message}`,
    });
  }

  // ── Step 3: Only mark tally released if crypto tally succeeded
  // ── Step 3: Ensure ALL candidates appear in tally_results (even 0 votes)
  await pool.query(
    `INSERT INTO tally_results (role_id, candidate_id, vote_count)
     SELECT c.role_id, c.id, 0
     FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM tally_results tr
       WHERE tr.role_id = c.role_id AND tr.candidate_id = c.id
     )`
  );

  // ── Step 4: Mark tally released
  const { rows } = await pool.query(
    `UPDATE election_config SET is_tally_released = TRUE, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [cfgRows[0].id]
  );

  await audit(req.adminEmail, "RELEASE_TALLY", "election", rows[0].id, { tallyResult });
});

app.post("/api/config/reset", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Reset election config
    const { rows } = await client.query(
      `UPDATE election_config SET
         is_sealed = FALSE, is_tally_released = FALSE,
         start_date = NULL, end_date = NULL, updated_at = NOW()
       WHERE id = (SELECT id FROM election_config LIMIT 1)
       RETURNING *`
    );
    if (!rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Config not found" }); }

    // 2. Clear tally results
    await client.query("DELETE FROM tally_results");

    // 3. Clear all ballots from previous election
    await client.query("DELETE FROM ballots");

    // 4. Reset all voters so they can vote in the new election
    await client.query("UPDATE voters SET has_voted = FALSE, voted_at = NULL");

    // 5. Clear voter journey records
    await client.query("DELETE FROM voter_journey");

    // 6. Reset department election states
    await client.query("UPDATE dept_election_states SET is_sealed = FALSE, is_tally_released = FALSE, updated_at = NOW()");

    // 7. Clear support tickets and feedback (audit log is PRESERVED)
    await client.query("DELETE FROM support_tickets");
    await client.query("DELETE FROM feedback");

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[Reset] Transaction failed:", e.message);
    return res.status(500).json({ error: "Reset failed: " + e.message });
  } finally {
    client.release();
  }

  // Log the reset in audit (this is preserved across elections)
  await audit(req.adminEmail, "FULL_ELECTION_RESET", "election", "1", {
    note: "Full election reset — all ballots, votes, journeys, and tally cleared. Audit log preserved.",
    cleared: ["tally_results", "ballots", "voter_journey", "support_tickets", "feedback", "voters.has_voted"],
    preserved: ["audit_log", "voters", "candidates", "roles", "departments"],
  });

  // Close the crypto election and reset all voter credentials
  const safeJson = async (resp) => {
    const t = await resp.text();
    try { return JSON.parse(t); } catch { return { error: t }; }
  };

  try {
    const r = await fetch(`${CRYPTO_API_URL}/crypto/close-election`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    if (r.ok || r.status === 403) console.log("[Reset] Crypto election closed.");
  } catch (e) {
    console.warn("[Reset] close-election (non-fatal):", e.message);
  }

  // Reset all voter crypto credentials so they can re-register for new election
  try {
    const { rows: voters } = await pool.query(
      "SELECT student_id FROM voters WHERE student_id IS NOT NULL"
    );
    for (const v of voters) {
      try {
        await fetch(`${CRYPTO_API_URL}/crypto/reset-voter`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voter_id: v.student_id }),
        });
      } catch { /* non-fatal per voter */ }
    }
    console.log(`[Reset] Reset crypto credentials for ${voters.length} voters.`);
  } catch (e) {
    console.warn("[Reset] Voter credential reset (non-fatal):", e.message);
  }

  // Reset auto-end failure counter
  autoEndFailures = 0;

  const { rows: freshConfig } = await pool.query("SELECT * FROM election_config LIMIT 1");
  console.log(`[Reset] Full election reset by ${req.adminEmail}`);
  res.json({
    ...(freshConfig[0] || {}),
    voting_method: toFrontendMethod(freshConfig[0]?.voting_method),
    message: "Election fully reset. All voters can now participate in the new election.",
  });
});
// ============================================================
// DEPARTMENTS
// ============================================================

app.get("/api/departments", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, des.is_sealed, des.is_tally_released
     FROM departments d
     LEFT JOIN dept_election_states des ON des.department_id = d.id
     ORDER BY d.name`
  );
  res.json(rows);
});

app.get("/api/departments/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, des.is_sealed, des.is_tally_released
     FROM departments d
     LEFT JOIN dept_election_states des ON des.department_id = d.id
     WHERE d.id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Department not found" });
  res.json(rows[0]);
});

app.post("/api/departments", requireAdmin, async (req, res) => {
  const { id, name, fullName, prefix } = req.body;
  if (!id || !name || !prefix) return res.status(400).json({ error: "id, name and prefix are required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO departments (id, name, full_name, prefix) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, name, fullName || name, prefix.toUpperCase().slice(0, 3)]
    );
    await client.query(
      `INSERT INTO dept_election_states (department_id, is_sealed, is_tally_released) VALUES ($1, FALSE, FALSE) ON CONFLICT DO NOTHING`,
      [id]
    );
    await client.query("COMMIT");
    await audit(req.adminEmail, "ADD_DEPARTMENT", "department", id, { name });
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

app.put("/api/departments/:id", requireAdmin, async (req, res) => {
  const { name, fullName, prefix } = req.body;
  const { rows } = await pool.query(
    `UPDATE departments SET
       name      = COALESCE($1, name),
       full_name = COALESCE($2, full_name),
       prefix    = COALESCE($3, prefix)
     WHERE id = $4 RETURNING *`,
    [name ?? null, fullName ?? null,
     prefix ? prefix.toUpperCase().slice(0, 3) : null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Department not found" });
  await audit(req.adminEmail, "UPDATE_DEPARTMENT", "department", req.params.id, req.body);
  res.json(rows[0]);
});

app.delete("/api/departments/:id", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM departments WHERE id = $1", [req.params.id]);
  await audit(req.adminEmail, "DELETE_DEPARTMENT", "department", req.params.id);
  res.json({ success: true });
});

app.patch("/api/departments/:id/state", requireAdmin, async (req, res) => {
  const { isSealed, isTallyReleased } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO dept_election_states (department_id, is_sealed, is_tally_released)
     VALUES ($1, COALESCE($2, FALSE), COALESCE($3, FALSE))
     ON CONFLICT (department_id) DO UPDATE SET
       is_sealed         = COALESCE($2, dept_election_states.is_sealed),
       is_tally_released = COALESCE($3, dept_election_states.is_tally_released),
       updated_at        = NOW()
     RETURNING *`,
    [req.params.id, isSealed ?? null, isTallyReleased ?? null]
  )
  await audit(req.adminEmail, "UPDATE_DEPT_STATE", "department", req.params.id, req.body);
  res.json(rows[0]);
});

// ============================================================
// ROLES
// ============================================================

app.get("/api/roles", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM roles ORDER BY name");
  res.json(rows);
});

app.post("/api/roles", requireAdmin, async (req, res) => {
  const { id, name, votingLogic } = req.body;
  if (!id || !name) return res.status(400).json({ error: "id and name are required" });
  const { rows } = await pool.query(
    `INSERT INTO roles (id, name, voting_logic) VALUES ($1, $2, $3) RETURNING *`,
    [id, name, votingLogic || "Plurality"]
  );
  await audit(req.adminEmail, "ADD_ROLE", "role", id, { name, votingLogic });
  res.status(201).json(rows[0]);
});

app.put("/api/roles/:id", requireAdmin, async (req, res) => {
  const { name, votingLogic } = req.body;
  const { rows } = await pool.query(
    `UPDATE roles SET name = COALESCE($1, name), voting_logic = COALESCE($2, voting_logic)
     WHERE id = $3 RETURNING *`,
    [name ?? null, votingLogic ?? null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Role not found" });
  await audit(req.adminEmail, "UPDATE_ROLE", "role", req.params.id, req.body);
  res.json(rows[0]);
});

app.delete("/api/roles/:id", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM roles WHERE id = $1", [req.params.id]);
  await audit(req.adminEmail, "DELETE_ROLE", "role", req.params.id);
  res.json({ success: true });
});

// ============================================================
// CANDIDATES
// ============================================================

app.get("/api/candidates", async (req, res) => {
  const { roleId, departmentId } = req.query;
  let query = "SELECT * FROM candidates WHERE TRUE";
  const params = [];
  if (roleId)       { params.push(roleId);       query += ` AND role_id = $${params.length}`; }
  if (departmentId) { params.push(departmentId); query += ` AND department_id = $${params.length}`; }
  query += " ORDER BY name";
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.post("/api/candidates", requireAdmin, async (req, res) => {
  const { id, roleId, departmentId, name, course, imageUrl } = req.body;
  if (!id || !roleId || !departmentId || !name)
    return res.status(400).json({ error: "id, roleId, departmentId and name are required" });
  const { rows } = await pool.query(
    `INSERT INTO candidates (id, role_id, department_id, name, course, image_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, roleId, departmentId, name, course || null, imageUrl || null]
  );
  await audit(req.adminEmail, "ADD_CANDIDATE", "candidate", id, { name, roleId, departmentId });
  res.status(201).json(rows[0]);
});

app.put("/api/candidates/:id", requireAdmin, async (req, res) => {
  const { name, course, imageUrl } = req.body;
  const { rows } = await pool.query(
    `UPDATE candidates SET
       name      = COALESCE($1, name),
       course    = COALESCE($2, course),
       image_url = COALESCE($3, image_url)
     WHERE id = $4 RETURNING *`,
    [name ?? null, course ?? null, imageUrl ?? null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Candidate not found" });
  await audit(req.adminEmail, "UPDATE_CANDIDATE", "candidate", req.params.id, req.body);
  res.json(rows[0]);
});

app.delete("/api/candidates/:id", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM candidates WHERE id = $1", [req.params.id]);
  await audit(req.adminEmail, "DELETE_CANDIDATE", "candidate", req.params.id);
  res.json({ success: true });
});

// ============================================================
// VOTERS
// ============================================================

app.get("/api/voters", requireAdmin, async (req, res) => {
  const { role } = req.query;
  const params = [];
  let filter = "";
  if (role) { params.push(role); filter = `AND v.role = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT v.id, v.student_id, v.email, v.full_name,
            v.department_id, v.role, v.has_voted,
            v.registered_at, v.voted_at,
            d.name AS department_name
     FROM voters v
     LEFT JOIN departments d ON d.id = v.department_id
     WHERE TRUE ${filter}
     ORDER BY v.registered_at DESC`,
    params
  );
  res.json(rows);
});

app.post("/api/voters/register", async (req, res) => {
  const records = Array.isArray(req.body) ? req.body : [req.body];

  const callerEmail = req.headers["x-admin-email"];
  let callerIsAdmin = false;
  if (callerEmail) {
    const { rows: adminCheck } = await pool.query(
      "SELECT role FROM voters WHERE LOWER(email) = LOWER($1) LIMIT 1", [callerEmail]
    );
    callerIsAdmin = adminCheck[0]?.role === "admin";
  }

  const actor   = callerEmail || "system";
  const results = [];

  for (const { studentId, email, fullName, role, password } of records) {
    if (!studentId || !email) continue;
    if (!callerIsAdmin && !password)
      return res.status(400).json({ error: "password is required for voter registration" });

    let passwordHash = null;
    if (password) passwordHash = await bcrypt.hash(password, 12);

    const assignedRole = callerIsAdmin && role === "admin" ? "admin" : "voter";
    const prefix = studentId.slice(0, 3).toUpperCase();
    const { rows: deptRows } = await pool.query(
      "SELECT id FROM departments WHERE prefix = $1 LIMIT 1", [prefix]
    );
    const departmentId = deptRows[0]?.id || null;

    const { rows } = await pool.query(
      `INSERT INTO voters (student_id, email, full_name, department_id, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         full_name     = EXCLUDED.full_name,
         department_id = COALESCE(EXCLUDED.department_id, voters.department_id),
         password_hash = COALESCE(EXCLUDED.password_hash, voters.password_hash)
       RETURNING id, student_id, email, full_name, department_id, role`,
      [studentId, email, fullName || null, departmentId, assignedRole, passwordHash]
    );
    results.push(rows[0]);
  }

  await audit(actor, "REGISTER_VOTERS", "voter", null, { count: results.length });
  res.status(201).json(results.length === 1 ? results[0] : results);
});

app.post("/api/voters/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });

  const { rows } = await pool.query(
    `SELECT v.id, v.student_id, v.email, v.full_name,
            v.has_voted, v.role, v.password_hash,
            v.department_id, d.name AS department_name, d.prefix
     FROM voters v
     LEFT JOIN departments d ON d.id = v.department_id
     WHERE LOWER(v.email) = LOWER($1)`,
    [email]
  );
  if (!rows.length) return res.status(404).json({ error: "Voter not found or not eligible" });

  const voter = rows[0];
  if (voter.password_hash) {
    if (!password) return res.status(401).json({ error: "Password required" });
    const valid = await bcrypt.compare(password, voter.password_hash);
    if (!valid)   return res.status(401).json({ error: "Invalid password" });
  }

  const { password_hash: _omit, ...safeVoter } = voter;
  res.json(safeVoter);
});

app.patch("/api/voters/:id/password", async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: "password must be at least 6 characters" });
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `UPDATE voters SET password_hash = $1 WHERE id = $2 RETURNING id, email, full_name, role`,
    [passwordHash, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Voter not found" });
  res.json({ success: true, voter: rows[0] });
});

app.patch("/api/voters/:id/role", requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!["admin", "voter"].includes(role))
    return res.status(400).json({ error: "role must be 'admin' or 'voter'" });
  const { rows } = await pool.query(
    `UPDATE voters SET role = $1 WHERE id = $2
     RETURNING id, student_id, email, full_name, role, department_id`,
    [role, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Voter not found" });
  await audit(req.adminEmail, "UPDATE_VOTER_ROLE", "voter", req.params.id, { role });
  res.json(rows[0]);
});

app.delete("/api/voters/:id", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM voters WHERE id = $1 RETURNING *", [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Voter not found" });
  await audit(req.adminEmail, "DELETE_VOTER", "voter", req.params.id);
  res.json({ success: true, deletedVoter: rows[0] });
});

// ============================================================
// BALLOTS
// ============================================================

app.get("/api/ballots", async (req, res) => {
  const { roleId } = req.query;
  let query = `SELECT b.id, b.role_id, b.token_hash, b.ciphertext,
                      b.zkp_proof, b.is_real, b.submitted_at
               FROM ballots b WHERE TRUE`;
  const params = [];
  if (roleId) { params.push(roleId); query += ` AND b.role_id = $${params.length}`; }
  query += " ORDER BY b.submitted_at DESC LIMIT 100";
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.post("/api/ballots/submit", async (req, res) => {
  const { roleId, tokenHash, ciphertext, zkpProof, isReal } = req.body;

  if (!roleId || !tokenHash || !ciphertext || !zkpProof) {
    return res.status(400).json({
      error: "roleId, tokenHash, ciphertext and zkpProof are required",
    });
  }

  const { rows: cfg } = await pool.query(
    "SELECT is_sealed, is_tally_released FROM election_config LIMIT 1"
  );
  if (!cfg[0]?.is_sealed) {
    return res.status(403).json({ error: "Election is not yet open" });
  }
  if (cfg[0]?.is_tally_released) {
    return res.status(403).json({ error: "Voting has already closed" });
  }

  const studentId = req.headers["x-voter-id"] || null;
  if (!studentId) {
    return res.status(400).json({ error: "x-voter-id header is required." });
  }

  let voteValue = 1;
  if (ciphertext && typeof ciphertext === "object") {
    if ("selected" in ciphertext) {
      voteValue = ciphertext.selected !== null ? 1 : 0;
    } else if ("ranked" in ciphertext) {
      voteValue = Array.isArray(ciphertext.ranked) && ciphertext.ranked.length > 0 ? 1 : 0;
    }
  }

  const isFake = isReal === false;

  const safeJson = async (resp) => {
    const t = await resp.text();
    try { return JSON.parse(t); } catch { return { error: t }; }
  };

  const tryCastVote = async () => {
    const cryptoResp = await fetch(`${CRYPTO_API_URL}/crypto/cast-vote`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voter_id:   studentId,
        vote_value: voteValue,
        role_id:    roleId,
        is_fake:    isFake,
      }),
    });
    const data = await safeJson(cryptoResp);
    return { ok: cryptoResp.ok, status: cryptoResp.status, data };
  };

  try {
    let { ok, status, data } = await tryCastVote();

    if (!ok) {
      const errMsg = (data?.detail || data?.error || "").toLowerCase();
      if (errMsg.includes("not registered") || errMsg.includes("register()")) {
        console.warn(`[Ballots/Submit] "not registered" for ${studentId} — triggering re-registration and retry.`);
        try {
          await ensureCryptoRegistration(studentId);
        } catch (regErr) {
          console.error("[Ballots/Submit] Re-registration failed:", regErr.message);
          return res.status(502).json({
            error: "Could not re-issue voting credential. Please log out and try again.",
          });
        }
        ({ ok, status, data } = await tryCastVote());
      }
    }

    if (!ok) {
      console.error("[Ballots/Submit] Crypto cast-vote failed:", data);
      return res.status(status).json({
        error: data?.detail || data?.error || "Ballot rejected by crypto layer",
      });
    }

    // ── Mark real vote in Postgres ──────────────────────────────────────────
    // ── Mark real vote in Postgres ──────────────────────────────────────────
    if (!isFake) {
      await pool.query(
        "UPDATE voters SET has_voted = TRUE, voted_at = NOW() WHERE student_id = $1",
        [studentId]
      );

      // ── Record candidate selection for per-role tally ──
      // ciphertext.selected holds the candidate_id chosen by the voter.
      // This is stored anonymously (no voter link) and only revealed
      // when is_tally_released = TRUE via /api/results.
      const candidateId = ciphertext?.selected || null;
      if (candidateId && roleId) {
        try {
          await pool.query(
            `INSERT INTO tally_results (role_id, candidate_id, vote_count)
             VALUES ($1, $2, 1)
             ON CONFLICT (role_id, candidate_id) DO UPDATE
               SET vote_count = tally_results.vote_count + 1, tallied_at = NOW()`,
            [roleId, candidateId]
          );
        } catch (tallyErr) {
          console.warn("[Ballots/Submit] tally_results upsert failed (non-fatal):", tallyErr.message);
        }
      }
    }

    // ── After a fake (Mode A) ballot, reset the crypto credential so
    // the voter can return and cast their real ballot (Mode B).
    if (isFake) {
      try {
        const resetResp = await fetch(`${CRYPTO_API_URL}/crypto/reset-coercion`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ voter_id: studentId }),
        });
        if (resetResp.ok) {
          console.log(`[Ballots/Submit] Coercion reset done for ${studentId} (Mode A).`);
        } else {
          const rd = await safeJson(resetResp);
          console.warn(`[Ballots/Submit] reset-coercion non-OK for ${studentId}:`, rd);
        }
      } catch (resetErr) {
        console.warn(`[Ballots/Submit] reset-coercion failed (non-fatal):`, resetErr.message);
      }
    }

    console.log(
      ` [Ballots/Submit] Ballot accepted for ${studentId} ` +
      `role=${roleId} value=${voteValue} fake=${isFake} ballot_id=${data.ballot_id}`
    );

    return res.status(201).json({
      success:     true,
      ballotId:    data.ballot_id,
      submittedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error("[Ballots/Submit] Error:", err.message);
    return res.status(502).json({
      error: "Crypto service unavailable. Please try again.",
      detail: err.message,
    });
  }
});

app.post("/api/ballots/verify", async (req, res) => {
  const { tokenHash } = req.body;
  if (!tokenHash) return res.status(400).json({ error: "tokenHash required" });
  const { rows } = await pool.query(
    "SELECT id, role_id, submitted_at, is_real FROM ballots WHERE token_hash = $1", [tokenHash]
  );
  if (!rows.length) return res.json({ found: false });
  res.json({ found: true, ballot: rows[0] });
});

// ============================================================
// BULLETIN BOARD  (FIX: was missing — frontend calls /api/bulletin-board)
// ============================================================

app.get("/api/bulletin-board", async (req, res) => {
  try {
    const r = await fetch(`${CRYPTO_API_URL}/crypto/bulletin-board`);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = []; }
    if (!r.ok) {
      console.warn("[Bulletin Board] crypto returned:", r.status, data);
      return res.status(r.status).json(data);
    }
    // The crypto bulletin-board returns [{entry_id, ciphertext, zkp_proof, submitted_at}]
    // Map to the shape the frontend BulletinBoard component expects
    const mapped = (Array.isArray(data) ? data : []).map((entry, idx) => ({
      id:           entry.entry_id,
      token_hash:   entry.entry_id,          // entry_id doubles as public token reference
      ciphertext_a: entry.ciphertext
        ? String(entry.ciphertext).slice(0, 24) + "…"
        : "—",
      zkp_proof:    entry.zkp_proof
        ? String(entry.zkp_proof).slice(0, 24) + "…"
        : "—",
      zkp_verified: true,                    // only verified ballots reach the board
      is_real:      true,                    // coercer-view hides this column anyway
      counted:      true,
    }));
    res.json(mapped);
  } catch (err) {
    console.error("[Bulletin Board] Error:", err.message);
    res.status(502).json({ error: "Crypto service unavailable", detail: err.message });
  }
});

// ============================================================
// VERIFY BALLOT  (FIX: frontend calls /api/verify-ballot)
// ============================================================

app.post("/api/verify-ballot", async (req, res) => {
  const { token_hash } = req.body;
  if (!token_hash) return res.status(400).json({ error: "token_hash required" });

  // Check Postgres ballots table
  const { rows } = await pool.query(
    "SELECT id, role_id, submitted_at, is_real FROM ballots WHERE token_hash = $1",
    [token_hash]
  );

  if (!rows.length) {
    return res.json({
      found: false,
      ballot_on_board: false,
      zkp_valid: false,
      included_in_tally: false,
      result_matches: false,
      error: "Token not found. Please check your token hash.",
    });
  }

  const ballot = rows[0];
  return res.json({
    found:             true,
    ballot_on_board:   true,
    zkp_valid:         true,   // only verified proofs are stored
    included_in_tally: ballot.is_real,
    result_matches:    ballot.is_real,
  });
});

// ============================================================
// TALLY RESULTS
// ============================================================

app.get("/api/results", async (req, res) => {
  const { rows: cfg } = await pool.query("SELECT is_tally_released FROM election_config LIMIT 1");
  if (!cfg[0]?.is_tally_released) return res.status(403).json({ error: "Tally not yet released" });

  const { rows } = await pool.query(
    `SELECT tr.role_id, r.name AS role_name, r.voting_logic,
            tr.candidate_id, c.name AS candidate_name,
            c.image_url, c.course, c.department_id,
            d.name AS department_name,
            tr.vote_count, tr.tallied_at
     FROM tally_results tr
     JOIN roles r ON r.id = tr.role_id
     JOIN candidates c ON c.id = tr.candidate_id
     LEFT JOIN departments d ON d.id = c.department_id
     ORDER BY tr.role_id, tr.vote_count DESC`
  );
  res.json(rows);
});

app.post("/api/results/publish", requireAdmin, async (req, res) => {
  const results = req.body;
  if (!Array.isArray(results) || !results.length)
    return res.status(400).json({ error: "Array of results required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { roleId, candidateId, voteCount } of results) {
      await client.query(
        `INSERT INTO tally_results (role_id, candidate_id, vote_count)
         VALUES ($1, $2, $3)
         ON CONFLICT (role_id, candidate_id) DO UPDATE
           SET vote_count = EXCLUDED.vote_count, tallied_at = NOW()`,
        [roleId, candidateId, voteCount]
      );
    }
    await client.query("UPDATE election_config SET is_tally_released = TRUE");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  await audit(req.adminEmail, "PUBLISH_TALLY", "election", null, { count: results.length });
  res.json({ success: true });
});

// ============================================================
// VOTER JOURNEY
// ============================================================

app.post("/api/journey", async (req, res) => {
  const { voterId, identityVerified, tunnelActive, choicesMade, ledgerUpdated } = req.body;
  if (!voterId) return res.status(400).json({ error: "voterId required" });
  const { rows } = await pool.query(
    `INSERT INTO voter_journey
       (voter_id, identity_verified, tunnel_active, choices_made, ledger_updated)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (voter_id) DO UPDATE SET
       identity_verified = COALESCE($2, voter_journey.identity_verified),
       tunnel_active     = COALESCE($3, voter_journey.tunnel_active),
       choices_made      = COALESCE($4, voter_journey.choices_made),
       ledger_updated    = COALESCE($5, voter_journey.ledger_updated)
     RETURNING *`,
    [voterId, identityVerified || null, tunnelActive || null, choicesMade || null, ledgerUpdated || null]
  );
  res.status(201).json(rows[0]);
});

app.get("/api/journey/:voterId", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM voter_journey WHERE voter_id = $1", [req.params.voterId]
  );
  if (!rows.length) return res.status(404).json({ error: "Journey not found" });
  res.json(rows[0]);
});

// ============================================================
// AUDIT LOG
// ============================================================

app.get("/api/audit", requireAdmin, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 500);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await pool.query(
    "SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  res.json(rows);
});

// FIX: Frontend AdminTallyHub fetches /api/audit-log (not /api/audit)
// Add alias so both paths work
app.get("/api/audit-log", requireAdmin, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 500);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await pool.query(
    `SELECT id AS block_id,
            action || ' — ' || COALESCE(target_type, '') AS label,
            TRUE AS verified,
            occurred_at
     FROM audit_log
     ORDER BY occurred_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
});

// Download audit log as CSV
app.get("/api/audit-log/download", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, actor, action, target_type, target_id, metadata, occurred_at FROM audit_log ORDER BY occurred_at DESC"
    );
    const header = "ID,Actor,Action,Target Type,Target ID,Metadata,Occurred At\n";
    const csvRows = rows.map(r =>
      [
        r.id,
        `"${(r.actor || '').replace(/"/g, '""')}"`,
        `"${(r.action || '').replace(/"/g, '""')}"`,
        `"${(r.target_type || '').replace(/"/g, '""')}"`,
        `"${(r.target_id || '').replace(/"/g, '""')}"`,
        `"${(typeof r.metadata === 'object' ? JSON.stringify(r.metadata) : (r.metadata || '')).replace(/"/g, '""')}"`,
        r.occurred_at,
      ].join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=audit_log_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(header + csvRows);
  } catch (e) {
    res.status(500).json({ error: "Failed to generate audit CSV: " + e.message });
  }
});

// ============================================================
// SUPPORT TICKETS
// ============================================================

app.post("/api/support", async (req, res) => {
  const { voterId, email, fullName, message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });
  const { rows } = await pool.query(
    `INSERT INTO support_tickets (voter_id, email, full_name, message)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [voterId || null, email || null, fullName || null, message]
  );
  res.status(201).json(rows[0]);
});

app.get("/api/support", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM support_tickets ORDER BY created_at DESC");
  res.json(rows);
});

app.patch("/api/support/:id", requireAdmin, async (req, res) => {
  const { status } = req.body;
  const { rows } = await pool.query(
    "UPDATE support_tickets SET status = $1 WHERE id = $2 RETURNING *",
    [status, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Ticket not found" });
  res.json(rows[0]);
});

// ============================================================
// FEEDBACK
// ============================================================

app.post("/api/feedback", async (req, res) => {
  const { voterId, rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: "rating must be 1–5" });
  const { rows } = await pool.query(
    "INSERT INTO feedback (voter_id, rating, comment) VALUES ($1, $2, $3) RETURNING *",
    [voterId || null, rating, comment || null]
  );
  res.status(201).json(rows[0]);
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/health", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// CRYPTO PROXY ENDPOINTS
// ============================================================

app.get("/api/crypto/status",              async (req, res) => cryptoProxy(res, "GET",  "/crypto/status"));
app.get("/api/crypto/paillier-public-key", async (req, res) => cryptoProxy(res, "GET",  "/crypto/paillier-public-key"));
app.get("/api/crypto/bulletin-board",      async (req, res) => cryptoProxy(res, "GET",  "/crypto/bulletin-board"));
app.get("/api/crypto/zkp-test",            async (req, res) => cryptoProxy(res, "GET",  "/crypto/zkp-test"));

app.get("/api/crypto/tally/:electionId", async (req, res) => {
  await cryptoProxy(res, "GET", `/crypto/tally/${req.params.electionId}`);
});

app.post("/api/crypto/seed-voters", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT student_id FROM voters WHERE role = 'voter' AND student_id IS NOT NULL"
  );
  const voter_ids = rows.map(r => r.student_id).filter(Boolean);
  if (!voter_ids.length) return res.status(400).json({ error: "No voters found in Postgres" });
  await audit(req.adminEmail, "CRYPTO_SEED_VOTERS", "system", null, { count: voter_ids.length });
  await cryptoProxy(res, "POST", "/crypto/seed-voters", { voter_ids });
});

app.post("/api/crypto/register/:studentId", async (req, res) => {
  const { studentId } = req.params;
  const { rows } = await pool.query(
    "SELECT student_id FROM voters WHERE student_id = $1 LIMIT 1", [studentId]
  );
  if (!rows.length) return res.status(404).json({ error: "Voter not found in Postgres" });
  await cryptoProxy(res, "POST", "/crypto/register", { voter_id: studentId });
});

app.post("/api/crypto/cast-vote", async (req, res) => {
  const { studentId, voteValue, roleId, isFake } = req.body;
  if (!studentId || voteValue === undefined || !roleId)
    return res.status(400).json({ error: "studentId, voteValue and roleId are required" });

  const { rows } = await pool.query(
    "SELECT id, has_voted FROM voters WHERE student_id = $1 LIMIT 1", [studentId]
  );
  if (!rows.length) return res.status(404).json({ error: "Voter not found" });

  const r = await fetch(`${CRYPTO_API_URL}/crypto/cast-vote`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voter_id: studentId, vote_value: parseInt(voteValue),
      role_id: roleId, is_fake: isFake || false,
    }),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!r.ok) return res.status(r.status).json(data);

  if (!isFake) {
    await pool.query(
      "UPDATE voters SET has_voted = TRUE, voted_at = NOW() WHERE student_id = $1", [studentId]
    );
  }
  res.json(data);
});

app.post("/api/crypto/open-election", requireAdmin, async (req, res) => {
  const { electionId } = req.body;
  await audit(req.adminEmail, "CRYPTO_OPEN_ELECTION", "election", null, { electionId });
  await cryptoProxy(res, "POST", "/crypto/open-election", { election_id: electionId });
});

app.post("/api/crypto/close-election", requireAdmin, async (req, res) => {
  await audit(req.adminEmail, "CRYPTO_CLOSE_ELECTION", "election", null);
  await cryptoProxy(res, "POST", "/crypto/close-election");
});

app.post("/api/crypto/tally", requireAdmin, async (req, res) => {
  const { electionId } = req.body;
  await audit(req.adminEmail, "CRYPTO_TALLY", "election", null, { electionId });
  await cryptoProxy(res, "POST", "/crypto/tally", { election_id: electionId });
});

app.post("/api/crypto/reset-voter", requireAdmin, async (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ error: "studentId required" });
  await cryptoProxy(res, "POST", "/crypto/reset-voter", { voter_id: studentId });
});

// ============================================================
// PLUGIN ENGINE PROXY  (FastAPI app/main.py, :8000)
// Voting-method tally engine + Graceful Degradation Protocol.
// The React admin UI calls these via the Node gateway so everything
// goes through one origin (and admin actions are audited here).
// ============================================================

// Plugin engine health + active plugin info
app.get("/api/plugin/health", async (req, res) => pluginProxy(res, "GET", "/health"));
app.get("/api/plugin/info",   async (req, res) => pluginProxy(res, "GET", "/plugin/info"));

// Switch the active voting method (persists to the SHARED election_config row)
app.post("/api/plugin/switch", requireAdmin, async (req, res) => {
  const { method } = req.body;
  if (!method) return res.status(400).json({ error: "method is required" });
  await audit(req.adminEmail, "PLUGIN_SWITCH", "election", null, { method });
  await pluginProxy(res, "POST", "/plugin/switch", { method });
});

// Method-engine tally over the plugin engine's own ballot store
app.get("/api/plugin/tally/:electionId", async (req, res) =>
  pluginProxy(res, "GET", `/election/${encodeURIComponent(req.params.electionId)}/tally`)
);

// ============================================================
// DISASTER RECOVERY PROXY  (Graceful Degradation Protocol)
// Used by the admin dashboard Security tab.
// ============================================================

app.post("/api/recovery/initiate", requireAdmin, async (req, res) => {
  const { electionId, failureEvent } = req.body;
  if (!electionId) return res.status(400).json({ error: "electionId is required" });
  await audit(req.adminEmail, "RECOVERY_INITIATE", "election", electionId, {
    failureEvent: failureEvent || {},
  });
  await pluginProxy(res, "POST", "/recovery/initiate", {
    election_id:   String(electionId),
    failure_event: failureEvent || {},
  });
});

app.get("/api/recovery/:electionId/audit-report", async (req, res) =>
  pluginProxy(res, "GET", `/recovery/${encodeURIComponent(req.params.electionId)}/audit-report`)
);

// ============================================================
// UNIFIED SYSTEM HEALTH  (Node + Postgres + crypto + plugin engine)
// ============================================================

app.get("/api/system/health", async (req, res) => {
  const ping = async (url) => {
    try { const r = await fetch(url); return { ok: r.ok, status: r.status }; }
    catch (e) { return { ok: false, status: 0, error: e.message }; }
  };

  let dbOk = true;
  try { await pool.query("SELECT 1"); } catch { dbOk = false; }

  const [cryptoHealth, pluginHealth] = await Promise.all([
    ping(`${CRYPTO_API_URL}/crypto/status`),
    ping(`${PLUGIN_API_URL}/health`),
  ]);

  res.json({
    node:       { ok: true, port: PORT },
    database:   { ok: dbOk },
    crypto:     { ok: cryptoHealth.ok, url: CRYPTO_API_URL, status: cryptoHealth.status },
    plugin:     { ok: pluginHealth.ok, url: PLUGIN_API_URL, status: pluginHealth.status },
    allHealthy: dbOk && cryptoHealth.ok && pluginHealth.ok,
    timestamp:  new Date().toISOString(),
  });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});
