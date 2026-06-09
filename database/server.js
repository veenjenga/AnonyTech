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
