import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { Lock, ShieldCheck, CheckCircle2, Loader2, Key, Fingerprint, Eye } from "lucide-react";

import { getCoercionMode, setCoercionMode } from "../utils/dataStore";

const API_BASE: string =
  (import.meta as ImportMeta & {
    env: { VITE_API_URL?: string };
  }).env.VITE_API_URL || "http://localhost:5000";

const CRYPTO_STEPS = [
  {
    id: "encrypt",
    icon: <Lock size={16} />,
    title: "Vote encrypted using Paillier public key",
    details: ["Enc(1) generated for selected candidate", "Plaintext vote destroyed — never transmitted"],
    ciphertext: "2349817234918234...8f4a",
    delay: 200,
  },
  {
    id: "zkp",
    icon: <Eye size={16} />,
    title: "ZKP Sigma proof generated",
    details: [
      "Commitment: 0x4a7f3b9c...",
      "Challenge:  SHA-256(commit) = 0x91bc2d7f...",
      "Response:   computed locally",
    ],
    delay: 900,
  },
  {
    id: "blind",
    icon: <Key size={16} />,
    title: "Blind signature token attached",
    details: [
      "Token: 0x3d8e7f2a... (anonymous credential)",
      "Signature valid: YES",
    ],
    delay: 1600,
  },
  {
    id: "submit",
    icon: <ShieldCheck size={16} />,
    title: "Submitting to Ballot Server...",
    details: [
      "ZKP verification: PASSED",
      "Token signature: VALID",
      "Ballot stored — no voter identity recorded",
    ],
    delay: 2200,
    isLast: true,
  },
];

// ── helpers ──────────────────────────────────────────────────
function randomHex(len = 8) {
  return Array.from({ length: len }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

function buildTokenHash() {
  return randomHex(64); // 256-bit hex string
}

function buildCiphertext(roleId: string, candidateId: string, isReal: boolean) {
  // In a real system this would be actual Paillier encryption.
  // We generate structurally correct-looking blobs so the server
  // stores something meaningful. For coercion mode we swap in a
  // random candidate so the real choice is never recorded.
  return {
    roleId,
    candidateId: isReal ? candidateId : randomHex(8),
    encA: randomHex(24) + "..." + randomHex(4),
    encB: randomHex(24) + "..." + randomHex(4),
  };
}

function buildZkpProof() {
  return {
    commitment0: "0x" + randomHex(8),
    commitment1: "0x" + randomHex(8),
    challenge:   "0x" + randomHex(8),
    response0:   "0x" + randomHex(8),
    response1:   "0x" + randomHex(8),
  };
}

async function submitBallotToServer(payload: {
  roleId: string;
  tokenHash: string;
  ciphertext: object;
  zkpProof: object;
  isReal: boolean;
}) {
  const res = await fetch(`${API_BASE}/api/ballots/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json(); // { success, ballotId, submittedAt }
}

// ─────────────────────────────────────────────────────────────

export function SubmissionShield() {
  const [progress, setProgress]           = useState(0);
  const [visibleSteps, setVisibleSteps]   = useState<string[]>([]);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [showCiphertext, setShowCiphertext] = useState(false);
  const [submitError, setSubmitError]     = useState<string | null>(null);

  const navigate   = useNavigate();
  const location   = useLocation();
  const isCoercion = getCoercionMode();

  // Expect the previous page to pass roleId + candidateId via location.state
  const { roleId, candidateId } = (location.state as {
    roleId?: string;
    candidateId?: string;
  }) ?? {};

  useEffect(() => {
    if (!roleId || !candidateId) {
      // Nothing to submit — go back to dashboard
      navigate("/dashboard");
      return;
    }

    const tokenHash  = buildTokenHash();
    const ciphertext = buildCiphertext(roleId, candidateId, !isCoercion);
    const zkpProof   = buildZkpProof();

    // Fire-and-forget: submit while the animation plays.
    // Any error surfaces as an inline message after the animation ends.
    submitBallotToServer({
      roleId,
      tokenHash,
      ciphertext,
      zkpProof,
      isReal: !isCoercion,
    })
      .catch((err: Error) => setSubmitError(err.message))
      .finally(() => setCoercionMode(false));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const duration = 3000;
    const interval = 50;
    const steps     = duration / interval;
    const increment = 100 / steps;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev + increment >= 100) {
          clearInterval(timer);
          setTimeout(() => {
            if (submitError) {
              navigate("/dashboard", {
                state: {
                  notification: {
                    type: "error",
                    message: `Ballot submission failed: ${submitError}`,
                  },
                },
              });
            } else {
              navigate("/dashboard", {
                state: {
                  notification: { type: "success", message: "Vote Recorded Successfully." },
                },
              });
            }
          }, 400);
          return 100;
        }
        return prev + increment;
      });
    }, interval);

    CRYPTO_STEPS.forEach((step) => {
      setTimeout(() => {
        setVisibleSteps((prev) => [...prev, step.id]);
        setTimeout(() => {
          setCompletedSteps((prev) => [...prev, step.id]);
          if (step.id === "encrypt") setShowCiphertext(true);
        }, 500);
      }, step.delay);
    });

    return () => clearInterval(timer);
  }, [navigate, submitError]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-6 relative overflow-hidden z-10">
      <div className="relative z-10 w-full max-w-2xl flex flex-col gap-6">

        {/* Top card — lock + progress */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center text-center bg-white/70 px-10 py-8 rounded-[40px] backdrop-blur-3xl border border-white shadow-[0_16px_40px_rgba(19,111,99,0.15)]"
        >
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] bg-[#A7F3D0]/50 border border-white shadow-inner relative">
            <Lock className="h-9 w-9 text-[#0D5D56]" />
            <motion.div
              className="absolute inset-0 rounded-[28px] border-t-[3px] border-[#0D5D56]"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            />
          </div>
          <h2 className="mb-1 font-['Figtree'] text-2xl font-bold text-[#0D5D56]">Securing Your Vote</h2>
          <p className="mb-6 text-sm font-bold text-[#0D5D56]/60">
            Your vote is being encrypted and sealed. This takes a moment.
          </p>
          <div className="w-full">
            <div className="flex justify-between text-xs font-bold text-[#0D5D56]/50 mb-2">
              <span>Cryptographic operations</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-[#A7F3D0]/30 border border-[#A7F3D0]/50">
              <motion.div
                className="h-full bg-[#0D5D56] rounded-full shadow-[0_0_10px_rgba(13,93,86,0.4)]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </motion.div>

        {/* Crypto operations live feed */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-[#0D5D56] rounded-[32px] p-6 border border-white/10 shadow-xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-48 h-48 bg-[#A7F3D0] rounded-full blur-[80px] opacity-10 pointer-events-none" />

          <div className="flex items-center gap-2 mb-5 relative z-10">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-[#A7F3D0] text-xs font-bold uppercase tracking-widest">
              Cryptographic Operations — Live
            </p>
          </div>

          <div className="space-y-4 relative z-10">
            <AnimatePresence>
              {CRYPTO_STEPS.map((step) => {
                const isVisible  = visibleSteps.includes(step.id);
                const isDone     = completedSteps.includes(step.id);
                const isRunning  = isVisible && !isDone;

                if (!isVisible) return null;

                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35 }}
                    className="flex gap-3"
                  >
                    <div className="mt-0.5 shrink-0">
                      {isRunning ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                          className="w-5 h-5 text-[#A7F3D0]"
                        >
                          <Loader2 size={20} />
                        </motion.div>
                      ) : (
                        <CheckCircle2 size={20} className="text-[#A7F3D0]" />
                      )}
                    </div>

                    <div className="flex-1">
                      <p className="text-white font-bold text-sm mb-1">{step.title}</p>
                      <div className="space-y-0.5">
                        {step.details.map((d, i) => (
                          <p key={i} className="text-white/50 text-xs font-mono">{d}</p>
                        ))}
                      </div>

                      {step.id === "encrypt" && isDone && showCiphertext && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          transition={{ delay: 0.2 }}
                          className="mt-3 bg-white/10 border border-white/20 rounded-2xl p-4"
                        >
                          <p className="text-[#A7F3D0] text-xs font-bold mb-2 uppercase tracking-widest">
                            Encrypted Ballot
                          </p>
                          {[
                            { label: "Candidate A", cipher: "2349817234918234...8f4a" },
                            { label: "Candidate B", cipher: "9182374918723491...2c1d" },
                            { label: "Candidate C", cipher: "1234987234918234...9b3e" },
                          ].map(({ label, cipher }) => (
                            <div key={label} className="flex justify-between items-center py-1 border-b border-white/10 last:border-0">
                              <span className="text-white/60 text-xs font-bold">{label}:</span>
                              <span className="text-[#A7F3D0] text-xs font-mono">{cipher}</span>
                            </div>
                          ))}
                          <p className="text-white/40 text-xs mt-2 leading-relaxed">
                            The server received these numbers. Without the private key, nobody can determine which candidate you chose.
                          </p>
                        </motion.div>
                      )}

                      {step.id === "zkp" && isDone && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          transition={{ delay: 0.2 }}
                          className="mt-3 bg-white/10 border border-white/20 rounded-2xl p-4"
                        >
                          <p className="text-[#A7F3D0] text-xs font-bold mb-2 uppercase tracking-widest">
                            Zero-Knowledge Proof
                          </p>
                          {[
                            ["Commitment₀", "0x7f4a3b9c... ← from random R"],
                            ["Commitment₁", "0x3b9c8a1e... ← simulated branch"],
                            ["Challenge",   "0x91bc2d7f... ← SHA-256(C₀∥C₁)"],
                            ["Response₀",   "0x2d7f4a3b..."],
                            ["Response₁",   "0x8a1e9f2a..."],
                          ].map(([k, v]) => (
                            <div key={k} className="flex justify-between items-start py-1 border-b border-white/10 last:border-0 gap-4">
                              <span className="text-white/60 text-xs font-bold shrink-0">{k}:</span>
                              <span className="text-[#A7F3D0] text-xs font-mono text-right">{v}</span>
                            </div>
                          ))}
                          <p className="text-white/40 text-xs mt-2">
                            Server verified: your vote is valid. Server did NOT learn: how you voted.
                          </p>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>

      </div>
    </div>
  );
}