import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  Calendar, MessageSquare, Heart, CheckCircle2,
  LifeBuoy, Settings, ShieldAlert, LogOut, Shield, Star, Clock,
  Info, MessageCircle, Bell, User, CheckSquare, Search,
  ChevronDown, Edit2, Key, Moon, Activity, BarChart3,
  BookOpen, Users, HelpCircle, HeadphonesIcon,
  Computer, Trophy, ArrowRight, Loader2, AlertCircle, Sun,
} from "lucide-react";

import { useTranslation } from "react-i18next";
import { Notification, NotificationType } from "./Notification";
import { WinnersState } from "./WinnersState";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Voter {
  id: string;
  student_id: string;
  email: string;
  full_name: string;
  department_id: string;
  department_name: string | null;
  has_voted: boolean;
  role: string;
}

interface ElectionConfig {
  id: string;
  voting_method: string;
  is_sealed: boolean;
  is_tally_released: boolean;
  start_date: string | null;
  end_date: string | null;
}

interface VoterJourney {
  voter_id: string;
  identity_verified: string | null;
  tunnel_active: string | null;
  choices_made: string | null;
  ledger_updated: string | null;
}

// ─── API base ─────────────────────────────────────────────────────────────────
const API_BASE: string =
  (import.meta as ImportMeta & {
    env: { VITE_API_URL?: string };
  }).env.VITE_API_URL || "http://localhost:5000";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(isoString: string | null): string {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEndDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("en-KE", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function calcCountdown(endStr: string | null) {
  if (!endStr) return null;
  const diff = new Date(endStr).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1_000),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export function PostVoteDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const language = i18n.language === "sw" ? "KS" : "EN";

  // ── Session ───────────────────────────────────────────────────────────────
  const [voter, setVoter] = useState<Voter | null>(null);

  // ── Remote data ───────────────────────────────────────────────────────────
  const [config, setConfig] = useState<ElectionConfig | null>(null);
  const [journey, setJourney] = useState<VoterJourney | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [currentTab, setCurrentTab] = useState("Dashboard");
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isSecurityPinOpen, setIsSecurityPinOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [bellNotif, setBellNotif] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  // ── Support ticket ────────────────────────────────────────────────────────
  const [ticketSubmitted, setTicketSubmitted] = useState(false);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketName, setTicketName] = useState("");
  const [ticketEmail, setTicketEmail] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketError, setTicketError] = useState<string | null>(null);

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);

  // ── Edit profile ──────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // ── Password change ───────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);

  // ── Live chat (UI-only; no backend integration needed) ────────────────────
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<
    { from: "user" | "agent"; text: string }[]
  >([
    {
      from: "agent",
      text: "Hi! I'm the AnonyTech support agent. How can I help you today?",
    },
  ]);

  // ── Countdown ─────────────────────────────────────────────────────────────
  const [timeRemaining, setTimeRemaining] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  // ── Notification ──────────────────────────────────────────────────────────
  const [notification, setNotification] = useState<{
    type: NotificationType;
    message: string;
  } | null>(location.state?.notification || null);

  // ── Polling ref (to clear on unmount) ────────────────────────────────────
 const tallyPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial data load ─────────────────────────────────────────────────────
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
        setDisplayName(v.full_name ?? "");
        setTicketEmail(v.email ?? "");

        const [cfgResult, journeyResult] = await Promise.allSettled([
          apiFetch<ElectionConfig>("/api/config"),
          apiFetch<VoterJourney>(`/api/journey/${v.id}`),
        ]);

        if (cfgResult.status === "fulfilled") setConfig(cfgResult.value);
        if (journeyResult.status === "fulfilled") setJourney(journeyResult.value);
      } catch (err: unknown) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load dashboard"
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, [navigate]);

  // ── Countdown ticker ──────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setTimeRemaining(calcCountdown(config?.end_date ?? null));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [config?.end_date]);

  // ── Poll for tally release every 5 s ────────────────────────────────────
  useEffect(() => {
    if (config?.is_tally_released) return; // already released, no need to poll

    tallyPollRef.current = setInterval(async () => {
      try {
        const latest = await apiFetch<ElectionConfig>("/api/config");
        if (latest.is_tally_released && !config?.is_tally_released) {
          setConfig(latest);
          setBellNotif(true);
          setNotification({
            type: "success",
            message:
              "Official Election Tally has just been released! Check your Elections tab.",
          });
        }
      } catch {
        // silent — don't disrupt UX on poll failure
      }
    }, 5_000);

    return () => {
      if (tallyPollRef.current) clearInterval(tallyPollRef.current);
    };
  }, [config?.is_tally_released]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleLogout = () => {
    sessionStorage.clear();
    navigate("/");
  };

  const handleTicketSubmit = async () => {
    if (!ticketMessage.trim()) return;
    setTicketSubmitting(true);
    setTicketError(null);
    try {
      await apiFetch("/api/support", {
        method: "POST",
        body: JSON.stringify({
          voterId: voter?.id ?? null,
          email: ticketEmail || null,
          fullName: ticketName || null,
          message: ticketMessage,
        }),
      });
      setTicketSubmitted(true);
    } catch (err: unknown) {
      setTicketError(
        err instanceof Error ? err.message : "Failed to submit ticket"
      );
    } finally {
      setTicketSubmitting(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!rating) return;
    setFeedbackSubmitting(true);
    try {
      await apiFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          voterId: voter?.id ?? null,
          rating,
          comment: feedbackText || null,
        }),
      });
      setFeedbackDone(true);
      setTimeout(() => setIsFeedbackOpen(false), 1_500);
    } catch {
      // keep modal open, let user retry
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handlePasswordUpdate = async () => {
    setPasswordError(null);
    if (!newPassword || newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    if (!voter) return;
    setPasswordSaving(true);
    try {
      await apiFetch(`/api/voters/${voter.id}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password: newPassword }),
      });
      setPasswordDone(true);
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setPasswordDone(false);
        setIsSecurityPinOpen(false);
      }, 1_500);
    } catch (err: unknown) {
      setPasswordError(
        err instanceof Error ? err.message : "Password update failed"
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  // Edit profile is display-name only — stored locally in sessionStorage
  // since the server doesn't expose a name-update endpoint beyond password.
  const handleProfileSave = () => {
    if (!voter) return;
    setProfileSaving(true);
    const updated = { ...voter, full_name: displayName };
    sessionStorage.setItem("voter", JSON.stringify(updated));
    setVoter(updated);
    setTimeout(() => {
      setProfileSaving(false);
      setIsEditProfileOpen(false);
    }, 600);
  };

  const isTallyReleased = config?.is_tally_released ?? false;
  const endDateLabel = formatEndDate(config?.end_date ?? null);

  // ── Loading / error ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F8FAFC]">
        <Loader2 size={40} className="animate-spin text-[#0D5D56]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center">
        <AlertCircle size={48} className="mb-4 text-red-500" />
        <p className="font-bold text-[#0D5D56] mb-2">Failed to load dashboard</p>
        <p className="text-sm text-[#0D5D56]/70 mb-6">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-[#0D5D56] text-white rounded-full font-bold"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full overflow-hidden text-[#0D5D56] bg-[#F8FAFC]">
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      {/* ── Top Navigation Bar ──────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-[#A7F3D0]/50 bg-white/60 backdrop-blur-md relative z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#A7F3D0] text-[#0D5D56] shadow-sm border border-white">
            <Shield className="w-5 h-5 text-[#0D5D56]" />
          </div>
          <span className="font-['Figtree'] font-bold text-2xl tracking-tight text-[#0D5D56]">
            {t("AnonyTech")}
          </span>
        </div>

        <nav className="flex items-center bg-[#0D5D56] rounded-full p-1.5 shadow-sm">
          <NavItem label={t("Dashboard")} active={currentTab === "Dashboard"} onClick={() => setCurrentTab("Dashboard")} />
          <NavItem label={t("Elections")} active={currentTab === "Elections"} onClick={() => setCurrentTab("Elections")} />
          <NavItem label={t("Voter Care")} active={currentTab === "Voter Care"} onClick={() => setCurrentTab("Voter Care")} />
        </nav>

        <div className="flex items-center gap-4">
          {/* Language toggle */}
          <div className="flex items-center bg-white border border-[#A7F3D0] rounded-full p-1 shadow-sm mr-2">
            <button
              onClick={() => i18n.changeLanguage("en")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${language === "EN" ? "bg-[#0D5D56] text-[#A7F3D0]" : "text-[#0D5D56] hover:bg-[#A7F3D0]/20"}`}
            >
              EN
            </button>
            <button
              onClick={() => i18n.changeLanguage("sw")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${language === "KS" ? "bg-[#0D5D56] text-[#A7F3D0]" : "text-[#0D5D56] hover:bg-[#A7F3D0]/20"}`}
            >
              KS
            </button>
          </div>

          {/* Bell */}
          <button
            onClick={() => setBellNotif(false)}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-[#0D5D56] hover:bg-[#A7F3D0] transition-all shadow-sm relative"
          >
            <Bell size={18} />
            {bellNotif && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white" />
            )}
          </button>

          {/* Profile dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="flex items-center gap-2 p-1 pr-3 rounded-full bg-[#A7F3D0] text-[#0D5D56] shadow-sm border border-white transition-all hover:bg-[#A7F3D0]/80"
            >
              <div className="w-8 h-8 flex items-center justify-center rounded-full bg-white text-[#0D5D56] overflow-hidden shadow-sm">
                <User size={18} />
              </div>
              <ChevronDown size={16} />
            </button>

            <AnimatePresence>
              {isProfileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-3 w-64 bg-white/90 backdrop-blur-xl border border-[#A7F3D0] rounded-[24px] shadow-[0_16px_40px_rgba(13,93,86,0.15)] overflow-hidden z-50"
                >
                  {/* Voter identity */}
                  {voter && (
                    <div className="px-4 pt-4 pb-2">
                      <p className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest">
                        Signed in as
                      </p>
                      <p className="font-bold text-[#0D5D56] text-sm">{voter.full_name}</p>
                      <p className="text-xs text-[#0D5D56]/60 font-bold">{voter.student_id}</p>
                    </div>
                  )}
                  <div className="h-px w-full bg-[#A7F3D0]/50 mx-0 my-1" />
                  <div className="p-2 flex flex-col gap-1">
                    <button
                      onClick={() => { setIsEditProfileOpen(true); setIsProfileMenuOpen(false); }}
                      className="w-full text-left flex items-center gap-3 p-[8px] rounded-2xl hover:bg-[#F8FAFC] transition-colors text-[#111111] font-medium text-sm"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#A7F3D0]/30 flex items-center justify-center text-[#0D5D56]">
                        <Edit2 size={16} />
                      </div>
                      Edit Profile
                    </button>
                    <button
                      onClick={() => { setIsSecurityPinOpen(true); setIsProfileMenuOpen(false); }}
                      className="w-full text-left flex items-center gap-3 p-[8px] rounded-2xl hover:bg-[#F8FAFC] transition-colors text-[#111111] font-medium text-sm"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#A7F3D0]/30 flex items-center justify-center text-[#0D5D56]">
                        <Key size={16} />
                      </div>
                      Change Password
                    </button>
                    <button
                      onClick={() => { setIsDark(!isDark); setIsProfileMenuOpen(false); }}
                      className="w-full text-left flex items-center gap-3 p-[8px] rounded-2xl hover:bg-[#F8FAFC] transition-colors text-[#111111] font-medium text-sm"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#A7F3D0]/30 flex items-center justify-center text-[#0D5D56]">
                        {isDark ? <Sun size={16} /> : <Moon size={16} />}
                      </div>
                      {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    </button>
                    <div className="h-px w-full bg-[#A7F3D0]/50 my-1" />
                    <button
                      onClick={handleLogout}
                      className="w-full text-left flex items-center gap-3 p-[8px] rounded-2xl hover:bg-red-50 transition-colors text-[#111111] font-medium text-sm"
                    >
                      <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-500">
                        <LogOut size={16} />
                      </div>
                      Sign Out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto hide-scrollbar p-8 lg:p-12 relative z-10">
        <AnimatePresence mode="wait">

          {/* ── DASHBOARD TAB ─────────────────────────────────────────── */}
          {currentTab === "Dashboard" && (
            <motion.div
              key="Dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col h-full"
            >
              {/* Page title */}
              <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
                <div>
                  <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">
                    Welcome in, {voter?.full_name?.split(" ")[0] ?? "Voter"}
                  </h1>
                  <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">
                    {voter?.department_name
                      ? `${voter.department_name} — ${voter.student_id}`
                      : "Your identity is secure and hidden."}
                  </p>
                </div>

                {isTallyReleased ? (
                  <div className="bg-emerald-600 text-white px-6 py-3 rounded-full font-bold flex items-center gap-3 shadow-[0_8px_20px_rgba(16,185,129,0.2)]">
                    <CheckCircle2 className="w-5 h-5 text-[#A7F3D0]" />
                    Official Results Released
                  </div>
                ) : (
                  <div className="bg-[#0D5D56] text-white px-6 py-3 rounded-full font-bold flex items-center gap-3 shadow-[0_8px_20px_rgba(13,93,86,0.2)]">
                    <CheckCircle2 className="w-5 h-5 text-[#A7F3D0]" />
                    Voting Status: Participation Recorded
                  </div>
                )}
              </div>

              {/* Card grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-[minmax(180px,auto)]">

                {/* Banner — 8 cols */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="md:col-span-8 row-span-1 rounded-[40px] bg-[#A7F3D0] border border-white shadow-[0_8px_32px_rgba(13,93,86,0.05)] overflow-hidden flex flex-col justify-between p-8 relative"
                >
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/40 rounded-full blur-[80px] -translate-y-20 translate-x-10 pointer-events-none" />

                  <div className="relative z-10 flex justify-between items-start">
                    <div>
                      <span className="inline-block px-3 py-1 bg-white/60 text-[#0D5D56] text-xs font-bold rounded-full mb-3 shadow-sm">
                        {isTallyReleased ? "Election Concluded" : "Active Election"}
                      </span>
                      <h2 className="font-['Figtree'] text-4xl font-bold max-w-[320px] leading-tight text-[#0D5D56]">
                        {voter?.department_name
                          ? `${voter.department_name} Elections`
                          : config?.voting_method
                          ? `${config.voting_method} Election`
                          : "Delegate Elections"}
                      </h2>
                    </div>
                    <div className="px-5 py-3 bg-[#0D5D56] text-white rounded-full text-sm font-bold flex items-center gap-2 shadow-md">
                      <CheckCircle2 className="w-5 h-5 text-[#A7F3D0]" />
                      You Voted Successfully
                    </div>
                  </div>

                  <div className="relative z-10 mt-auto flex gap-4 pt-6">
                    {isTallyReleased ? (
                      <div className="bg-emerald-600 text-white rounded-[24px] px-6 py-4 font-bold text-sm shadow-[0_8px_20px_rgba(16,185,129,0.3)] flex items-center gap-2">
                        <Trophy size={18} className="text-[#A7F3D0]" />
                        Official Results Released
                      </div>
                    ) : (
                      <div className="bg-transparent text-[#0D5D56] rounded-[24px] px-6 py-4 font-bold text-sm border-2 border-[#0D5D56] shadow-sm flex items-center gap-2">
                        <CheckSquare size={18} />
                        Status: Participation Recorded
                      </div>
                    )}
                    {!isTallyReleased && (
                      <button
                        onClick={() => setIsFeedbackOpen(true)}
                        className="bg-[#0D5D56] hover:bg-[#0D5D56]/90 text-white rounded-[24px] px-6 py-4 font-bold text-sm transition-all shadow-[0_8px_20px_rgba(13,93,86,0.2)] flex items-center gap-2"
                      >
                        <MessageCircle size={18} className="text-[#A7F3D0]" />
                        Give Feedback
                      </button>
                    )}
                  </div>
                </motion.div>

                {/* Ledger Sync — 4 cols */}
                <div className="md:col-span-4 row-span-1 rounded-[40px] bg-white border border-[#A7F3D0]/50 shadow-sm p-8 flex flex-col justify-between relative overflow-hidden">
                  <div className="flex justify-between items-start relative z-10">
                    <h3 className="font-['Figtree'] text-xl font-bold text-[#0D5D56]">Ledger Sync</h3>
                    <div className="w-10 h-10 bg-[#A7F3D0]/50 rounded-full flex items-center justify-center">
                      <ShieldAlert className="w-5 h-5 text-[#0D5D56]" />
                    </div>
                  </div>
                  <div className="relative z-10 mt-4">
                    <p className="text-5xl font-['Figtree'] font-bold text-[#0D5D56] mb-2 tracking-tight">100%</p>
                    <p className="text-[#0D5D56]/70 font-bold text-sm leading-relaxed">
                      {journey?.ledger_updated
                        ? `Synced at ${formatTime(journey.ledger_updated)}`
                        : "Locked and safely saved in our system."}
                    </p>
                  </div>
                </div>

                {/* What happens next — 6 cols */}
                <div className="md:col-span-6 row-span-1 rounded-[40px] bg-white border border-[#A7F3D0]/50 shadow-sm p-8 flex flex-col relative overflow-hidden">
                  <div className="flex justify-between items-start mb-6 relative z-10">
                    <h3 className="font-['Figtree'] text-xl font-bold text-[#0D5D56]">
                      {isTallyReleased ? "Results Available" : "What happens next?"}
                    </h3>
                    <button className="w-10 h-10 bg-[#A7F3D0]/50 rounded-full flex items-center justify-center">
                      <Info className="w-5 h-5 text-[#0D5D56]" />
                    </button>
                  </div>
                  <div className="relative z-10 flex-1">
                    <p className="text-sm text-[#0D5D56]/80 font-bold leading-relaxed mb-4">
                      {isTallyReleased
                        ? "The official results have been mathematically verified and published by the administration."
                        : config?.end_date
                        ? `Voting closes ${formatEndDate(config.end_date)}. Results appear automatically once the administrator releases the tally.`
                        : "We will announce the results when voting ends. We count the votes securely without seeing who you picked."}
                    </p>
                    <p className="text-sm text-[#0D5D56]/80 font-bold leading-relaxed">
                      Zero-evidence protocol is active. All local metadata has been purged for your protection.
                    </p>
                  </div>
                </div>

                {/* Security Journey — 6 cols, real journey timestamps */}
                <div className="md:col-span-6 row-span-1 rounded-[40px] bg-[#A7F3D0] text-[#0D5D56] p-8 flex flex-col shadow-[0_16px_40px_rgba(13,93,86,0.05)] border border-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/40 rounded-full blur-[80px] -translate-y-20 translate-x-10 pointer-events-none" />

                  <div className="flex justify-between items-center mb-8 relative z-10">
                    <h3 className="font-['Figtree'] text-xl font-bold text-[#0D5D56]">Security Journey</h3>
                    <span className="text-xs font-bold bg-white/60 px-3 py-1.5 rounded-full text-[#0D5D56]">
                      All Steps Completed
                    </span>
                  </div>

                  <div className="space-y-5 relative z-10 flex-1 overflow-y-auto hide-scrollbar">
                    <MiniTimelineItem
                      icon={<User size={16} />}
                      title="Identity Verified"
                      time={formatTime(journey?.identity_verified ?? null)}
                    />
                    <MiniTimelineItem
                      icon={<Shield size={16} />}
                      title="Tunnel Active"
                      time={formatTime(journey?.tunnel_active ?? null)}
                    />
                    <MiniTimelineItem
                      icon={<CheckSquare size={16} />}
                      title="Choices Made"
                      time={formatTime(journey?.choices_made ?? null)}
                    />
                    <MiniTimelineItem
                      icon={<Activity size={16} />}
                      title="Ledger Updated"
                      time={formatTime(journey?.ledger_updated ?? null)}
                      isLast
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── ELECTIONS TAB ─────────────────────────────────────────── */}
          {currentTab === "Elections" && (
            isTallyReleased ? (
              <WinnersState />
            ) : (
              <motion.div
                key="Elections-pending"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col h-full gap-8"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">Elections</h1>
                    <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">
                      {voter?.department_name
                        ? `${voter.department_name} Delegate Elections`
                        : config?.voting_method
                        ? `${config.voting_method} Election`
                        : "Delegate Elections"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-white border border-[#A7F3D0] px-5 py-3 rounded-full shadow-sm">
                    <div className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                    </div>
                    <span className="text-sm font-bold text-[#0D5D56]">Voting In Progress</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Countdown block */}
                  <div className="lg:col-span-8 bg-[#0D5D56] rounded-[40px] p-10 flex flex-col justify-between relative overflow-hidden shadow-xl min-h-[320px]">
                    <div className="absolute top-0 right-0 w-72 h-72 bg-[#A7F3D0] rounded-full blur-[120px] opacity-10 pointer-events-none" />

                    <div className="relative z-10">
                      <span className="inline-block px-3 py-1 bg-white/10 text-[#A7F3D0] text-xs font-bold rounded-full mb-4">
                        Results locked until voting ends
                      </span>
                      <h2 className="font-['Figtree'] text-3xl font-bold text-white leading-tight mb-2">
                        Results will be announced when the ballot closes
                      </h2>
                      {endDateLabel && (
                        <p className="text-white/60 text-sm font-bold mt-1">
                          Scheduled close: {endDateLabel}
                        </p>
                      )}
                    </div>

                    <div className="relative z-10 mt-8">
                      {timeRemaining ? (
                        <div className="grid grid-cols-4 gap-4">
                          {[
                            { label: "Days", value: timeRemaining.days },
                            { label: "Hours", value: timeRemaining.hours },
                            { label: "Minutes", value: timeRemaining.minutes },
                            { label: "Seconds", value: timeRemaining.seconds },
                          ].map(({ label, value }) => (
                            <div key={label} className="bg-white/10 border border-white/20 rounded-[24px] p-5 text-center backdrop-blur-md">
                              <p className="text-4xl font-['Figtree'] font-bold text-[#A7F3D0] tabular-nums">
                                {String(value).padStart(2, "0")}
                              </p>
                              <p className="text-white/60 text-xs font-bold mt-1 uppercase tracking-widest">
                                {label}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bg-white/10 border border-white/20 rounded-[24px] p-6 text-center">
                          <p className="text-white/60 font-bold text-sm">
                            No end time set by administrator yet. Results will appear when the admin releases the tally.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right info panel */}
                  <div className="lg:col-span-4 flex flex-col gap-6">
                    <div className="bg-white rounded-[40px] border border-[#A7F3D0]/50 p-8 shadow-sm flex flex-col gap-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-[#A7F3D0]/50 flex items-center justify-center">
                          <ShieldAlert className="w-5 h-5 text-[#0D5D56]" />
                        </div>
                        <h3 className="font-['Figtree'] text-lg font-bold text-[#0D5D56]">Why no results yet?</h3>
                      </div>
                      <p className="text-sm font-bold text-[#0D5D56]/70 leading-relaxed">
                        To protect voter anonymity, results are hidden while the election is live. Revealing partial tallies could expose how individuals voted.
                      </p>
                      <div className="h-px bg-[#A7F3D0]/50" />
                      <p className="text-sm font-bold text-[#0D5D56]/70 leading-relaxed">
                        Once the administrator closes the ballot, results will appear here automatically — no refresh needed.
                      </p>
                    </div>

                    <div className="bg-[#A7F3D0] rounded-[40px] p-8 flex flex-col gap-3 border border-white shadow-sm">
                      <h3 className="font-['Figtree'] text-lg font-bold text-[#0D5D56]">Your Vote</h3>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#0D5D56] flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-[#A7F3D0]" />
                        </div>
                        <p className="text-sm font-bold text-[#0D5D56]">Recorded &amp; cryptographically sealed</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#0D5D56] flex items-center justify-center shrink-0">
                          <Shield className="w-4 h-4 text-[#A7F3D0]" />
                        </div>
                        <p className="text-sm font-bold text-[#0D5D56]">Zero-evidence guarantee active</p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          )}

          {/* ── VOTER CARE TAB ─────────────────────────────────────────── */}
          {currentTab === "Voter Care" && (
            <motion.div
              key="Voter Care"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col h-full space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="w-full max-w-2xl">
                  <div className="relative w-full">
                    <Search className="absolute left-6 top-1/2 transform -translate-y-1/2 text-[#0D5D56]/50 w-6 h-6" />
                    <input
                      type="text"
                      placeholder="How can we help you today?"
                      className="w-full bg-white border-2 border-[#A7F3D0] rounded-full py-5 pl-16 pr-8 text-lg font-bold text-[#0D5D56] placeholder:text-[#0D5D56]/40 focus:outline-none focus:border-[#0D5D56] shadow-[0_8px_32px_rgba(13,93,86,0.05)] transition-all"
                    />
                  </div>
                </div>
                <div className="bg-white/80 backdrop-blur-md border border-[#A7F3D0] text-[#0D5D56] px-5 py-3 rounded-full font-bold flex items-center gap-3 shadow-sm shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  System Health: All Systems Operational
                </div>
              </div>

              {/* Info cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  {
                    key: "guide",
                    icon: <BookOpen size={28} />,
                    title: "Voting Process",
                    desc: "Learn how to cast your ballot step-by-step.",
                    btnLabel: "View Guide",
                    content: (
                      <div className="space-y-3 text-left">
                        {[
                          "1. Log in with your student email and ID.",
                          "2. Verify your identity via the secure tunnel.",
                          "3. Read the instructions and choose your voting mode.",
                          "4. On the Ballot page, select your preferred candidate for each role.",
                          "5. Submit your ballot. A security window activates.",
                          "6. Your ephemeral confirmation appears and auto-closes.",
                        ].map((s) => (
                          <div key={s} className="flex gap-3 text-sm font-bold text-[#0D5D56]">
                            <span className="text-[#0D5D56]/40 shrink-0">{s.split(".")[0]}.</span>
                            <span>{s.split(".").slice(1).join(".")}</span>
                          </div>
                        ))}
                      </div>
                    ),
                  },
                  {
                    key: "policy",
                    icon: <Shield size={28} />,
                    title: "Security & Privacy",
                    desc: "Understand the Double Shield encryption protocols.",
                    btnLabel: "Read Policy",
                    content: (
                      <div className="space-y-3 text-left text-sm font-bold text-[#0D5D56]">
                        <p><span className="text-[#0D5D56]/60">Encryption:</span> Your vote is encrypted homomorphically. The server stores a number — never your actual choice.</p>
                        <p><span className="text-[#0D5D56]/60">Zero-Knowledge Proof:</span> A ZKP proves your ballot is valid without revealing how you voted.</p>
                        <p><span className="text-[#0D5D56]/60">Blind Signature:</span> Your credential is issued without linking your identity to your vote.</p>
                        <p><span className="text-[#0D5D56]/60">No Evidence:</span> No receipts, no logs, no clipboard data. The confirmation screen auto-closes.</p>
                      </div>
                    ),
                  },
                  {
                    key: "help",
                    icon: <Computer size={28} />,
                    title: "Technical Support",
                    desc: "Troubleshoot connectivity or interface issues.",
                    btnLabel: "Get Help",
                    content: (
                      <div className="space-y-3 text-left text-sm font-bold text-[#0D5D56]">
                        {[
                          ["Page won't load", "Try refreshing. Clear your browser cache if the issue persists."],
                          ["Session expired", "Log out and log back in. Your vote has NOT been re-submitted."],
                          ["Timer seems stuck", "The security window is intentional — it completes automatically."],
                          ["Can't select a candidate", "Scroll to see all candidates. On mobile, tap directly on the card."],
                        ].map(([q, a]) => (
                          <div key={q} className="bg-[#F8FAFC] rounded-2xl p-4 border border-[#A7F3D0]/50">
                            <p className="text-[#0D5D56] font-bold mb-1">{q}</p>
                            <p className="text-[#0D5D56]/70 font-medium">{a}</p>
                          </div>
                        ))}
                      </div>
                    ),
                  },
                ].map((card) => (
                  <div key={card.key} className="flex flex-col gap-4">
                    <div className="bg-[#A7F3D0] rounded-[32px] p-8 border border-white shadow-sm flex flex-col items-center text-center">
                      <div className="w-16 h-16 bg-white text-[#0D5D56] rounded-full flex items-center justify-center mb-6 shadow-sm">
                        {card.icon}
                      </div>
                      <h3 className="font-['Figtree'] text-xl font-bold text-[#0D5D56] mb-3">{card.title}</h3>
                      <p className="text-[#0D5D56]/70 font-medium mb-6">{card.desc}</p>
                      <button
                        onClick={() => setExpandedCard(expandedCard === card.key ? null : card.key)}
                        className="mt-auto px-6 py-2.5 rounded-full border-2 border-[#0D5D56] text-[#0D5D56] font-bold text-sm hover:bg-[#0D5D56]/10 transition-colors"
                      >
                        {expandedCard === card.key ? "Close" : card.btnLabel}
                      </button>
                    </div>
                    <AnimatePresence>
                      {expandedCard === card.key && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="bg-white rounded-[28px] border border-[#A7F3D0]/50 shadow-sm p-6 overflow-hidden"
                        >
                          {card.content}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>

              {/* Support ticket + Live chat */}
              <div className="bg-white rounded-[40px] border border-[#A7F3D0]/50 shadow-sm p-10 flex flex-col lg:flex-row gap-10">
                <div className="flex-1">
                  <h2 className="font-['Figtree'] text-3xl font-bold text-[#0D5D56] mb-2">Need direct assistance?</h2>
                  <p className="text-[#0D5D56]/70 font-medium mb-8 text-lg">Submit a secure ticket and our team will get back to you.</p>

                  <AnimatePresence mode="wait">
                    {ticketSubmitted ? (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-emerald-50 border border-emerald-200 rounded-[24px] p-8 text-center"
                      >
                        <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
                        <h3 className="font-['Figtree'] text-xl font-bold text-emerald-800 mb-2">Ticket Submitted</h3>
                        <p className="text-emerald-700 font-medium text-sm">We've received your message and will respond within 24 hours.</p>
                        <button
                          onClick={() => { setTicketSubmitted(false); setTicketName(""); setTicketMessage(""); setTicketError(null); }}
                          className="mt-4 px-6 py-2.5 rounded-full border-2 border-emerald-600 text-emerald-700 font-bold text-sm hover:bg-emerald-100 transition-colors"
                        >
                          Submit Another
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input
                            type="text"
                            placeholder="Full Name (Optional)"
                            value={ticketName}
                            onChange={(e) => setTicketName(e.target.value)}
                            className="w-full bg-[#F8FAFC] border border-[#A7F3D0] rounded-[20px] p-4 text-[#0D5D56] placeholder:text-[#0D5D56]/40 focus:outline-none focus:border-[#0D5D56] font-medium"
                          />
                          <input
                            type="email"
                            placeholder="Email address"
                            value={ticketEmail}
                            onChange={(e) => setTicketEmail(e.target.value)}
                            className="w-full bg-[#F8FAFC] border border-[#A7F3D0] rounded-[20px] p-4 text-[#0D5D56] placeholder:text-[#0D5D56]/40 focus:outline-none focus:border-[#0D5D56] font-medium"
                          />
                        </div>
                        <textarea
                          rows={4}
                          placeholder="Describe your issue…"
                          value={ticketMessage}
                          onChange={(e) => setTicketMessage(e.target.value)}
                          className="w-full bg-[#F8FAFC] border border-[#A7F3D0] rounded-[20px] p-4 text-[#0D5D56] placeholder:text-[#0D5D56]/40 focus:outline-none focus:border-[#0D5D56] font-medium resize-none"
                        />
                        {ticketError && (
                          <p className="text-sm font-bold text-red-600 flex items-center gap-2">
                            <AlertCircle size={16} /> {ticketError}
                          </p>
                        )}
                        <button
                          onClick={handleTicketSubmit}
                          disabled={!ticketMessage.trim() || ticketSubmitting}
                          className="bg-[#0D5D56] text-white px-8 py-4 rounded-full font-bold shadow-[0_8px_20px_rgba(13,93,86,0.2)] hover:bg-[#0D5D56]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {ticketSubmitting && <Loader2 size={16} className="animate-spin" />}
                          Submit Support Ticket
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Live chat — UI-only */}
                <div className="lg:w-[350px] bg-[#A7F3D0]/20 rounded-[32px] p-8 border border-[#A7F3D0] flex flex-col">
                  <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-20 h-20 bg-[#0D5D56] text-white rounded-full flex items-center justify-center mb-4 shadow-lg relative">
                      <HeadphonesIcon size={32} />
                      <span className="absolute top-0 right-0 w-4 h-4 bg-emerald-400 border-2 border-[#A7F3D0] rounded-full animate-pulse" />
                    </div>
                    <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] mb-2">Live Chat</h3>
                    <p className="text-[#0D5D56]/80 font-medium text-sm">Talk to an AnonyTech guide right now.</p>
                  </div>

                  {!chatOpen ? (
                    <button
                      onClick={() => setChatOpen(true)}
                      className="w-full bg-white text-[#0D5D56] border-2 border-[#0D5D56] py-4 rounded-full font-bold hover:bg-[#0D5D56]/5 transition-colors mb-3"
                    >
                      Start Chat
                    </button>
                  ) : (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 flex-1">
                      <div className="flex-1 bg-white rounded-[20px] p-4 border border-[#A7F3D0]/50 overflow-y-auto max-h-[200px] space-y-2">
                        {chatHistory.map((msg, i) => (
                          <div key={i} className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={`px-4 py-2.5 rounded-2xl text-xs font-bold max-w-[85%] ${msg.from === "user" ? "bg-[#0D5D56] text-white" : "bg-[#F8FAFC] text-[#0D5D56] border border-[#A7F3D0]/50"}`}>
                              {msg.text}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Type a message…"
                          value={chatMessage}
                          onChange={(e) => setChatMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && chatMessage.trim()) {
                              setChatHistory((h) => [...h, { from: "user", text: chatMessage }, { from: "agent", text: "Thanks for reaching out! A support agent will respond shortly." }]);
                              setChatMessage("");
                            }
                          }}
                          className="flex-1 bg-white border border-[#A7F3D0] rounded-full px-4 py-2.5 text-xs font-bold text-[#0D5D56] focus:outline-none focus:border-[#0D5D56]"
                        />
                        <button
                          onClick={() => {
                            if (chatMessage.trim()) {
                              setChatHistory((h) => [...h, { from: "user", text: chatMessage }, { from: "agent", text: "Thanks for reaching out! A support agent will respond shortly." }]);
                              setChatMessage("");
                            }
                          }}
                          className="w-10 h-10 bg-[#0D5D56] text-[#A7F3D0] rounded-full flex items-center justify-center shadow-sm hover:bg-[#0D5D56]/90 transition-colors"
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </motion.div>
                  )}
                  <span className="text-xs font-bold text-[#0D5D56]/60 bg-white px-3 py-1.5 rounded-full border border-[#A7F3D0] text-center mt-3">
                    Average response time: 2 mins
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Edit Profile Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {isEditProfileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D5D56]/30 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white border border-[#A7F3D0] shadow-2xl rounded-[40px] w-full max-w-md overflow-hidden relative"
            >
              <div className="h-4 w-full bg-[#0D5D56]" />
              <div className="p-8">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="font-['Figtree'] text-3xl font-bold text-[#0D5D56]">Edit Profile</h3>
                  <button
                    onClick={() => { setIsEditProfileOpen(false); setProfileError(null); }}
                    className="text-[#0D5D56] hover:bg-[#0D5D56] hover:text-[#A7F3D0] bg-[#A7F3D0] px-4 py-2 rounded-full text-sm font-bold transition-all border border-[#A7F3D0]"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-4 mb-8">
                  <div>
                    <label className="block text-sm font-bold text-[#0D5D56] mb-2">Display Name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full bg-[#F8FAFC] border border-[#A7F3D0] rounded-[20px] p-4 text-[#0D5D56] focus:outline-none focus:border-[#0D5D56] font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-[#0D5D56] mb-2">Email Address</label>
                    <input
                      type="email"
                      value={voter?.email ?? ""}
                      disabled
                      className="w-full bg-[#F8FAFC]/50 border border-[#A7F3D0]/50 rounded-[20px] p-4 text-[#0D5D56]/60 font-medium cursor-not-allowed"
                    />
                    <p className="text-xs text-[#0D5D56]/60 mt-2 font-bold">
                      Email is linked to your voter identity and cannot be changed.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-[#0D5D56] mb-2">Student ID</label>
                    <input
                      type="text"
                      value={voter?.student_id ?? ""}
                      disabled
                      className="w-full bg-[#F8FAFC]/50 border border-[#A7F3D0]/50 rounded-[20px] p-4 text-[#0D5D56]/60 font-medium cursor-not-allowed"
                    />
                  </div>
                </div>
                {profileError && (
                  <p className="text-sm font-bold text-red-600 mb-4 flex items-center gap-2">
                    <AlertCircle size={16} /> {profileError}
                  </p>
                )}
                <button
                  onClick={handleProfileSave}
                  disabled={profileSaving}
                  className="w-full bg-[#0D5D56] hover:bg-[#0D5D56]/90 text-white px-6 py-4 rounded-[20px] text-lg font-bold shadow-[0_8px_20px_rgba(13,93,86,0.2)] transition-all flex justify-center items-center gap-2 disabled:opacity-60"
                >
                  {profileSaving && <Loader2 size={18} className="animate-spin" />}
                  Save Changes
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Change Password Modal ────────────────────────────────────── */}
      <AnimatePresence>
        {isSecurityPinOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D5D56]/30 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white border border-[#A7F3D0] shadow-2xl rounded-[40px] w-full max-w-md overflow-hidden relative"
            >
              <div className="h-4 w-full bg-[#0D5D56]" />
              <div className="p-8">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="font-['Figtree'] text-3xl font-bold text-[#0D5D56] leading-tight">Change Password</h3>
                  <button
                    onClick={() => { setIsSecurityPinOpen(false); setPasswordError(null); setPasswordDone(false); setNewPassword(""); setConfirmPassword(""); }}
                    className="text-[#0D5D56] hover:bg-[#0D5D56] hover:text-[#A7F3D0] bg-[#A7F3D0] px-4 py-2 rounded-full text-sm font-bold transition-all border border-[#A7F3D0]"
                  >
                    Close
                  </button>
                </div>

                {passwordDone ? (
                  <div className="text-center py-8">
                    <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-bold text-emerald-700">Password updated successfully!</p>
                  </div>
                ) : (
                  <div className="space-y-4 mb-8">
                    <div>
                      <label className="block text-sm font-bold text-[#0D5D56] mb-2">New Password</label>
                      <input
                        type="password"
                        placeholder="At least 6 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-[#F8FAFC] border border-[#A7F3D0] rounded-[20px] p-4 text-[#0D5D56] focus:outline-none focus:border-[#0D5D56] font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-[#0D5D56] mb-2">Confirm New Password</label>
                      <input
                        type="password"
                        placeholder="Repeat password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-[#F8FAFC] border border-[#A7F3D0] rounded-[20px] p-4 text-[#0D5D56] focus:outline-none focus:border-[#0D5D56] font-medium"
                      />
                    </div>
                    {passwordError && (
                      <p className="text-sm font-bold text-red-600 flex items-center gap-2">
                        <AlertCircle size={16} /> {passwordError}
                      </p>
                    )}
                    <button
                      onClick={handlePasswordUpdate}
                      disabled={passwordSaving}
                      className="w-full bg-[#0D5D56] hover:bg-[#0D5D56]/90 text-white px-6 py-4 rounded-[20px] text-lg font-bold shadow-[0_8px_20px_rgba(13,93,86,0.2)] transition-all flex justify-center items-center gap-2 disabled:opacity-60"
                    >
                      {passwordSaving && <Loader2 size={18} className="animate-spin" />}
                      Update Password
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Feedback Modal ───────────────────────────────────────────── */}
      <AnimatePresence>
        {isFeedbackOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D5D56]/30 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white border border-[#A7F3D0] shadow-2xl rounded-[40px] w-full max-w-md overflow-hidden relative"
            >
              <div className="h-4 w-full bg-[#0D5D56]" />
              <div className="p-8">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="font-['Figtree'] text-3xl font-bold text-[#0D5D56]">How was voting?</h3>
                  <button
                    onClick={() => setIsFeedbackOpen(false)}
                    className="text-[#0D5D56] hover:bg-[#0D5D56] hover:text-[#A7F3D0] bg-[#A7F3D0] px-4 py-2 rounded-full text-sm font-bold transition-all border border-[#A7F3D0]"
                  >
                    Close
                  </button>
                </div>

                {feedbackDone ? (
                  <div className="text-center py-8">
                    <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-bold text-emerald-700">Thank you for your feedback!</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-8">
                      <p className="text-sm font-bold text-[#0D5D56] mb-4">Tap the stars to rate your experience.</p>
                      <div className="flex gap-3 justify-center bg-[#A7F3D0]/20 p-6 rounded-[24px] border border-[#A7F3D0]">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => setRating(star)}
                            className="p-2 transition-transform hover:scale-110 focus:outline-none bg-white rounded-2xl shadow-sm border border-[#A7F3D0]"
                          >
                            <Star className={`w-8 h-8 ${rating >= star ? "fill-[#0D5D56] text-[#0D5D56]" : "text-[#A7F3D0]"}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-6">
                      <label className="block text-sm font-bold text-[#0D5D56] mb-3">Any other comments? (Optional)</label>
                      <textarea
                        rows={4}
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder="Type your thoughts here…"
                        className="w-full bg-[#F8FAFC] border border-[#A7F3D0] rounded-[24px] p-5 text-sm text-[#0D5D56] placeholder-[#0D5D56]/40 focus:outline-none focus:border-[#0D5D56] focus:ring-4 focus:ring-[#0D5D56]/10 shadow-inner resize-none transition-all font-bold"
                      />
                    </div>
                    <button
                      onClick={handleFeedbackSubmit}
                      disabled={!rating || feedbackSubmitting}
                      className="w-full bg-[#0D5D56] hover:bg-[#0D5D56]/90 text-white px-6 py-4 rounded-[20px] text-lg font-bold shadow-[0_8px_20px_rgba(13,93,86,0.2)] transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {feedbackSubmitting && <Loader2 size={18} className="animate-spin" />}
                      <MessageCircle size={20} className="text-[#A7F3D0]" />
                      Send Feedback
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function NavItem({ label, active = false, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all ${
        active ? "bg-white text-[#0D5D56] shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
}

function MiniTimelineItem({
  icon, title, time, isLast = false,
}: {
  icon: React.ReactNode;
  title: string;
  time: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 relative">
      {!isLast && <div className="absolute left-[19px] top-10 bottom-[-20px] w-0.5 bg-[#0D5D56]/20" />}
      <div className="w-10 h-10 rounded-xl bg-white/60 border border-white flex items-center justify-center relative z-10 text-[#0D5D56]">
        {icon}
      </div>
      <div className="flex-1 flex justify-between items-center">
        <span className="font-bold text-[#0D5D56] text-sm">{title}</span>
        <span className="text-xs font-bold text-[#0D5D56]/70 bg-white/60 px-2 py-1 rounded-md border border-white">
          {time}
        </span>
      </div>
    </div>
  );
}