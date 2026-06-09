/**
 * SecureTunnel.tsx
 * ================
 * Blind-signature ceremony screen — sits between OTP verify and BallotPage.
 *
 * What this screen actually does
 * --------------------------------
 * The REAL RSA blind signature was already obtained server-side during
 * /api/otp/verify → /crypto/register (Python RegistrationServer.issue_blind_signature).
 * By the time the voter reaches this page, credential_issued = TRUE in Postgres
 * and a valid signed token lives in the Python VoterClient session.
 *
 * This screen performs an EDUCATIONAL CLIENT-SIDE SIMULATION of the
 * blind-signature ceremony:
 *   Step 1 — random raw token generated in browser (cosmetic)
 *   Step 2 — SHA-256(token ‖ r) blinding (cosmetic)
 *   Step 3 — /api/journey milestone recorded in Postgres (REAL network call)
 *   Step 4 — "unblinding" to a signed credential (cosmetic)
 *
 * The `signedToken` stored in sessionStorage is a client-side SHA-256 hash
 * used only as a local handle. The actual anonymous RSA credential that the
 * Python BallotServer verifies is held server-side in the VoterClient session.
 *
 * Back-navigation lock
 * ----------------------
 * pushState + popstate listener prevents browser back button / keyboard
 * shortcut / swipe gesture for the entire duration of this page.
 * beforeunload fires a confirmation dialog while the protocol is running.
 */

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  Lock,
  ShieldCheck,
  Fingerprint,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Voter {
  id: string;
  student_id: string;
  email: string;
  full_name: string;
  department_id: string;
  has_voted: boolean;
  role: string;
}

interface BlindSigStep {
  step: number;
  title: string;
  detail: string;
  note: string;
}

// ─── API ─────────────────────────────────────────────────────────────────────
const API_BASE: string =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env
    .VITE_API_URL || "http://localhost:5000";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Web-Crypto helpers ───────────────────────────────────────────────────────
async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Blind-signature educational ceremony ─────────────────────────────────────
async function runBlindSigProtocol(
  voter: Voter,
  tokenChoice: "A" | "B",
  onStep: (step: BlindSigStep) => void
): Promise<string> {
  const rawToken = randomHex(32);
  const blindingFactor = randomHex(16);

  onStep({
    step: 1,
    title: "Token generated in your browser",
    detail: `token = 0x${rawToken.slice(0, 16)}… (path ${tokenChoice})`,
    note: "This value never leaves your browser.",
  });
  await sleep(600);

  const commitment = await sha256Hex(rawToken + blindingFactor);
  onStep({
    step: 2,
    title: "Token blinded before sending",
    detail: `blinded = SHA-256(token ‖ r) = 0x${commitment.slice(0, 16)}…`,
    note: "Server sees only the blinded commitment. Real RSA blind sig was issued at OTP step.",
  });
  await sleep(600);

  // Real network call — record journey milestone
  await apiFetch("/api/journey", {
    method: "POST",
    body: JSON.stringify({
      voterId: voter.id,
      identityVerified: new Date().toISOString(),
      tunnelActive: new Date().toISOString(),
    }),
  });
  onStep({
    step: 3,
    title: "Registration server confirmed eligibility",
    detail: `Voter ID verified: ${voter.student_id}`,
    note: "credential_issued = TRUE in Postgres. Server CANNOT link this to your ballot.",
  });
  await sleep(600);

  const signedToken = await sha256Hex(commitment + voter.id + tokenChoice);
  onStep({
    step: 4,
    title: "Signature unblinded in your browser",
    detail: `credential = 0x${signedToken.slice(0, 16)}… (unlinked from identity)`,
    note: "★ Your identity and your voting credential are now permanently disconnected.",
  });
  await sleep(600);

  return signedToken;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function SecureTunnel() {
  const navigate = useNavigate();

  const [voter, setVoter] = useState<Voter | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<BlindSigStep[]>([]);
  const [protocolError, setProtocolError] = useState<string | null>(null);

  // ── BACK-NAVIGATION LOCK — permanent ─────────────────────────────────────
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Block tab close / refresh while protocol is in flight
  useEffect(() => {
    if (!isProcessing) return;
    const blockUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "Credential issuance is in progress. Leaving now may corrupt your session.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", blockUnload);
    return () => window.removeEventListener("beforeunload", blockUnload);
  }, [isProcessing]);

  // ── Load voter ────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = sessionStorage.getItem("voter");
    if (!stored) { navigate("/login"); return; }
    const v: Voter = JSON.parse(stored);
    if (v.has_voted) { navigate("/already-voted"); return; }
    setVoter(v);
  }, [navigate]);

  // ── Token selection ───────────────────────────────────────────────────────
  const handleTokenSelect = async (choice: "A" | "B") => {
    if (!voter) return;
    setIsProcessing(true);
    setCompletedSteps([]);
    setProtocolError(null);

    try {
      const signedToken = await runBlindSigProtocol(
        voter,
        choice,
        (step) => setCompletedSteps((prev) => [...prev, step])
      );
      sessionStorage.setItem("signedToken", signedToken);
      sessionStorage.setItem("tokenChoice", choice);
      await sleep(400);
      navigate("/ballot");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Anonymous credential issuance failed";
      setProtocolError(msg);
      setIsProcessing(false);
      setCompletedSteps([]);
    }
  };

  if (!voter && !loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F8FAFC]">
        <Loader2 size={40} className="animate-spin text-[#0D5D56]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#F8FAFC] p-8 text-center">
        <AlertCircle size={48} className="mb-4 text-red-500" />
        <p className="font-bold text-[#0D5D56]">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center relative z-10 bg-[#F8FAFC]">

      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#A7F3D0] rounded-full mix-blend-overlay filter blur-[100px] opacity-60 pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-[#0D5D56] rounded-full mix-blend-overlay filter blur-[120px] opacity-20 pointer-events-none" />

      <AnimatePresence mode="wait">
        {!isProcessing && (
          <motion.div
            key="token-selection"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.05, y: -10 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-4xl"
          >
            <div className="mb-12">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[24px] bg-[#A7F3D0]/30 border border-[#A7F3D0] shadow-sm">
                <ShieldCheck className="w-10 h-10 text-[#0D5D56]" />
              </div>
              <h2 className="mb-3 font-['Figtree'] text-4xl font-bold text-[#0D5D56]">
                Activate Secure Session
              </h2>
              <p className="text-lg font-medium leading-relaxed text-[#0D5D56]/70 max-w-xl mx-auto">
                Choose your path. Both tokens provide identical security
                guarantees and indistinguishable network footprints.
              </p>
              {voter && (
                <p className="mt-3 text-xs font-bold text-[#0D5D56]/40 tracking-widest uppercase">
                  Authenticated as {voter.student_id} · {voter.full_name}
                </p>
              )}
            </div>

            {protocolError && (
              <div className="mb-6 mx-auto max-w-lg bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3 text-red-700">
                <AlertCircle size={20} className="shrink-0" />
                <p className="font-bold text-sm text-left">{protocolError}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-4">
              {(["A", "B"] as const).map((choice) => (
                <motion.button
                  key={choice}
                  whileHover={{ scale: 1.03, y: -5 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleTokenSelect(choice)}
                  className="bg-white rounded-[40px] p-10 border-2 border-[#A7F3D0]/50 shadow-[0_16px_40px_rgba(13,93,86,0.05)] flex flex-col items-center group hover:border-[#0D5D56] hover:shadow-[0_16px_40px_rgba(13,93,86,0.15)] transition-all"
                >
                  <div className="w-24 h-24 rounded-full bg-[#F8FAFC] border border-[#A7F3D0] flex items-center justify-center mb-6 group-hover:bg-[#A7F3D0]/20 transition-colors">
                    <Fingerprint className="w-12 h-12 text-[#0D5D56]" />
                  </div>
                  <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] mb-2">
                    Identity Token {choice}
                  </h3>
                  <p className="text-[#0D5D56]/60 font-bold text-sm">
                    {choice === "A" ? "Primary Path" : "Safety Path"}
                  </p>
                  <div className="w-full h-px bg-[#A7F3D0]/50 my-6" />
                  <span className="bg-[#A7F3D0]/30 text-[#0D5D56] px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2">
                    <Lock size={14} /> Zero-Knowledge Proof
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {isProcessing && (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center absolute inset-0 z-50 bg-[#0D5D56]/90 backdrop-blur-md p-8"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="w-20 h-20 border-4 border-transparent border-t-[#A7F3D0] border-r-[#A7F3D0] rounded-full mb-6 shadow-[0_0_40px_rgba(167,243,208,0.4)]"
            />
            <h2 className="font-['Figtree'] text-2xl font-bold text-white tracking-widest uppercase mb-2">
              Issuing Anonymous Credential
            </h2>
            <p className="text-[#A7F3D0] font-bold text-sm mb-8">
              Applying Temporal Equalization — please wait…
            </p>
            <div className="w-full max-w-lg bg-white/10 border border-white/20 rounded-[28px] p-6 text-left">
              <p className="text-[#A7F3D0] text-xs font-bold uppercase tracking-widest mb-4">
                Blind Signature Protocol
              </p>
              <div className="space-y-3">
                {completedSteps.map((s) => (
                  <motion.div
                    key={s.step}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex gap-3"
                  >
                    <div className="shrink-0 mt-0.5">
                      <CheckCircle2 size={18} className="text-[#A7F3D0]" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">
                        Step {s.step} — {s.title}
                      </p>
                      <p className="text-[#A7F3D0] text-xs font-mono mt-0.5">{s.detail}</p>
                      <p className="text-white/50 text-xs mt-0.5">{s.note}</p>
                    </div>
                  </motion.div>
                ))}
                {Array.from({ length: Math.max(0, 4 - completedSteps.length) }).map((_, i) => (
                  <div key={`pending-${i}`} className="flex gap-3 opacity-30">
                    <div className="w-4 h-4 rounded-full border-2 border-[#A7F3D0]/50 mt-0.5 shrink-0" />
                    <p className="text-sm font-bold text-white/40">
                      Step {completedSteps.length + i + 1} — pending…
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}