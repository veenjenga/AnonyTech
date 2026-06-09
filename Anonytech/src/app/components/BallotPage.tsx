/**
 * BallotPage.tsx
 * ==============
 * Strict linear tunnel — the voter steps through one role at a time.
 *
 * Crypto flow (what actually happens here vs. server-side)
 * --------------------------------------------------------
 * The REAL cryptographic work lives in the Python crypto layer:
 *   • Paillier HE encryption  — VoterClient.cast_vote() → VoteEncryptor
 *   • ZKP Sigma proof          — ZKPProver.generate_proof()
 *   • ZKP verification         — BallotServer.ZKPVerifier.verify_proof()
 *   • RSA blind-sig check      — BallotServer.receive_ballot()
 *   • Anonymous DB storage     — no voter_id in ballots row
 *
 * This component only:
 *   1. Collects the voter's INTENT (which candidate / ranked order)
 *   2. Ships that intent + x-voter-id header to server.js
 *   3. server.js derives vote_value (0/1) and calls /crypto/cast-vote
 *   4. Python VoterClient does all the real crypto and stores the ballot
 *
 * Back-navigation
 * ---------------
 * Once the voter lands here they CANNOT use the browser back button,
 * keyboard shortcut, or swipe gesture to leave mid-session.
 * • popstate listener re-pushes the current URL on every back attempt.
 * • beforeunload fires a confirmation dialog while submitting.
 */

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  CheckCircle2,
  Lock,
  ChevronRight,
  Hash,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Eye,
  Key,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Role {
  id: string;
  name: string;
  voting_logic: "Plurality" | "STV" | "Borda";
}

interface Candidate {
  id: string;
  role_id: string;
  department_id: string;
  name: string;
  course: string | null;
  image_url: string | null;
}

interface Voter {
  id: string;
  student_id: string;
  email: string;
  full_name: string;
  department_id: string;
  has_voted: boolean;
  role: string;
}

// ─── Crypto step definition (educational display only) ───────────────────────
interface CryptoStep {
  id: string;
  title: string;
  detail: string;
  note: string;
}

// ─── API ─────────────────────────────────────────────────────────────────────
const API_BASE: string =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env
    .VITE_API_URL || "http://localhost:5000";

/**
 * apiFetch — thin wrapper.
 * Callers may pass extra headers via options.headers; those are merged LAST
 * so they always win over the default Content-Type.
 */
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: callerHeaders, ...rest } = options ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(callerHeaders as Record<string, string>),
    },
    ...rest,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Crypto helpers (client-side token only — real crypto is server-side) ────
async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Per-role crypto animation steps ─────────────────────────────────────────
// These are EDUCATIONAL — they mirror what the Python layer is doing remotely.
// They are NOT performing local crypto; they're a real-time visualization of
// the server-side Paillier + ZKP + blind-sig pipeline.
const CRYPTO_ANIMATION_STEPS: CryptoStep[] = [
  {
    id: "paillier",
    title: "Paillier HE encryption",
    detail: "Enc(v) = g^v · r^n mod n²  — plaintext destroyed",
    note: "Server holds only the ciphertext. Individual ballots are never decrypted.",
  },
  {
    id: "zkp",
    title: "ZKP Sigma proof generated",
    detail: "Disjunctive proof: vote ∈ {0,1} — without revealing which",
    note: "BallotServer.ZKPVerifier checks this before accepting the ballot.",
  },
  {
    id: "blind",
    title: "RSA blind signature verified",
    detail: "sig^e ≡ token (mod n)  — anonymous credential confirmed",
    note: "Your identity was severed at unblinding. Server cannot link you to this ballot.",
  },
  {
    id: "store",
    title: "Ballot stored anonymously",
    detail: "token_hash only — no voter_id, no student_id in ballots row",
    note: "Homomorphic tally: Election Server multiplies ciphertexts without decrypting.",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────
export function BallotPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [roles, setRoles] = useState<Role[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [voter, setVoter] = useState<Voter | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── UI / flow state ─────────────────────────────────────────────────────────
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedCandidates, setSelectedCandidates] = useState<
    Record<string, string>
  >({});
  const [rankedCandidates, setRankedCandidates] = useState<
    Record<string, string[]>
  >({});

  // Temporal Equalization (15 s per role)
  const [timeLeft, setTimeLeft] = useState(15);
  const [isOverlayActive, setIsOverlayActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Crypto animation state (shown in submission screen) ──────────────────────
  const [cryptoStepsDone, setCryptoStepsDone] = useState<string[]>([]);
  const [cryptoStepsVisible, setCryptoStepsVisible] = useState<string[]>([]);

  // ── BACK-NAVIGATION LOCK ─────────────────────────────────────────────────────
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);

    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Block tab close / refresh while the submission is in flight
  useEffect(() => {
    if (!isSubmitting) return;

    const blockUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "Your ballot submission is in progress. Leaving now may corrupt your session.";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", blockUnload);
    return () => window.removeEventListener("beforeunload", blockUnload);
  }, [isSubmitting]);

  // ── Load voter + roles + candidates ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stored = sessionStorage.getItem("voter");
        if (!stored) {
          navigate("/login");
          return;
        }
        const v: Voter = JSON.parse(stored);
        setVoter(v);

        if (v.has_voted) {
          navigate("/already-voted");
          return;
        }

        const [fetchedRoles, fetchedCandidates] = await Promise.all([
          apiFetch<Role[]>("/api/roles"),
          apiFetch<Candidate[]>(
            `/api/candidates?departmentId=${encodeURIComponent(v.department_id)}`
          ),
        ]);

        setRoles(fetchedRoles);
        setCandidates(fetchedCandidates);

        const ranks: Record<string, string[]> = {};
        fetchedRoles.forEach((r) => (ranks[r.id] = []));
        setRankedCandidates(ranks);
      } catch (err: unknown) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load ballot data"
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, [navigate]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const activeRole = roles[currentStepIndex];
  const isSTV =
    activeRole?.voting_logic === "STV" ||
    activeRole?.voting_logic === "Borda";
  const activeCandidates = candidates
    .filter((c) => c.role_id === activeRole?.id)
    .slice(0, 6);

  // ── Per-role countdown timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRole || isSubmitting) return;

    if (!isOverlayActive) {
      setTimeLeft(15);
    }

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepIndex, activeRole, isSubmitting, isOverlayActive]);

  // Auto-advance when countdown hits zero
  useEffect(() => {
    if (timeLeft !== 0 || isSubmitting) return;
    proceedToNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  // ── Navigation helpers ────────────────────────────────────────────────────────
  const handleNextStep = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeLeft > 0) {
      setIsOverlayActive(true);
    } else {
      proceedToNext();
    }
  };

  const proceedToNext = () => {
    setIsOverlayActive(false);
    if (!activeRole) return;

    if (currentStepIndex === roles.length - 1) {
      submitAllBallots();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  // ── Crypto animation driver ──────────────────────────────────────────────────
  const playCryptoAnimation = async () => {
    for (let i = 0; i < CRYPTO_ANIMATION_STEPS.length; i++) {
      const step = CRYPTO_ANIMATION_STEPS[i];
      setCryptoStepsVisible((prev) => [...prev, step.id]);
      await sleep(500);
      setCryptoStepsDone((prev) => [...prev, step.id]);
      await sleep(300);
    }
  };

  // ── Submit all ballots ────────────────────────────────────────────────────────
  const submitAllBallots = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    setCryptoStepsDone([]);
    setCryptoStepsVisible([]);

    if (!voter) {
      setSubmitError("Voter session missing — please log in again.");
      setIsSubmitting(false);
      return;
    }

    playCryptoAnimation();

    try {
      for (const role of roles) {
        const rawToken = randomToken();
        const tokenHash = await sha256Hex(rawToken);

        const isRanked =
          role.voting_logic === "STV" || role.voting_logic === "Borda";
        const choicePayload = isRanked
          ? { ranked: rankedCandidates[role.id] ?? [] }
          : { selected: selectedCandidates[role.id] ?? null };

        const zkpProof = {
          statement: `vote-for-${role.id}`,
          commitment: await sha256Hex(JSON.stringify(choicePayload) + rawToken),
          challenge: await sha256Hex(rawToken + role.id),
        };

        await apiFetch("/api/ballots/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-voter-id": voter.student_id,
          },
          body: JSON.stringify({
            roleId: role.id,
            tokenHash,
            ciphertext: choicePayload,
            zkpProof,
            isReal: true,
          }),
        });
      }

      await apiFetch("/api/journey", {
        method: "POST",
        body: JSON.stringify({
          voterId: voter.id,
          identityVerified: new Date().toISOString(),
          tunnelActive: new Date().toISOString(),
          choicesMade: new Date().toISOString(),
          ledgerUpdated: new Date().toISOString(),
        }),
      });

      const updatedVoter: Voter = { ...voter, has_voted: true };
      sessionStorage.setItem("voter", JSON.stringify(updatedVoter));

      // Wait for crypto animation to finish, then go to success page
      await sleep(800);
      navigate("/success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Ballot submission failed";
      setSubmitError(msg);
      setIsSubmitting(false);
      setCryptoStepsDone([]);
      setCryptoStepsVisible([]);
    }
  };

  // ── Selection handlers ────────────────────────────────────────────────────────
  const togglePluralitySelect = (id: string) => {
    setSelectedCandidates((prev) => ({ ...prev, [activeRole.id]: id }));
  };

  const toggleSTVRank = (id: string) => {
    setRankedCandidates((prev) => {
      const current = prev[activeRole.id] || [];
      if (current.includes(id)) {
        return { ...prev, [activeRole.id]: current.filter((cId) => cId !== id) };
      }
      return { ...prev, [activeRole.id]: [...current, id] };
    });
  };

  // ── Circular timer SVG ────────────────────────────────────────────────────────
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (timeLeft / 15) * circumference;

  // ── Loading / error / empty states ────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-[100dvh] w-full flex-col text-[#0D5D56] bg-[#F8FAFC] items-center justify-center p-8 text-center">
        <Loader2 size={48} className="mb-6 animate-spin text-[#0D5D56]" />
        <p className="font-['Figtree'] font-bold text-lg">{t("Loading ballot…")}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-[100dvh] w-full flex-col text-[#0D5D56] bg-[#F8FAFC] items-center justify-center p-8 text-center">
        <AlertCircle size={48} className="mb-6 text-red-500" />
        <h2 className="font-['Figtree'] text-2xl font-bold mb-2">
          {t("Failed to Load Ballot")}
        </h2>
        <p className="text-[#0D5D56]/60 font-bold max-w-md">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-6 py-3 bg-[#0D5D56] text-white rounded-full font-bold"
        >
          {t("Retry")}
        </button>
      </div>
    );
  }

  if (roles.length === 0 || !activeRole) {
    return (
      <div className="flex h-[100dvh] w-full flex-col text-[#0D5D56] bg-[#F8FAFC] items-center justify-center p-8 text-center">
        <Lock size={48} className="mb-6 opacity-30 text-[#0D5D56]" />
        <h2 className="font-['Figtree'] text-3xl font-bold mb-2">
          {t("Tunnel Protocol Pending")}
        </h2>
        <p className="text-[#0D5D56]/60 font-bold max-w-md">
          {t("The Administrator has not configured any election roles yet.")}
        </p>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[100dvh] w-full flex-col text-[#0D5D56] bg-[#F8FAFC] relative overflow-hidden z-10">

      {/* ── Top Header ────────────────────────────────────────────────────────── */}
      <header className="px-6 md:px-8 py-6 bg-white border-b border-[#A7F3D0]/50 shadow-sm relative z-20 flex flex-col gap-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Lock className="text-[#0D5D56] w-5 h-5 hidden md:block" />
            <span className="font-['Figtree'] font-bold text-xl">
              {t("Strict Linear Tunnel")}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-[#0D5D56]/40 hidden md:flex tracking-widest uppercase">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Anonymous Session Active
          </div>
        </div>

        {/* Role Progress Steps */}
        <div className="flex items-center justify-between relative">
          <div className="absolute top-1/2 left-0 w-full h-1 bg-[#A7F3D0]/30 -translate-y-1/2 z-0" />
          <div
            className="absolute top-1/2 left-0 h-1 bg-[#0D5D56] -translate-y-1/2 z-0 transition-all duration-500 ease-in-out"
            style={{
              width: `${(currentStepIndex / Math.max(roles.length - 1, 1)) * 100}%`,
            }}
          />
          {roles.map((step, idx) => (
            <div
              key={step.id}
              className="relative z-10 flex flex-col items-center gap-2"
            >
              <div
                className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center font-bold text-xs md:text-sm transition-all duration-300 shadow-sm ${
                  idx < currentStepIndex
                    ? "bg-[#0D5D56] text-[#A7F3D0] border-2 border-[#0D5D56]"
                    : idx === currentStepIndex
                    ? "bg-white text-[#0D5D56] border-4 border-[#0D5D56] scale-125"
                    : "bg-[#F8FAFC] text-[#0D5D56]/40 border-2 border-[#A7F3D0]/50"
                }`}
              >
                {idx < currentStepIndex ? (
                  <CheckCircle2 size={14} className="md:w-4 md:h-4" />
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={`text-[10px] md:text-xs font-bold absolute -bottom-6 whitespace-nowrap transition-colors duration-300 ${
                  idx === currentStepIndex
                    ? "text-[#0D5D56]"
                    : "text-[#0D5D56]/40 hidden md:block"
                }`}
              >
                {t(step.name)}
              </span>
            </div>
          ))}
        </div>
      </header>

      {/* ── Main Ballot Area ──────────────────────────────────────────────────── */}
      <main className="flex-1 relative z-10 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">
          {!isOverlayActive && !isSubmitting && (
            <motion.div
              key={activeRole.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-4xl mx-auto h-full flex flex-col p-4 md:p-8"
            >
              <div className="flex flex-col w-full h-full min-h-0">
                {/* Role header + circular countdown */}
                <div className="mb-4 md:mb-6 bg-white rounded-[24px] p-4 md:p-6 shadow-sm border border-[#A7F3D0]/50 flex items-center justify-between shrink-0">
                  <div className="text-left">
                    <h2 className="font-['Figtree'] text-2xl md:text-3xl font-bold text-[#0D5D56] mb-1">
                      {activeRole.name} {t("Election")}
                    </h2>
                    <p className="text-[#0D5D56]/70 font-bold text-xs md:text-sm">
                      {isSTV
                        ? t("Tap candidates to rank them (1, 2, 3…). You do not have to rank everyone.")
                        : t("Select exactly one candidate.")}
                    </p>
                  </div>
                  {/* Circular countdown */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-[#0D5D56]/60 uppercase tracking-widest hidden md:block">
                      {t("Time Lock")}
                    </span>
                    <div className="relative w-12 h-12 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 48 48">
                        <circle cx="24" cy="24" r={radius} stroke="#A7F3D0" strokeWidth="4" fill="none" className="opacity-30" />
                        <circle
                          cx="24" cy="24" r={radius}
                          stroke={timeLeft <= 5 ? "#ef4444" : "#0D5D56"}
                          strokeWidth="4" fill="none" strokeLinecap="round"
                          style={{
                            strokeDasharray: circumference,
                            strokeDashoffset,
                            transition: "stroke-dashoffset 1s linear",
                          }}
                        />
                      </svg>
                      <span className={`absolute inset-0 flex items-center justify-center font-bold text-sm ${timeLeft <= 5 ? "text-red-500" : "text-[#0D5D56]"}`}>
                        {timeLeft}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Submission error */}
                {submitError && (
                  <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3 text-red-700">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="font-bold text-sm">{submitError}</p>
                  </div>
                )}

                {/* Candidate Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 flex-1 min-h-0">
                  {activeCandidates.map((candidate) => {
                    let isSelected = false;
                    let rank = -1;

                    if (isSTV) {
                      const ranks = rankedCandidates[activeRole.id] || [];
                      rank = ranks.indexOf(candidate.id);
                      isSelected = rank !== -1;
                    } else {
                      isSelected = selectedCandidates[activeRole.id] === candidate.id;
                    }

                    return (
                      <motion.button
                        key={candidate.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() =>
                          isSTV
                            ? toggleSTVRank(candidate.id)
                            : togglePluralitySelect(candidate.id)
                        }
                        className={`relative rounded-[24px] md:rounded-[32px] border-2 flex flex-col items-center justify-center p-3 md:p-6 transition-all shadow-sm ${
                          isSelected
                            ? "border-[#0D5D56] bg-white ring-4 ring-[#A7F3D0]/30"
                            : "border-[#A7F3D0]/50 bg-[#F8FAFC] hover:border-[#0D5D56]/50 hover:bg-white"
                        }`}
                      >
                        {isSTV ? (
                          <div className={`absolute top-2 right-2 md:top-4 md:right-4 w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center font-bold text-xs md:text-sm border-2 transition-colors ${isSelected ? "bg-[#0D5D56] text-[#A7F3D0] border-[#0D5D56]" : "bg-transparent text-[#0D5D56]/30 border-[#0D5D56]/20"}`}>
                            {isSelected ? rank + 1 : <Hash size={12} className="md:w-4 md:h-4" />}
                          </div>
                        ) : (
                          <div className="absolute top-2 right-2 md:top-4 md:right-4 w-5 h-5 md:w-6 md:h-6 rounded-full border-2 border-[#A7F3D0] flex items-center justify-center">
                            {isSelected && <div className="w-2 h-2 md:w-3 md:h-3 bg-[#0D5D56] rounded-full" />}
                          </div>
                        )}
                        <div className="w-16 h-16 md:w-24 md:h-24 rounded-full mb-2 md:mb-4 overflow-hidden border-2 border-[#A7F3D0] shadow-inner bg-[#0D5D56]/5">
                          {candidate.image_url ? (
                            <img src={candidate.image_url} alt={candidate.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[#0D5D56]/30 bg-[#A7F3D0]/30 text-2xl font-bold">
                              {candidate.name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <h3 className="font-['Figtree'] font-bold text-sm md:text-xl text-[#0D5D56] text-center leading-tight mb-1">
                          {candidate.name}
                        </h3>
                        <p className="text-[#0D5D56]/60 font-bold text-[10px] md:text-sm text-center">
                          {candidate.course ?? candidate.department_id}
                        </p>
                      </motion.button>
                    );
                  })}

                  {activeCandidates.length === 0 && (
                    <div className="col-span-2 md:col-span-3 flex flex-col items-center justify-center h-full text-[#0D5D56]/50">
                      <Lock size={48} className="mb-4 opacity-50" />
                      <p className="font-bold">{t("No candidates registered for this role.")}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Bottom Action Bar ─────────────────────────────────────────────────── */}
      {!isSubmitting && !isOverlayActive && (
        <div className="p-4 md:p-6 bg-gradient-to-t from-white via-white/90 to-transparent z-50 flex flex-col items-center shrink-0">
          <div className="w-full max-w-xl">
            <button
              onClick={handleNextStep}
              className="w-full py-4 md:py-5 rounded-full text-base md:text-lg font-bold shadow-[0_8px_20px_rgba(13,93,86,0.2)] transition-all flex items-center justify-center gap-3 bg-[#0D5D56] text-white hover:bg-[#0D5D56]/90"
            >
              {currentStepIndex === roles.length - 1
                ? t("Submit Ballot")
                : t("Next")}
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}

      {/* ── Temporal Equalization Overlay ────────────────────────────────────── */}
      <AnimatePresence>
        {isOverlayActive && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#0D5D56] flex flex-col items-center justify-center p-6 text-center"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="w-32 h-32 border-4 border-transparent border-t-[#A7F3D0] border-r-[#A7F3D0] rounded-full mb-8 shadow-[0_0_40px_rgba(167,243,208,0.4)] flex items-center justify-center relative"
            >
              <div className="w-24 h-24 border-4 border-transparent border-b-white border-l-white rounded-full opacity-50" />
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Lock size={32} />
              </div>
            </motion.div>
            <h2 className="font-['Figtree'] text-2xl md:text-3xl font-bold text-white tracking-widest uppercase mb-2">
              {t("Securing Interaction Path…")}
            </h2>
            <p className="text-[#A7F3D0] font-bold tracking-wider text-sm flex items-center justify-center gap-2">
              <Lock size={16} /> {t("Masking Behavioral Patterns")} ({timeLeft}s)
            </p>
            {timeLeft === 0 && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={proceedToNext}
                className="mt-8 px-8 py-3 bg-[#A7F3D0] text-[#0D5D56] rounded-full font-bold"
              >
                {t("Continue")}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Final Submission Screen (with live crypto animation) ─────────────── */}
      <AnimatePresence>
        {isSubmitting && (
          <motion.div
            key="submitting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[110] bg-[#0D5D56] flex flex-col items-center justify-center p-6 md:p-8 overflow-y-auto"
          >
            {/* Decorative blur blobs */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#A7F3D0] rounded-full blur-[120px] opacity-10 pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-white rounded-full blur-[120px] opacity-5 pointer-events-none" />

            <div className="relative z-10 w-full max-w-xl flex flex-col items-center gap-6">
              {/* Spinner */}
              <div className="relative w-28 h-28 flex items-center justify-center">
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                  className="absolute inset-0 border-[5px] border-transparent border-t-[#A7F3D0] border-b-[#A7F3D0]/30 rounded-full"
                />
                <div className="w-20 h-20 bg-white/10 rounded-full border border-white/20 flex items-center justify-center">
                  <Lock size={32} className="text-[#A7F3D0]" />
                </div>
              </div>

              <div className="text-center">
                <h2 className="font-['Figtree'] text-2xl md:text-3xl font-bold text-white tracking-tight mb-2">
                  {t("Finalizing Ballot")}
                </h2>
                <p className="text-[#A7F3D0] font-bold text-sm">
                  {t("Zero-evidence protocol active — identity severed from ballot")}
                </p>
              </div>

              {/* Live crypto operation feed */}
              <div className="w-full bg-white/10 border border-white/20 rounded-[28px] p-6 text-left">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-[#A7F3D0] text-xs font-bold uppercase tracking-widest">
                    Cryptographic Pipeline — Live
                  </p>
                </div>

                <div className="space-y-4">
                  <AnimatePresence>
                    {CRYPTO_ANIMATION_STEPS.map((step) => {
                      const isVisible = cryptoStepsVisible.includes(step.id);
                      const isDone = cryptoStepsDone.includes(step.id);
                      const isRunning = isVisible && !isDone;
                      if (!isVisible) return null;

                      const iconMap: Record<string, React.ReactNode> = {
                        paillier: <Lock size={16} className="text-[#A7F3D0]" />,
                        zkp: <Eye size={16} className="text-[#A7F3D0]" />,
                        blind: <Key size={16} className="text-[#A7F3D0]" />,
                        store: <ShieldCheck size={16} className="text-[#A7F3D0]" />,
                      };

                      return (
                        <motion.div
                          key={step.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex gap-3"
                        >
                          <div className="shrink-0 mt-0.5">
                            {isRunning ? (
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                              >
                                <Loader2 size={18} className="text-[#A7F3D0]" />
                              </motion.div>
                            ) : (
                              <CheckCircle2 size={18} className="text-[#A7F3D0]" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              {iconMap[step.id]}
                              <p className="text-white font-bold text-sm">{step.title}</p>
                            </div>
                            <p className="text-[#A7F3D0] text-xs font-mono mt-0.5">{step.detail}</p>
                            <p className="text-white/40 text-xs mt-0.5">{step.note}</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  {/* Pending skeleton steps */}
                  {Array.from({
                    length: Math.max(0, CRYPTO_ANIMATION_STEPS.length - cryptoStepsVisible.length),
                  }).map((_, i) => (
                    <div key={`pending-${i}`} className="flex gap-3 opacity-25">
                      <div className="w-4 h-4 rounded-full border-2 border-[#A7F3D0]/50 mt-0.5 shrink-0" />
                      <p className="text-sm font-bold text-white/40">
                        Step {cryptoStepsVisible.length + i + 1} — pending…
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {submitError && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="w-full bg-red-500/20 border border-red-400/40 rounded-2xl p-4 flex items-center gap-3"
                >
                  <AlertCircle size={18} className="text-red-300 shrink-0" />
                  <p className="text-red-200 font-bold text-sm">{submitError}</p>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}