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