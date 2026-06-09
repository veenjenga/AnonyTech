import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings, Users, Database, ShieldCheck,
  LogOut, Plus, Upload, Shield, Activity,
  CheckCircle2, Lock, Clock, Calendar, ChevronDown,
  Server, Network, FileDown,
  ToggleLeft, ToggleRight, Fingerprint,
  CheckSquare, Check, Eye, AlertCircle, Loader2,
  Zap, Info, Edit2, Trash2, KeyRound, X,
  RotateCcw, FileText, XCircle,
} from "lucide-react";

import { useTranslation } from "react-i18next";
import { AdminRegistry } from "./AdminRegistry";
import { AdminTallyHub } from "./AdminTallyHub";
import { getTheme, setTheme } from "../utils/dataStore";

// ─── API base URLs ────────────────────────────────────────────────────────────
const API: string =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env.VITE_API_URL ||
  "http://localhost:5000";

const PLUGIN_API: string =
  (import.meta as ImportMeta & { env: { VITE_PLUGIN_API_URL?: string } }).env.VITE_PLUGIN_API_URL ||
  "http://localhost:8000";

function getAdminEmail(): string {
  return localStorage.getItem("adminEmail") || "";
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const adminEmail = getAdminEmail();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-email": adminEmail,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function pluginFetch(path: string, options: RequestInit = {}) {
  try {
    const res = await fetch(`${PLUGIN_API}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.detail || err.error || res.statusText);
    }
    return res.json();
  } catch (error) {
    console.error(`Plugin API error (${path}):`, error);
    throw error;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface PluginInfo {
  method: string;
  ballot_structure: {
    type: string;
    description: string;
    fields: Record<string, { type: string; description: string; required?: boolean; enum?: string[]; default?: any }>;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a UTC ISO string from the DB to a local datetime-local input value.
 * e.g. "2025-06-10T14:00:00.000Z" → "2025-06-10T17:00" (if UTC+3)
 */
function utcToLocal(isoUtc: string): string {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  // Format as YYYY-MM-DDTHH:mm in local time
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert a local datetime-local value to a UTC ISO string for the DB.
 * The native Date constructor treats the input as local time, so no manual offset needed.
 */
function localToUtc(localDT: string): string {
  if (!localDT) return "";
  return new Date(localDT).toISOString();
}

// ─── Voting method definitions ────────────────────────────────────────────────
const METHODS = [
  {
    id: "plurality",
    name: "Plurality",
    label: "First Past the Post",
    desc: "Voters select exactly one candidate. Most votes wins. Simple and fast.",
    voterUiDesc: "Single-choice ballot — tap to select one candidate.",
    icon: "①",
    color: "emerald",
  },
  {
    id: "stv",
    name: "Single Transferable Vote",
    label: "STV — Ranked Choice",
    desc: "Voters rank candidates. Votes transfer on elimination ensuring broader representation.",
    voterUiDesc: "Ranked ballot — assign preference order to candidates.",
    icon: "↑↓",
    color: "blue",
  },
  {
    id: "borda",
    name: "Borda Count",
    label: "Positional Scoring",
    desc: "Points assigned by rank. Rank 1 = N-1 pts, rank 2 = N-2 pts … encourages consensus.",
    voterUiDesc: "Ranked ballot — scores computed from your ranking order.",
    icon: "∑",
    color: "violet",
  },
  {
    id: "liquid",
    name: "Liquid Democracy",
    label: "Vote or Delegate",
    desc: "Vote directly or delegate your vote to a trusted proxy. Delegation is transitive.",
    voterUiDesc: "Dual-action ballot — vote directly or assign a delegate.",
    icon: "⇆",
    color: "amber",
  },
] as const;

type MethodId = (typeof METHODS)[number]["id"];

// ─── Disaster-recovery failure scenarios (Graceful Degradation Protocol) ──────
const FAILURE_TYPES = [
  { id: "power",   label: "Power Failure",      desc: "WAL replay + Redis AOF merge" },
  { id: "network", label: "Network Partition",  desc: "CockroachDB auto-rebalance" },
  { id: "storage", label: "Storage Corruption", desc: "Last-valid-checkpoint recovery" },
  { id: "client",  label: "Client Disconnect",  desc: "Service-Worker cache flush" },
] as const;

type FailureId = (typeof FAILURE_TYPES)[number]["id"];

// ─────────────────────────────────────────────────────────────────────────────

export function AdminDashboard() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const language = i18n.language === "sw" ? "KS" : "EN";
  const [currentTab, setCurrentTab] = useState("Command Center");

  // ── Admin session guard ───────────────────────────────────────────────────
  const [adminSessionValid, setAdminSessionValid] = useState<boolean | null>(null);
  const [adminSessionError, setAdminSessionError] = useState<string | null>(null);

  useEffect(() => {
    const email = getAdminEmail();
    if (!email) {
      setAdminSessionError("No admin session found. Please log in as an admin.");
      setAdminSessionValid(false);
      return;
    }
    fetch(`${API}/api/voters?role=admin`, {
      headers: { "Content-Type": "application/json", "x-admin-email": email },
    }).then(async (res) => {
      if (res.ok) {
        setAdminSessionValid(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setAdminSessionError(
          `"${email}" is not an admin account. ` +
          `Please log in with your admin credentials. (${(body as any).error ?? `HTTP ${res.status}`})`
        );
        setAdminSessionValid(false);
      }
    }).catch(() => {
      setAdminSessionValid(true);
    });
  }, []);

  // ── Election config ───────────────────────────────────────────────────────
  const [config, setConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const isSealed: boolean        = config?.is_sealed ?? false;
  const isTallyReleased: boolean = config?.is_tally_released ?? false;

  // ── FIX: Convert UTC DB dates to local time for inputs ──
  const electionStartDate: string = config?.start_date ? utcToLocal(config.start_date) : "";
  const electionEndDate: string   = config?.end_date   ? utcToLocal(config.end_date)   : "";

  const votingMethod: MethodId = (config?.voting_method ?? "plurality") as MethodId;

  // The shared election_config row id — used as election_id for the plugin
  // engine's ballot box and the Graceful Degradation Protocol.
  const electionId: string = String(config?.id ?? "1");

  // ── Election name/description ─────────────────────────────────────────────
  const [electionName, setElectionName] = useState("");
  const [electionDescription, setElectionDescription] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch("/api/config");
      setConfig(data);
      setElectionName(data.election_name || "");
      setElectionDescription(data.election_description || "");
    } catch (e) {
      console.error("Failed to load config:", e);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminSessionValid === true) loadConfig();
    else if (adminSessionValid === false) setConfigLoading(false);
  }, [adminSessionValid, loadConfig]);

  const saveElectionMeta = async () => {
    if (!electionName.trim()) return;
    setSavingMeta(true);
    try {
      const updated = await apiFetch("/api/config", {
        method: "PATCH",
        body: JSON.stringify({
          electionName: electionName.trim(),
          electionDescription: electionDescription.trim() || null,
        }),
      });
      setConfig(updated);
      setMetaSaved(true);
      setTimeout(() => setMetaSaved(false), 2500);
    } catch (e) {
      console.error("Failed to save election meta:", e);
    } finally {
      setSavingMeta(false);
    }
  };

  // ── Plugin engine state ───────────────────────────────────────────────────
  const [pluginInfo, setPluginInfo] = useState<PluginInfo | null>(null);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [switchingMethod, setSwitchingMethod] = useState(false);
  const [lastSwitchLog, setLastSwitchLog] = useState<{ from: string; to: string; ts: string } | null>(null);

  const loadPluginInfo = useCallback(async () => {
    setPluginLoading(true);
    setPluginError(null);
    try {
      const info: PluginInfo = await pluginFetch("/plugin/info");
      setPluginInfo(info);
    } catch (e: any) {
      setPluginError(e.message || "Failed to connect to plugin engine.");
    } finally {
      setPluginLoading(false);
    }
  }, []);

  useEffect(() => { loadPluginInfo(); }, [loadPluginInfo]);

  const handleSelectMethod = async (methodId: MethodId) => {
    if (methodId === votingMethod && pluginInfo?.method === methodId) return;
    if (isSealed) { setPluginError("Cannot switch method - election is already sealed"); return; }
    setSwitchingMethod(true);
    setPluginError(null);
    try {
      const switchResult = await pluginFetch("/plugin/switch", {
        method: "POST",
        body: JSON.stringify({ method: methodId }),
      });
      const updated = await apiFetch("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ votingMethod: methodId }),
      });
      setConfig(updated);
      const info: PluginInfo = await pluginFetch("/plugin/info");
      setPluginInfo(info);
      setLastSwitchLog({
        from: switchResult.from || votingMethod,
        to: switchResult.switched_to || methodId,
        ts: new Date().toLocaleTimeString(),
      });
    } catch (e: any) {
      setPluginError(`Switch failed: ${e.message}.`);
    } finally {
      setSwitchingMethod(false);
    }
  };

  // ── Departments ───────────────────────────────────────────────────────────
  const [deptList, setDeptList] = useState<any[]>([]);
  const [activeDeptId, setActiveDeptId] = useState<string>("");

  const loadDepts = useCallback(async () => {
    try {
      const data = await apiFetch("/api/departments");
      setDeptList(data);
      if (data.length > 0 && !activeDeptId) setActiveDeptId(data[0].id);
    } catch (e) {
      console.error("Failed to load departments:", e);
    }
  }, [activeDeptId]);

  useEffect(() => { if (adminSessionValid === true) loadDepts(); }, [adminSessionValid]);

  const updateDeptState = async (deptId: string, patch: { isSealed?: boolean; isTallyReleased?: boolean }) => {
    try {
      await apiFetch(`/api/departments/${deptId}/state`, { method: "PATCH", body: JSON.stringify(patch) });
      await loadDepts();
    } catch (e) {
      console.error("Failed to update dept state:", e);
    }
  };

  const patchConfig = async (patch: object) => {
    try {
      const updated = await apiFetch("/api/config", { method: "PATCH", body: JSON.stringify(patch) });
      setConfig(updated);
    } catch (e) {
      console.error("Failed to patch config:", e);
    }
  };

  // ── Voters ────────────────────────────────────────────────────────────────
  const [voterList, setVoterList] = useState<any[]>([]);
  const [voterTotal, setVoterTotal] = useState(0);

  const loadVoters = useCallback(async () => {
    try {
      const data = await apiFetch("/api/voters");
      setVoterList(data);
      setVoterTotal(data.length);
    } catch (e) {
      console.error("Failed to load voters:", e);
    }
  }, []);

  useEffect(() => { if (adminSessionValid === true) loadVoters(); }, [adminSessionValid]);

  // ── Ballots ───────────────────────────────────────────────────────────────
  const [ballotFeed, setBallotFeed] = useState<any[]>([]);
  const [envelopeCount, setEnvelopeCount] = useState(0);

  const loadBallots = useCallback(async () => {
    if (!isSealed || isTallyReleased) return;
    try {
      const data = await apiFetch("/api/ballots");
      setEnvelopeCount(data.length);
      setBallotFeed(
        data.slice(0, 6).map((b: any) => ({
          id: `#${String(b.id).slice(-3).padStart(3, "0")}`,
          time: new Date(b.submitted_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          token: b.token_hash ? `0x${b.token_hash.slice(0, 6)}...` : "0x------",
        }))
      );
    } catch (e) {
      console.error("Failed to load ballots:", e);
    }
  }, [isSealed, isTallyReleased]);

  useEffect(() => {
    loadBallots();
    if (!isSealed || isTallyReleased) return;
    const interval = setInterval(loadBallots, 5000);
    return () => clearInterval(interval);
  }, [isSealed, isTallyReleased, loadBallots]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showSealAnim, setShowSealAnim] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsPassword, setSettingsPassword] = useState("");
  const [settingsPasswordConfirm, setSettingsPasswordConfirm] = useState("");
  const [settingsTheme, setSettingsTheme] = useState<"light" | "dark">(() => getTheme());
  const [settingsMsg, setSettingsMsg] = useState("");
  const [showHomomorphic, setShowHomomorphic] = useState(false);
  const [homomorphicStep, setHomomorphicStep] = useState(0);
  const [previewMethod, setPreviewMethod] = useState<MethodId | null>(null);

  // ── Disaster recovery state (Graceful Degradation Protocol) ────────────────
  // Talks to the Node gateway (/api/recovery/*), which proxies the Plugin
  // Engine (:8000). Recovery is read/merge only — it never deletes ballots.
  const [recoveryRunning, setRecoveryRunning] = useState<FailureId | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<any | null>(null);
  const [recoveryReport, setRecoveryReport] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [loadingRecoveryReport, setLoadingRecoveryReport] = useState(false);

  const runRecovery = async (failure: FailureId) => {
    setRecoveryRunning(failure);
    setRecoveryError(null);
    setRecoveryResult(null);
    try {
      const data = await apiFetch("/api/recovery/initiate", {
        method: "POST",
        body: JSON.stringify({
          electionId,
          failureEvent: { labels: { failure_type: failure }, alertname: `${failure}_alert` },
        }),
      });
      setRecoveryResult(data);
    } catch (e: any) {
      setRecoveryError(e.message || "Recovery failed.");
    } finally {
      setRecoveryRunning(null);
    }
  };

  const fetchRecoveryReport = async () => {
    setLoadingRecoveryReport(true);
    setRecoveryError(null);
    try {
      const data = await apiFetch(`/api/recovery/${encodeURIComponent(electionId)}/audit-report`);
      setRecoveryReport(data.report);
    } catch (e: any) {
      setRecoveryError(e.message || "Could not load audit report.");
    } finally {
      setLoadingRecoveryReport(false);
    }
  };

  // ── Auto-tally ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSealed || isTallyReleased || !electionEndDate) return;
    const check = setInterval(() => {
      if (new Date() >= new Date(electionEndDate)) {
        clearInterval(check);
        triggerHomomorphicTally();
      }
    }, 1000);
    return () => clearInterval(check);
  }, [isSealed, isTallyReleased, electionEndDate]);

  const triggerHomomorphicTally = () => {
    setShowHomomorphic(true);
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) => {
      setTimeout(() => setHomomorphicStep(i + 1), 600 * i);
    });
    setTimeout(async () => {
      try {
        await apiFetch("/api/config/tally", { method: "POST" });
        await loadConfig();
      } catch (e) {
        console.error("Failed to release tally:", e);
      }
      setShowHomomorphic(false);
    }, 6000);
  };

  const handleSeal = async () => {
    setShowSealAnim(true);
    try {
      await apiFetch("/api/config/seal", { method: "POST" });
      await loadConfig();
    } catch (e) {
      console.error("Failed to seal:", e);
    }
    setTimeout(() => setShowSealAnim(false), 2000);
  };

  const handleSealAll = async () => {
    setShowSealAnim(true);
    try {
      await apiFetch("/api/config/seal", { method: "POST" });
      await Promise.all(deptList.map((d) => updateDeptState(d.id, { isSealed: true })));
      await loadConfig();
    } catch (e) {
      console.error("Failed to seal all:", e);
    }
    setTimeout(() => setShowSealAnim(false), 2000);
  };

  // ── Voters tab ────────────────────────────────────────────────────────────
  const [csvUploaded, setCsvUploaded] = useState(false);
  const [manualRegEnabled, setManualRegEnabled] = useState(true);
  const [isAddVoterOpen, setIsAddVoterOpen] = useState(false);
  const [newVoterName, setNewVoterName] = useState("");
  const [newVoterStudentId, setNewVoterStudentId] = useState("");
  const [newVoterEmail, setNewVoterEmail] = useState("");
  const [newVoterPassword, setNewVoterPassword] = useState("");

  // ── Voter edit/delete state ────────────────────────────────────────────────
  const [editingVoter, setEditingVoter] = useState<any | null>(null);
  const [editVoterPassword, setEditVoterPassword] = useState("");
  const [editVoterPasswordConfirm, setEditVoterPasswordConfirm] = useState("");
  const [editVoterMsg, setEditVoterMsg] = useState("");
  const [savingVoterEdit, setSavingVoterEdit] = useState(false);
  const [deletingVoterId, setDeletingVoterId] = useState<string | null>(null);

  const handleAddVoter = async () => {
    if (!newVoterStudentId.trim() || !newVoterEmail.trim() || !newVoterPassword.trim()) return;
    try {
      await apiFetch("/api/voters/register", {
        method: "POST",
        body: JSON.stringify({
          studentId: newVoterStudentId.trim(),
          email: newVoterEmail.trim(),
          fullName: newVoterName.trim() || "Registered Voter",
          password: newVoterPassword.trim(),
        }),
      });
      await loadVoters();
      setNewVoterName(""); setNewVoterStudentId(""); setNewVoterEmail(""); setNewVoterPassword("");
      setIsAddVoterOpen(false);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleSaveVoterEdit = async () => {
    if (!editingVoter) return;
    if (!editVoterPassword) { setEditVoterMsg("Enter a new password."); return; }
    if (editVoterPassword !== editVoterPasswordConfirm) { setEditVoterMsg("Passwords do not match."); return; }
    if (editVoterPassword.length < 6) { setEditVoterMsg("Password must be at least 6 characters."); return; }
    setSavingVoterEdit(true);
    try {
      await apiFetch(`/api/voters/${editingVoter.id}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password: editVoterPassword }),
      });
      setEditVoterMsg("Password updated.");
      setTimeout(() => { setEditingVoter(null); setEditVoterMsg(""); setEditVoterPassword(""); setEditVoterPasswordConfirm(""); }, 1000);
    } catch (e: any) {
      setEditVoterMsg(e.message || "Failed to update.");
    } finally {
      setSavingVoterEdit(false);
    }
  };

  const handleDeleteVoter = async (voter: any) => {
    if (!confirm(`Delete voter "${voter.full_name || voter.student_id}"? This cannot be undone.`)) return;
    setDeletingVoterId(voter.id);
    try {
      await apiFetch(`/api/voters/${voter.id}`, { method: "DELETE" });
      await loadVoters();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDeletingVoterId(null);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n").filter(Boolean);
    const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const getCol = (row: string[], key: string) => { const idx = header.indexOf(key); return idx >= 0 ? row[idx]?.trim() : ""; };
    const records = lines.slice(1).map((line) => {
      const cols = line.split(",");
      return {
        studentId: getCol(cols, "studentid") || getCol(cols, "student_id"),
        email: getCol(cols, "email"),
        fullName: getCol(cols, "fullname") || getCol(cols, "full_name") || getCol(cols, "name"),
        password: getCol(cols, "password") || "changeme123",
      };
    }).filter((r) => r.studentId && r.email);
    try {
      await apiFetch("/api/voters/register", { method: "POST", body: JSON.stringify(records) });
      await loadVoters();
      setCsvUploaded(true);
    } catch (e) {
      console.error("CSV upload failed:", e);
    }
  };

  // ── Admin session error ────────────────────────────────────────────────────
  if (adminSessionValid === false) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center gap-6 p-8 text-center bg-[#F8FAFC]">
        <div className="w-20 h-20 rounded-full bg-rose-100 flex items-center justify-center">
          <AlertCircle size={40} className="text-rose-600" />
        </div>
        <div>
          <h2 className="font-['Figtree'] text-3xl font-bold text-[#0D5D56] mb-2">Admin Access Required</h2>
          <p className="text-[#0D5D56]/70 font-bold max-w-md">{adminSessionError}</p>
        </div>
        <button
          onClick={() => { localStorage.removeItem("adminEmail"); navigate("/"); }}
          className="px-8 py-3 bg-[#0D5D56] text-white rounded-full font-bold shadow-lg hover:bg-[#0D5D56]/90 transition-colors"
        >
          Clear Session &amp; Go to Login
        </button>
      </div>
    );
  }

  if (adminSessionValid === null || configLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full text-[#0D5D56] font-bold text-lg gap-3">
        <Loader2 size={24} className="animate-spin" />
        Loading election config...
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full overflow-hidden text-[#0D5D56] bg-[#F8FAFC]">

      {/* ── Top Navigation Bar ── */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-[#A7F3D0]/50 bg-white/60 backdrop-blur-md relative z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#0D5D56] text-white shadow-sm border border-[#A7F3D0]/30">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <span className="font-['Figtree'] font-bold text-2xl tracking-tight text-[#0D5D56]">{t("Admin Suite")}</span>
            {config?.election_name && (
              <p className="text-xs font-bold text-[#0D5D56]/50 -mt-0.5">{config.election_name}</p>
            )}
          </div>
        </div>

        <nav className="flex items-center bg-[#0D5D56] rounded-full p-1.5 shadow-sm">
          <NavItem label={t("Command Center")} active={currentTab === "Command Center"} onClick={() => setCurrentTab("Command Center")} />
          <NavItem label={t("Voting Methods")} active={currentTab === "Methods"} onClick={() => setCurrentTab("Methods")} />
          <NavItem label={t("Roles & Candidates")} active={currentTab === "Registry"} onClick={() => setCurrentTab("Registry")} />
          <NavItem label={t("Voters")} active={currentTab === "Voters"} onClick={() => setCurrentTab("Voters")} />
          <NavItem label={t("Security")} active={currentTab === "Security"} onClick={() => setCurrentTab("Security")} />
        </nav>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-white border border-[#A7F3D0] rounded-full p-1 shadow-sm mr-2">
            <button onClick={() => i18n.changeLanguage("en")} className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${language === "EN" ? "bg-[#0D5D56] text-[#A7F3D0]" : "text-[#0D5D56] hover:bg-[#A7F3D0]/20"}`}>EN</button>
            <button onClick={() => i18n.changeLanguage("sw")} className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${language === "KS" ? "bg-[#0D5D56] text-[#A7F3D0]" : "text-[#0D5D56] hover:bg-[#A7F3D0]/20"}`}>KS</button>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="w-10 h-10 flex items-center justify-center rounded-full transition-all shadow-sm bg-white text-[#0D5D56] hover:bg-[#A7F3D0]">
            <Settings size={18} />
          </button>
          <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#0D5D56] text-[#A7F3D0] shadow-sm border border-white font-bold text-sm">ADM</div>
          <button onClick={() => navigate("/")} className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-[#0D5D56] hover:bg-rose-50 transition-all shadow-sm">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto hide-scrollbar p-8 lg:p-12 relative z-10">
        <AnimatePresence mode="wait">

          {/* ═══════════════════════════════════════════════════════════════
              TAB 1 · COMMAND CENTER
          ═══════════════════════════════════════════════════════════════ */}
          {currentTab === "Command Center" && (
            isTallyReleased ? (
              <AdminTallyHub onReset={async () => { await loadConfig(); }} />
            ) : (
              <motion.div key="Command Center" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col h-full gap-8">

                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">Command Center</h1>
                    <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">Remote Control &amp; Live Status</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-white border border-[#A7F3D0] px-5 py-3 rounded-full shadow-sm">
                      <div className="relative flex h-3 w-3">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSealed ? "bg-emerald-400" : "bg-[#A7F3D0]"}`}></span>
                        <span className={`relative inline-flex rounded-full h-3 w-3 ${isSealed ? "bg-emerald-500" : "bg-amber-400"}`}></span>
                      </div>
                      <span className="text-sm font-bold text-[#0D5D56]">{isTallyReleased ? "Tally Released" : isSealed ? "System Locked & Live" : "Configuration Mode"}</span>
                    </div>
                    {!isSealed && (
                      <button onClick={handleSeal} className="bg-[#0D5D56] hover:bg-[#0D5D56]/90 text-white px-8 py-3 rounded-full font-bold shadow-[0_8px_20px_rgba(13,93,86,0.3)] transition-all flex items-center gap-2">
                        <Lock size={18} className="text-[#A7F3D0]" /> Seal &amp; Launch
                      </button>
                    )}
                    {isSealed && !isTallyReleased && (
                      <button onClick={triggerHomomorphicTally} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-full font-bold shadow-[0_8px_20px_rgba(16,185,129,0.3)] transition-all flex items-center gap-2">
                        <Activity size={18} /> End Ballot &amp; Tally
                      </button>
                    )}
                  </div>
                </div>

                {/* Plugin engine status bar */}
                <div className="flex items-center gap-3 bg-white border border-[#A7F3D0]/50 rounded-2xl px-6 py-4 shadow-sm w-full flex-wrap">
                  <Zap size={16} className="text-[#0D5D56]" />
                  <span className="text-sm font-bold text-[#0D5D56]/60">Plugin Engine:</span>
                  {pluginLoading ? (
                    <span className="text-sm font-bold text-amber-600 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Connecting...</span>
                  ) : pluginError ? (
                    <span className="text-sm font-bold text-rose-600 flex items-center gap-2"><AlertCircle size={14} /> {pluginError}</span>
                  ) : pluginInfo ? (
                    <span className="text-sm font-bold text-emerald-600 flex items-center gap-2"><CheckCircle2 size={14} /> Connected — Active: <span className="text-[#0D5D56] capitalize">{pluginInfo.method}</span></span>
                  ) : (
                    <span className="text-sm font-bold text-amber-600">Waiting...</span>
                  )}
                  <button onClick={loadPluginInfo} className="ml-auto text-xs font-bold text-[#0D5D56]/60 hover:text-[#0D5D56] transition-colors underline underline-offset-2">Refresh</button>
                </div>

                {/* ── NEW: Election Identity Card ── */}
                <div className="bg-white rounded-[40px] border border-[#A7F3D0]/50 p-8 shadow-sm">
                  <div className="mb-5">
                    <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] mb-1">Election Identity</h3>
                    <p className="text-sm font-bold text-[#0D5D56]/60">
                      {isSealed ? "Name and description are locked." : "Set a name and optional description for this election."}
                    </p>
                  </div>
                  {!isSealed ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <label className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest mb-2 block">Election Name <span className="text-rose-400">*</span></label>
                        <input
                          type="text"
                          value={electionName}
                          onChange={e => setElectionName(e.target.value)}
                          placeholder="e.g. KEMU 2025 Student Union Elections"
                          className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-2xl px-5 py-3.5 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] transition-colors text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest mb-2 block">Description <span className="text-[#0D5D56]/30">(optional)</span></label>
                        <textarea
                          value={electionDescription}
                          onChange={e => setElectionDescription(e.target.value)}
                          placeholder="Brief description of the election purpose, scope, or instructions for voters…"
                          rows={3}
                          className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-2xl px-5 py-3.5 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] transition-colors text-sm resize-none"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={saveElectionMeta}
                          disabled={savingMeta || !electionName.trim()}
                          className="bg-[#0D5D56] text-[#A7F3D0] px-6 py-2.5 rounded-full font-bold text-sm shadow-md hover:bg-[#0D5D56]/90 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          {savingMeta ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          Save
                        </button>
                        {metaSaved && (
                          <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5"><CheckCircle2 size={13} /> Saved!</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start gap-3 bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-5 py-4">
                        <span className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest w-20 shrink-0 mt-0.5">Name</span>
                        <span className="font-bold text-[#0D5D56]">{config?.election_name || "—"}</span>
                      </div>
                      {config?.election_description && (
                        <div className="flex items-start gap-3 bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-5 py-4">
                          <span className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest w-20 shrink-0 mt-0.5">Desc.</span>
                          <span className="text-sm font-bold text-[#0D5D56]/70">{config.election_description}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Election Timeline Card */}
                <div className="bg-white rounded-[40px] border border-[#A7F3D0]/50 p-8 shadow-sm relative overflow-visible">
                  <div className="mb-4">
                    <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] mb-1">Election Timeline</h3>
                    <p className="text-sm font-bold text-[#0D5D56]/60">
                      {isSealed ? "Timeline is locked. Dates shown in your local time." : "Set when voting opens and closes. All times in your local timezone."}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Start Date */}
                    <div className="relative">
                      <p className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest mb-2">Voting Opens</p>
                      {!isSealed ? (
                        <div className="relative">
                          <button onClick={() => { setShowStartPicker(!showStartPicker); setShowEndPicker(false); }} className={`w-full flex items-center justify-between gap-3 bg-[#F8FAFC] border-2 ${electionStartDate ? "border-[#0D5D56]" : "border-[#A7F3D0]"} text-[#0D5D56] font-bold rounded-2xl px-5 py-4 text-sm hover:border-[#0D5D56] transition-colors`}>
                            <div className="flex items-center gap-3">
                              <Calendar size={18} className="text-[#0D5D56]/60 shrink-0" />
                              <span className={electionStartDate ? "text-[#0D5D56]" : "text-[#0D5D56]/40"}>
                                {electionStartDate ? new Date(electionStartDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Pick start date & time"}
                              </span>
                            </div>
                            <ChevronDown size={16} className={`text-[#0D5D56]/50 transition-transform ${showStartPicker ? "rotate-180" : ""}`} />
                          </button>
                          {showStartPicker && (
                            <div className="absolute top-full mt-2 left-0 z-50 bg-white border-2 border-[#A7F3D0] rounded-[24px] shadow-2xl p-5 min-w-[300px]">
                              <p className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest mb-3">Start Date &amp; Time (Local)</p>
                              <input
                                type="datetime-local"
                                value={electionStartDate}
                                min={utcToLocal(new Date().toISOString())}
                                onChange={(e) => patchConfig({ startDate: localToUtc(e.target.value) })}
                                className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] text-[#0D5D56] font-bold rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#0D5D56] transition-colors mb-3"
                              />
                              <button onClick={() => setShowStartPicker(false)} className="w-full bg-[#0D5D56] text-white py-2.5 rounded-xl font-bold text-sm hover:bg-[#0D5D56]/90 transition-colors flex items-center justify-center gap-2">
                                <CheckCircle2 size={14} className="text-[#A7F3D0]" /> Confirm
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-5 py-4">
                          <Calendar size={18} className="text-[#0D5D56]/50 shrink-0" />
                          <span className="text-sm font-bold text-[#0D5D56]">{electionStartDate ? new Date(electionStartDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span>
                        </div>
                      )}
                    </div>
                    {/* End Date */}
                    <div className="relative">
                      <p className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest mb-2">Voting Closes</p>
                      {!isSealed ? (
                        <div className="relative">
                          <button onClick={() => { setShowEndPicker(!showEndPicker); setShowStartPicker(false); }} className={`w-full flex items-center justify-between gap-3 bg-[#F8FAFC] border-2 ${electionEndDate ? "border-[#0D5D56]" : "border-[#A7F3D0]"} text-[#0D5D56] font-bold rounded-2xl px-5 py-4 text-sm hover:border-[#0D5D56] transition-colors`}>
                            <div className="flex items-center gap-3">
                              <Clock size={18} className="text-[#0D5D56]/60 shrink-0" />
                              <span className={electionEndDate ? "text-[#0D5D56]" : "text-[#0D5D56]/40"}>
                                {electionEndDate ? new Date(electionEndDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Pick end date & time"}
                              </span>
                            </div>
                            <ChevronDown size={16} className={`text-[#0D5D56]/50 transition-transform ${showEndPicker ? "rotate-180" : ""}`} />
                          </button>
                          {showEndPicker && (
                            <div className="absolute top-full mt-2 left-0 z-50 bg-white border-2 border-[#A7F3D0] rounded-[24px] shadow-2xl p-5 min-w-[300px]">
                              <p className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-widest mb-3">End Date &amp; Time (Local)</p>
                              <input
                                type="datetime-local"
                                value={electionEndDate}
                                min={electionStartDate || utcToLocal(new Date().toISOString())}
                                onChange={(e) => patchConfig({ endDate: localToUtc(e.target.value) })}
                                className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] text-[#0D5D56] font-bold rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#0D5D56] transition-colors mb-3"
                              />
                              <button onClick={() => setShowEndPicker(false)} className="w-full bg-[#0D5D56] text-white py-2.5 rounded-xl font-bold text-sm hover:bg-[#0D5D56]/90 transition-colors flex items-center justify-center gap-2">
                                <CheckCircle2 size={14} className="text-[#A7F3D0]" /> Confirm
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-5 py-4">
                          <Clock size={18} className="text-[#0D5D56]/50 shrink-0" />
                          <span className="text-sm font-bold text-[#0D5D56]">{electionEndDate ? new Date(electionEndDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {!isSealed && electionStartDate && electionEndDate && new Date(electionEndDate) <= new Date(electionStartDate) && (
                    <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 px-5 py-3 rounded-2xl text-xs font-bold flex items-center gap-2"><Clock size={14} /> End date must be after start date.</div>
                  )}
                  {!isSealed && electionStartDate && electionEndDate && new Date(electionEndDate) > new Date(electionStartDate) && (
                    <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-5 py-3 rounded-2xl text-xs font-bold flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> Timeline saved. Voters will see a countdown during the election window.</div>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full min-h-[500px]">
                  {/* Department Elections */}
                  <div className="bg-white rounded-[40px] border border-[#A7F3D0]/50 p-8 shadow-sm flex flex-col relative overflow-hidden">
                    <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] mb-6">Department Elections</h3>
                    <div className="flex-1 flex flex-col gap-3 overflow-y-auto hide-scrollbar">
                      {deptList.map((dept) => {
                        const deptSealed = dept.is_sealed === true;
                        const deptTallied = dept.is_tally_released === true;
                        return (
                          <div key={dept.id} onClick={() => setActiveDeptId(dept.id)} className={`rounded-[24px] p-4 border-2 cursor-pointer transition-all ${activeDeptId === dept.id ? "border-[#0D5D56] bg-[#F8FAFC]" : "border-[#A7F3D0]/50 hover:border-[#0D5D56]/30"}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <p className="font-bold text-[#0D5D56] text-sm">{dept.name}</p>
                                <p className="text-xs text-[#0D5D56]/50 font-bold truncate max-w-[220px]">{dept.full_name}</p>
                              </div>
                              <span className={`text-xs font-bold px-3 py-1 rounded-full border ${deptTallied ? "bg-emerald-50 border-emerald-200 text-emerald-700" : deptSealed ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                                {deptTallied ? "Tallied" : deptSealed ? "Live" : "Config"}
                              </span>
                            </div>
                            {/* ── FIX: Corrected dept button logic ── */}
                            <div className="flex gap-2 mt-2">
                              {!deptSealed && !deptTallied && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateDeptState(dept.id, { isSealed: true });
                                  }}
                                  className="flex-1 py-1.5 text-xs font-bold rounded-xl bg-[#0D5D56] text-white hover:bg-[#0D5D56]/90 transition-colors"
                                >
                                  Seal &amp; Launch
                                </button>
                              )}
                              {deptSealed && !deptTallied && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // ── FIX: Only tally this department, not the global election ──
                                      updateDeptState(dept.id, { isTallyReleased: true });
                                    }}
                                    className="flex-1 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                                  >
                                    End &amp; Tally
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Allow unsealing if no votes yet
                                      updateDeptState(dept.id, { isSealed: false });
                                    }}
                                    className="py-1.5 px-3 text-xs font-bold rounded-xl bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100 transition-colors"
                                  >
                                    Unseal
                                  </button>
                                </>
                              )}
                              {deptTallied && (
                                <span className="flex-1 py-1.5 text-xs font-bold rounded-xl bg-emerald-50 text-emerald-700 text-center border border-emerald-200">Results Released</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {deptList.length === 0 && (
                        <p className="text-[#0D5D56]/40 text-sm font-bold text-center py-8">No departments configured yet.</p>
                      )}
                    </div>
                    {!isSealed && deptList.length > 0 && (
                      <button onClick={handleSealAll} className="mt-4 w-full py-3 rounded-[20px] bg-[#0D5D56] text-[#A7F3D0] font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#0D5D56]/90 transition-colors shadow-md border border-[#A7F3D0]/20">
                        <Lock size={16} /> Seal &amp; Launch All Elections
                      </button>
                    )}
                  </div>

                  {/* System Global Overview */}
                  <div className="bg-[#0D5D56] rounded-[40px] shadow-xl p-8 flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-[#A7F3D0] rounded-full blur-[100px] opacity-10 pointer-events-none" />
                    <div className="flex items-center gap-3 mb-8 relative z-10">
                      <Activity className="w-6 h-6 text-[#A7F3D0]" />
                      <h3 className="font-['Figtree'] text-2xl font-bold text-white">System Global Overview</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-4 relative z-10 mb-4">
                      <div className="bg-white/10 border border-white/20 rounded-[24px] p-5 backdrop-blur-md">
                        <p className="text-white/70 text-sm font-medium mb-1">Total Verified Voters</p>
                        <p className="text-3xl font-bold text-[#A7F3D0]">{voterTotal.toLocaleString()}</p>
                      </div>
                      <div className="bg-white/10 border border-white/20 rounded-[24px] p-5 backdrop-blur-md">
                        <p className="text-white/70 text-sm font-medium mb-1">Envelopes Sealed</p>
                        <motion.p key={envelopeCount} initial={{ scale: 1.2 }} animate={{ scale: 1 }} className="text-3xl font-bold text-[#A7F3D0]">{isSealed ? envelopeCount : 0}</motion.p>
                      </div>
                      <div className="bg-white/10 border border-white/20 rounded-[24px] p-5 backdrop-blur-md col-span-2">
                        <p className="text-white/70 text-sm font-medium mb-1">Encryption Protocol</p>
                        <p className="text-xl font-bold text-white flex items-center gap-2">
                          <ShieldCheck size={20} className="text-[#A7F3D0]" /> Double Shield (Zero Knowledge)
                        </p>
                      </div>
                    </div>
                    {isSealed && (
                      <div className="relative z-10 bg-white/5 border border-white/10 rounded-[20px] p-4 flex-1">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <p className="text-[#A7F3D0] text-xs font-bold uppercase tracking-widest">Live Ballot Feed</p>
                        </div>
                        <div className="space-y-2 overflow-hidden max-h-[160px]">
                          <AnimatePresence>
                            {ballotFeed.length === 0 ? (
                              <p className="text-white/40 text-xs font-bold text-center py-4">Awaiting first ballot...</p>
                            ) : (
                              ballotFeed.map((b, idx) => (
                                <motion.div key={b.id + b.time + idx} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center justify-between py-1.5 border-b border-white/10 last:border-0">
                                  <span className="text-[#A7F3D0] text-xs font-bold">{b.id}</span>
                                  <span className="text-white/40 text-xs font-mono">{b.token}</span>
                                  <span className="text-white/50 text-xs">{b.time}</span>
                                  <span className="bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">Sealed</span>
                                </motion.div>
                              ))
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB 2 · VOTING METHODS
          ═══════════════════════════════════════════════════════════════ */}
          {currentTab === "Methods" && (
            <motion.div key="Methods" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col h-full gap-8">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">{t("Voting Methods Factory")}</h1>
                  <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">{t("Select a method — the Python plugin activates immediately on the tally engine.")}</p>
                </div>
                {isSealed && (
                  <div className="bg-amber-100 px-6 py-3 rounded-full border border-amber-300 text-amber-800 font-bold shadow-sm flex items-center gap-2">
                    <Lock size={16} /> Method Locked (Election Sealed)
                  </div>
                )}
              </div>
              <div className="bg-white border border-[#A7F3D0]/50 rounded-[24px] px-6 py-4 shadow-sm flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${pluginError ? "bg-rose-500" : pluginLoading ? "bg-amber-400 animate-pulse" : pluginInfo ? "bg-emerald-500" : "bg-gray-400"}`} />
                  <span className="text-xs font-bold text-[#0D5D56]/60 uppercase tracking-wider">Plugin Engine</span>
                  {pluginLoading && <Loader2 size={12} className="animate-spin text-[#0D5D56]/40" />}
                </div>
                {pluginInfo && !pluginError && (
                  <>
                    <span className="text-xs font-bold text-[#0D5D56] bg-[#A7F3D0]/30 px-3 py-1 rounded-full border border-[#A7F3D0] capitalize">Active: <span className="text-[#0D5D56]">{pluginInfo.method}</span></span>
                    <span className="text-xs font-bold text-[#0D5D56]/60">Ballot type: <span className="text-[#0D5D56]">{pluginInfo.ballot_structure.type}</span></span>
                  </>
                )}
                {pluginError && <span className="text-xs font-bold text-rose-600 flex items-center gap-1"><AlertCircle size={12} /> {pluginError}</span>}
                {lastSwitchLog && (
                  <span className="text-xs font-bold text-[#0D5D56]/50 ml-auto">Last switch: <span className="text-[#0D5D56] capitalize">{lastSwitchLog.from}</span> → <span className="text-[#0D5D56] capitalize">{lastSwitchLog.to}</span> at {lastSwitchLog.ts}</span>
                )}
                <button onClick={loadPluginInfo} className="ml-auto text-xs font-bold text-[#0D5D56]/60 hover:text-[#0D5D56] transition-colors underline underline-offset-2">Refresh</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 content-start">
                {METHODS.map((method) => {
                  const isActive = votingMethod === method.id;
                  const isEngineActive = pluginInfo?.method === method.id;
                  return (
                    <motion.div key={method.id} layout className={`bg-white rounded-[32px] border-2 p-6 flex flex-col relative overflow-hidden transition-all shadow-sm ${isActive ? "border-[#0D5D56] shadow-[0_4px_20px_rgba(13,93,86,0.12)]" : "border-[#A7F3D0]/50 hover:border-[#0D5D56]/30"}`}>
                      <div className="flex justify-between items-start mb-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border-2 text-xl font-black ${isActive ? "bg-[#0D5D56] text-[#A7F3D0] border-[#0D5D56]" : "bg-[#F8FAFC] text-[#0D5D56] border-[#A7F3D0]"}`}>{method.icon}</div>
                        {isActive && <div className="bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 border border-emerald-300"><CheckCircle2 size={12} className="text-emerald-600" /> Active</div>}
                      </div>
                      <h3 className="font-['Figtree'] text-xl font-bold text-[#0D5D56] mb-1">{method.name}</h3>
                      <p className="text-xs font-bold text-[#0D5D56]/50 mb-3 uppercase tracking-wide">{method.label}</p>
                      <p className="text-sm font-bold text-[#0D5D56]/60 mb-6 min-h-[60px] leading-relaxed">{t(method.desc)}</p>
                      <div className="bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-4 py-3 mb-5 flex items-start gap-2">
                        <Info size={13} className="text-[#0D5D56]/50 mt-0.5 shrink-0" />
                        <p className="text-[10px] font-bold text-[#0D5D56]/60 leading-relaxed">{isActive && pluginInfo ? pluginInfo.ballot_structure.description : method.voterUiDesc}</p>
                      </div>
                      <div className={`flex items-center gap-1.5 text-[10px] font-bold mb-5 ${isEngineActive ? "text-emerald-600" : "text-[#0D5D56]/30"}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${isEngineActive ? "bg-emerald-500" : "bg-[#0D5D56]/20"}`} />
                        {isEngineActive ? "Python plugin loaded in engine" : "Not loaded in engine"}
                      </div>
                      <div className="flex flex-col gap-3 mt-auto relative z-10">
                        <button onClick={() => handleSelectMethod(method.id)} disabled={isSealed || switchingMethod || !!pluginError} className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all border-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${isActive ? "bg-[#0D5D56] text-white border-[#0D5D56] shadow-md" : "bg-white text-[#0D5D56] border-[#0D5D56] hover:bg-[#0D5D56]/5"}`}>
                          {switchingMethod && isActive ? <><Loader2 size={14} className="animate-spin" /> Switching...</> : isActive ? <><Check size={16} /> Selected</> : "Activate Plugin"}
                        </button>
                        <button onClick={() => setPreviewMethod(method.id)} className="w-full py-3.5 rounded-xl font-bold text-sm text-[#0D5D56] hover:bg-[#F8FAFC] transition-colors border border-transparent hover:border-[#A7F3D0]/50 flex items-center justify-center gap-2">
                          <Eye size={16} /> Preview Voter Interface
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              {pluginInfo && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[#0D5D56] rounded-[32px] p-8 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-[#A7F3D0] rounded-full blur-[80px] opacity-10 pointer-events-none" />
                  <div className="flex items-center gap-3 mb-6 relative z-10">
                    <Database size={20} className="text-[#A7F3D0]" />
                    <h3 className="font-['Figtree'] text-xl font-bold text-white">Active Ballot Schema — <span className="text-[#A7F3D0] capitalize">{pluginInfo.method}</span> plugin</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
                    {Object.entries(pluginInfo.ballot_structure.fields).map(([fieldName, fieldDef]) => (
                      <div key={fieldName} className="bg-white/10 border border-white/20 rounded-2xl p-4 backdrop-blur-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[#A7F3D0] font-bold text-sm font-mono">{fieldName}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${fieldDef.required ? "bg-rose-500/20 border-rose-400/40 text-rose-300" : "bg-white/10 border-white/20 text-white/50"}`}>{fieldDef.required ? "required" : "optional"}</span>
                        </div>
                        <p className="text-white/50 text-xs font-bold mb-1">type: <span className="text-white/80">{fieldDef.type}</span></p>
                        {fieldDef.enum && <p className="text-white/50 text-xs font-bold mb-1">enum: <span className="text-[#A7F3D0]">{fieldDef.enum.join(" | ")}</span></p>}
                        {fieldDef.default !== undefined && <p className="text-white/50 text-xs font-bold mb-1">default: <span className="text-white/80">{String(fieldDef.default)}</span></p>}
                        <p className="text-white/40 text-[10px] mt-2 leading-relaxed">{fieldDef.description}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* TAB 3 · REGISTRY */}
          {currentTab === "Registry" && <AdminRegistry isSealed={isSealed} />}

          {/* ═══════════════════════════════════════════════════════════════
              TAB 4 · VOTERS
          ═══════════════════════════════════════════════════════════════ */}
          {currentTab === "Voters" && (
            <motion.div key="Voters" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col h-full gap-8">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">Voter Registry</h1>
                  <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">Identity &amp; Access Control Ledger</p>
                </div>
                {isSealed && (
                  <div className="bg-amber-100 px-6 py-3 rounded-full border border-amber-300 text-amber-800 font-bold shadow-sm flex items-center gap-2">
                    <Lock size={16} /> Registry is Sealed (Read-Only)
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-4 flex flex-col gap-6">
                  <div className={`bg-white rounded-[40px] border-2 border-dashed ${csvUploaded ? "border-[#10B981] bg-emerald-50" : "border-[#A7F3D0]"} p-8 text-center flex flex-col items-center justify-center relative overflow-hidden transition-all h-[280px]`}>
                    {isSealed && <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10" />}
                    {!csvUploaded ? (
                      <>
                        <div className="w-16 h-16 bg-[#F8FAFC] rounded-full flex items-center justify-center text-[#0D5D56] shadow-sm mb-4 border border-[#A7F3D0]"><FileDown size={28} /></div>
                        <h3 className="font-bold text-[#0D5D56] text-xl mb-2">Bulk Upload (CSV)</h3>
                        <p className="text-sm font-bold text-[#0D5D56]/60 px-4 mb-6">Upload a CSV with columns: studentId, email, fullName, password</p>
                        <label className="bg-[#0D5D56] text-white px-6 py-2.5 rounded-full font-bold shadow-md hover:bg-[#0D5D56]/90 transition-colors flex items-center gap-2 cursor-pointer">
                          <Upload size={16} className="text-[#A7F3D0]" /> Select File
                          <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                        </label>
                      </>
                    ) : (
                      <>
                        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-4 border-4 border-white shadow-sm"><Check size={40} strokeWidth={3} /></div>
                        <h3 className="font-bold text-emerald-800 text-xl mb-1">Upload Successful</h3>
                        <p className="text-sm font-bold text-emerald-600/80">{voterTotal} voters loaded.</p>
                      </>
                    )}
                  </div>
                  <div className="bg-white rounded-[32px] border border-[#A7F3D0]/50 p-6 shadow-sm relative">
                    {isSealed && <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 rounded-[32px]" />}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2"><ShieldCheck size={20} className="text-[#0D5D56]" /><h4 className="font-bold text-[#0D5D56] text-lg">The Gatekeeper</h4></div>
                      <button onClick={() => setManualRegEnabled(!manualRegEnabled)} className={`transition-colors ${manualRegEnabled ? "text-emerald-500" : "text-slate-400"}`}>
                        {manualRegEnabled ? <ToggleRight size={36} /> : <ToggleLeft size={36} />}
                      </button>
                    </div>
                    <p className="text-sm font-bold text-[#0D5D56]/70 mb-3">Manual Registration Mode</p>
                    {!manualRegEnabled ? (
                      <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2"><Lock size={14} /> System Restricted: Public sign-up is locked.</div>
                    ) : (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2"><CheckCircle2 size={14} /> Active: Manual table entries permitted.</div>
                    )}
                  </div>
                </div>

                {/* ── FIX: Voter table with edit + delete icons ── */}
                <div className="lg:col-span-8 bg-white rounded-[40px] border border-[#A7F3D0]/50 p-8 shadow-sm relative overflow-hidden flex flex-col h-full min-h-[500px]">
                  {isSealed && <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-20" />}
                  <div className="flex justify-between items-center mb-6 relative z-10">
                    <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56]">Verification Status Ledger</h3>
                    {manualRegEnabled && !isSealed && (
                      <button onClick={() => setIsAddVoterOpen(true)} className="bg-[#0D5D56] text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md hover:bg-[#0D5D56]/90 transition-colors flex items-center gap-2"><Plus size={16} /> Add Voter</button>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto hide-scrollbar relative z-10 border border-[#A7F3D0]/30 rounded-[24px]">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#F8FAFC] sticky top-0 z-10">
                        <tr>
                          {["Name", "Student ID", "Department", "Status", "Actions"].map((h) => (
                            <th key={h} className="px-5 py-4 text-xs font-bold text-[#0D5D56] uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#A7F3D0]/30">
                        {voterList.length === 0 ? (
                          <tr><td colSpan={5} className="px-6 py-8 text-center text-sm font-bold text-[#0D5D56]/40">No voters registered yet.</td></tr>
                        ) : voterList.map((voter) => (
                          <tr key={voter.id} className="hover:bg-[#F8FAFC] transition-colors group">
                            <td className="px-5 py-3.5 whitespace-nowrap text-sm font-bold text-[#0D5D56]">{voter.full_name || "—"}</td>
                            <td className="px-5 py-3.5 whitespace-nowrap text-sm font-bold text-[#0D5D56]/70">{voter.student_id}</td>
                            <td className="px-5 py-3.5 whitespace-nowrap text-sm font-bold text-[#0D5D56]/60">{voter.department_name || "—"}</td>
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold shadow-sm">
                                <Shield size={12} className="fill-emerald-200" /> {voter.has_voted ? "Voted" : "Verified"}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {/* Edit / change password */}
                                <button
                                  onClick={() => { setEditingVoter(voter); setEditVoterPassword(""); setEditVoterPasswordConfirm(""); setEditVoterMsg(""); }}
                                  className="w-8 h-8 rounded-full bg-white border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-emerald-50 hover:border-emerald-300 shadow-sm transition-all"
                                  title="Change password"
                                >
                                  <KeyRound size={13} />
                                </button>
                                {/* Delete */}
                                <button
                                  onClick={() => handleDeleteVoter(voter)}
                                  disabled={deletingVoterId === voter.id}
                                  className="w-8 h-8 rounded-full bg-white border border-rose-200 flex items-center justify-center text-rose-500 hover:bg-rose-50 shadow-sm transition-all disabled:opacity-40"
                                  title="Delete voter"
                                >
                                  {deletingVoterId === voter.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB 5 · SECURITY  (now includes the Graceful Degradation panel)
          ═══════════════════════════════════════════════════════════════ */}
          {currentTab === "Security" && (
            <motion.div key="Security" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col h-full gap-8">
              <div>
                <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">Security &amp; Resilience Vault</h1>
                <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">Visualizing Enterprise Architecture</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-4 flex flex-col gap-6">
                  <div className="bg-[#0D5D56] rounded-[32px] p-6 text-white shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#A7F3D0] rounded-full blur-[80px] opacity-20 pointer-events-none" />
                    <h3 className="font-bold text-lg mb-1 relative z-10 flex items-center gap-2"><Activity size={18} className="text-[#A7F3D0]" /> WAL Consistency</h3>
                    <p className="text-white/60 text-xs font-bold mb-6 relative z-10">Real-time Write-Ahead Log Heartbeat</p>
                    <div className="h-24 w-full flex items-center justify-center relative z-10">
                      <div className="flex items-center gap-1 h-full">
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map((bar) => (
                          <motion.div key={bar} animate={{ height: ["20%", "80%", "20%"] }} transition={{ repeat: Infinity, duration: 1.5, delay: bar * 0.1, ease: "easeInOut" }} className="w-2 bg-[#A7F3D0] rounded-full" />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ═══════════════════════════════════════════════════════
                      NEW: Graceful Degradation Protocol panel
                      Simulates each failure type and recovers the ballot box
                      via the Node gateway → Plugin Engine (/api/recovery/*).
                  ═══════════════════════════════════════════════════════ */}
                  <div className="bg-white rounded-[32px] border border-[#A7F3D0]/50 p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap size={18} className="text-[#0D5D56]" />
                      <h3 className="font-bold text-[#0D5D56] text-lg">Graceful Degradation</h3>
                    </div>
                    <p className="text-[#0D5D56]/60 text-xs font-bold mb-5">
                      Simulate a failure and recover the ballot box. Generates a cryptography-free integrity proof.
                    </p>

                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {FAILURE_TYPES.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => runRecovery(f.id)}
                          disabled={recoveryRunning !== null}
                          title={f.desc}
                          className="flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-2xl border-2 border-[#A7F3D0]/60 text-left hover:border-[#0D5D56] transition-colors disabled:opacity-50 bg-[#F8FAFC]"
                        >
                          <span className="text-[11px] font-bold text-[#0D5D56] flex items-center gap-1.5">
                            {recoveryRunning === f.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RotateCcw size={12} className="text-[#0D5D56]/50" />
                            )}
                            {f.label}
                          </span>
                          <span className="text-[9px] font-bold text-[#0D5D56]/45">{f.desc}</span>
                        </button>
                      ))}
                    </div>

                    <AnimatePresence>
                      {recoveryResult && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-3"
                        >
                          <div className="flex items-center gap-2 mb-2 text-emerald-700 font-bold text-sm">
                            <CheckCircle2 size={15} /> Recovered — {recoveryResult.failure_type}
                          </div>
                          <div className="space-y-1 text-xs font-bold text-emerald-800/80">
                            {typeof recoveryResult.recovery?.votes_recovered === "number" && (
                              <p>Votes recovered: {recoveryResult.recovery.votes_recovered}</p>
                            )}
                            {typeof recoveryResult.recovery?.aof_votes_merged === "number" && (
                              <p>AOF votes merged: {recoveryResult.recovery.aof_votes_merged}</p>
                            )}
                            {typeof recoveryResult.recovery?.pending_votes_flushed === "number" && (
                              <p>Pending flushed: {recoveryResult.recovery.pending_votes_flushed}</p>
                            )}
                            {recoveryResult.recovery?.recovery_latency_sec != null && (
                              <p>Latency: {recoveryResult.recovery.recovery_latency_sec}s</p>
                            )}
                            {recoveryResult.recovery?.integrity_hash && (
                              <p className="font-mono break-all text-[10px] text-emerald-700/70">
                                hash: {String(recoveryResult.recovery.integrity_hash).slice(0, 32)}…
                              </p>
                            )}
                            {recoveryResult.recovery?.note && <p className="italic">{recoveryResult.recovery.note}</p>}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {recoveryError && (
                      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 mb-3 flex items-center gap-2 text-rose-700 font-bold text-xs">
                        <XCircle size={14} className="shrink-0" /> {recoveryError}
                      </div>
                    )}

                    <button
                      onClick={fetchRecoveryReport}
                      disabled={loadingRecoveryReport}
                      className="w-full py-2.5 rounded-2xl bg-[#0D5D56] text-[#A7F3D0] font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#0D5D56]/90 transition-colors disabled:opacity-60"
                    >
                      {loadingRecoveryReport ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                      Generate Integrity Audit Report
                    </button>

                    <AnimatePresence>
                      {recoveryReport && (
                        <motion.pre
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-3 bg-[#0D5D56] text-[#A7F3D0] rounded-2xl p-4 text-[10px] font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed"
                        >
                          {recoveryReport}
                        </motion.pre>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="bg-white rounded-[32px] border border-[#A7F3D0]/50 p-6 shadow-sm">
                    <h3 className="font-bold text-[#0D5D56] text-lg mb-1 flex items-center gap-2"><Database size={18} /> Persistence Sync</h3>
                    <p className="text-[#0D5D56]/60 text-xs font-bold mb-6">Disaster Recovery Logic</p>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-[#0D5D56]">Database Nodes</span>
                      <span className="text-sm font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">3/3 Active &amp; Synced</span>
                    </div>
                    <div className="flex gap-2 h-12">
                      {[1,2,3].map((n) => (
                        <div key={n} className="flex-1 bg-emerald-100 rounded-xl border-2 border-emerald-400 flex items-center justify-center shadow-inner"><Server size={16} className="text-emerald-600" /></div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white rounded-[32px] border border-[#A7F3D0]/50 p-6 shadow-sm">
                    <h3 className="font-bold text-[#0D5D56] text-lg mb-1 flex items-center gap-2"><Network size={18} /> Temporal Equalization</h3>
                    <p className="text-[#0D5D56]/60 text-xs font-bold mb-6">Timing Attack Mitigation</p>
                    <div className="bg-[#F8FAFC] border border-[#A7F3D0] rounded-xl p-4 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-[#0D5D56] text-[#A7F3D0] flex items-center justify-center font-bold text-lg shadow-inner shrink-0">15s</div>
                      <p className="text-sm font-bold text-[#0D5D56] leading-snug">Standard 15s Dwell Time Enforced on all Submissions.</p>
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-8 bg-[#F8FAFC] rounded-[40px] border border-[#A7F3D0]/50 shadow-inner p-8 relative overflow-hidden flex flex-col h-full min-h-[500px]">
                  <div className="flex justify-between items-center mb-8 relative z-10">
                    <div>
                      <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] flex items-center gap-2"><ShieldCheck className="text-[#0D5D56]" /> The Anonymous Vault</h3>
                      <p className="text-sm font-bold text-[#0D5D56]/60 mt-1">Strict Security: No names or hashes visible.</p>
                    </div>
                    <div className="px-4 py-2 bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-full text-xs font-bold shadow-sm flex items-center gap-2"><CheckCircle2 size={14} className="fill-emerald-200" /> ZKP Active</div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 relative z-10 flex-1 content-start">
                    {(isSealed ? ballotFeed : []).slice(0, 8).map((b, env) => (
                      <div key={env} className="bg-white border border-[#A7F3D0] rounded-2xl p-4 flex flex-col items-center justify-center shadow-sm hover:shadow-md transition-shadow relative group">
                        <div className="w-16 h-12 bg-slate-100 border-2 border-slate-200 rounded-lg flex items-center justify-center mb-3 relative overflow-hidden group-hover:border-[#A7F3D0] transition-colors">
                          <div className="absolute top-0 w-0 h-0 border-l-[30px] border-r-[30px] border-t-[20px] border-l-transparent border-r-transparent border-t-slate-300 group-hover:border-t-[#A7F3D0] transition-colors" />
                          <Lock size={14} className="text-[#0D5D56]/40 relative z-10" />
                        </div>
                        <span className="text-[10px] font-bold text-[#0D5D56] text-center">Encrypted Envelope<br />[{b.time}]</span>
                        <div className="flex items-center gap-1 mt-2 text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-1 rounded-md"><ShieldCheck size={12} className="fill-emerald-100" /> ZKP Verified</div>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, 8 - (isSealed ? Math.min(ballotFeed.length, 8) : 0)) }).map((_, i) => (
                      <div key={`empty_${i}`} className="bg-white/50 border-2 border-dashed border-[#A7F3D0]/50 rounded-2xl p-4 flex flex-col items-center justify-center h-[120px]">
                        <Activity size={24} className="text-[#A7F3D0] mb-2" />
                        <span className="text-[10px] font-bold text-[#0D5D56]/50 uppercase tracking-widest text-center">Awaiting<br />Ingestion</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ── Homomorphic Tally Animation ── */}
      <AnimatePresence>
        {showHomomorphic && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0D5D56]/90 backdrop-blur-sm p-6">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-xl bg-[#0D5D56] border border-[#A7F3D0]/30 rounded-[40px] p-10 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-[#A7F3D0] rounded-full blur-[100px] opacity-10 pointer-events-none" />
              <div className="flex items-center gap-3 mb-6 relative z-10">
                <div className="w-2 h-2 rounded-full bg-[#A7F3D0] animate-pulse" />
                <h2 className="font-['Figtree'] text-2xl font-bold text-white">Homomorphic Tallying — In Progress</h2>
              </div>
              <p className="text-[#A7F3D0]/70 text-sm font-bold mb-6 relative z-10">Combining {envelopeCount} encrypted ballots without decrypting any individual vote...</p>
              <div className="space-y-3 relative z-10 mb-6">
                {["Enc(1) × Enc(0) = Enc(1)", "Enc(1) × Enc(1) = Enc(2)", "Enc(2) × Enc(0) = Enc(2)", "Enc(2) × Enc(1) = Enc(3)", "Enc(3) × Enc(1) = Enc(4)", "Final ciphertext: Enc(total) = 8234987234918723...", "No individual ballot was decrypted at any step."].map((line, i) => (
                  <AnimatePresence key={i}>
                    {homomorphicStep > i && (
                      <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-3">
                        <CheckCircle2 size={16} className="text-[#A7F3D0] shrink-0 mt-0.5" />
                        <p className={`text-sm font-mono ${i === 5 ? "text-[#A7F3D0] font-bold" : i === 6 ? "text-white/60 italic" : "text-white/80"}`}>{i < 5 ? `Step ${i + 1}:  ${line}` : line}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add Voter Modal ── */}
      <AnimatePresence>
        {isAddVoterOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0D5D56]/40 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }} className="bg-white border border-[#A7F3D0] shadow-2xl rounded-[32px] w-full max-w-sm p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56]">Register Voter</h3>
                <button onClick={() => setIsAddVoterOpen(false)} className="w-8 h-8 rounded-full bg-[#F8FAFC] border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-rose-50 transition-colors"><X size={15} /></button>
              </div>
              <div className="space-y-4">
                {[
                  { label: "Full Name", value: newVoterName, set: setNewVoterName, placeholder: "e.g. Jane Doe", type: "text" },
                  { label: "Student ID", value: newVoterStudentId, set: setNewVoterStudentId, placeholder: "e.g. SCT212-0001/2024", type: "text" },
                  { label: "Email", value: newVoterEmail, set: setNewVoterEmail, placeholder: "e.g. jane@example.com", type: "email" },
                  { label: "Password", value: newVoterPassword, set: setNewVoterPassword, placeholder: "Min 6 characters", type: "password" },
                ].map(({ label, value, set, placeholder, type }) => (
                  <div key={label}>
                    <label className="text-xs font-bold text-[#0D5D56] uppercase tracking-widest mb-2 block">{label}</label>
                    <input type={type} placeholder={placeholder} value={value} onChange={(e) => set(e.target.value)} className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-xl px-4 py-3 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] text-sm" />
                  </div>
                ))}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setIsAddVoterOpen(false)} className="flex-1 py-3 rounded-xl font-bold text-[#0D5D56] bg-slate-100 hover:bg-slate-200 transition-colors text-sm">Cancel</button>
                  <button onClick={handleAddVoter} className="flex-1 py-3 rounded-xl font-bold text-white bg-[#0D5D56] hover:bg-[#0D5D56]/90 transition-colors text-sm">Register</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Edit Voter Password Modal ── */}
      <AnimatePresence>
        {editingVoter && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0D5D56]/40 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }} className="bg-white border border-[#A7F3D0] shadow-2xl rounded-[32px] w-full max-w-sm p-8">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56]">Change Password</h3>
                <button onClick={() => { setEditingVoter(null); setEditVoterMsg(""); }} className="w-8 h-8 rounded-full bg-[#F8FAFC] border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-rose-50 transition-colors"><X size={15} /></button>
              </div>
              <p className="text-xs font-bold text-[#0D5D56]/50 mb-6">Voter: <span className="text-[#0D5D56]">{editingVoter.full_name || editingVoter.student_id}</span></p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-[#0D5D56] uppercase tracking-widest mb-2 block">New Password</label>
                  <input type="password" placeholder="Min 6 characters" value={editVoterPassword} onChange={e => setEditVoterPassword(e.target.value)} className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-xl px-4 py-3 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0D5D56] uppercase tracking-widest mb-2 block">Confirm Password</label>
                  <input type="password" placeholder="Repeat password" value={editVoterPasswordConfirm} onChange={e => setEditVoterPasswordConfirm(e.target.value)} className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-xl px-4 py-3 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] text-sm" />
                </div>
                {editVoterMsg && (
                  <p className={`text-xs font-bold ${editVoterMsg.includes("updated") ? "text-emerald-600" : "text-rose-600"}`}>{editVoterMsg}</p>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setEditingVoter(null); setEditVoterMsg(""); }} className="flex-1 py-3 rounded-xl font-bold text-[#0D5D56] bg-slate-100 hover:bg-slate-200 transition-colors text-sm">Cancel</button>
                  <button onClick={handleSaveVoterEdit} disabled={savingVoterEdit} className="flex-1 py-3 rounded-xl font-bold text-white bg-[#0D5D56] hover:bg-[#0D5D56]/90 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                    {savingVoterEdit ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Update
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Settings Modal ── */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0D5D56]/40 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }} className="bg-white border border-[#A7F3D0] shadow-2xl rounded-[40px] w-full max-w-md overflow-hidden relative">
              <div className="h-3 w-full bg-[#0D5D56]" />
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56]">Admin Settings</h3>
                  <button onClick={() => { setIsSettingsOpen(false); setSettingsMsg(""); }} className="w-9 h-9 rounded-full bg-[#F8FAFC] border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-rose-50 transition-colors"><X size={16} /></button>
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-[#0D5D56] uppercase tracking-widest mb-3">Theme</label>
                    <div className="flex gap-3">
                      {(["light", "dark"] as const).map((th) => (
                        <button key={th} onClick={() => { setSettingsTheme(th); setTheme(th); }} className={`flex-1 py-3 rounded-[16px] font-bold text-sm border-2 transition-all capitalize ${settingsTheme === th ? "bg-[#0D5D56] text-white border-[#0D5D56]" : "bg-white text-[#0D5D56] border-[#A7F3D0] hover:border-[#0D5D56]/50"}`}>
                          {th === "light" ? "Light Mode" : "Dark Mode"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[#A7F3D0]/50">
                    <label className="block text-xs font-bold text-[#0D5D56] uppercase tracking-widest mb-3">Change Admin Password</label>
                    <div className="space-y-3">
                      <input type="password" placeholder="New password" value={settingsPassword} onChange={(e) => setSettingsPassword(e.target.value)} className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-[16px] px-4 py-3 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] text-sm" />
                      <input type="password" placeholder="Confirm new password" value={settingsPasswordConfirm} onChange={(e) => setSettingsPasswordConfirm(e.target.value)} className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-[16px] px-4 py-3 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] text-sm" />
                      <button onClick={async () => {
                        if (!settingsPassword) return;
                        if (settingsPassword !== settingsPasswordConfirm) { setSettingsMsg("Passwords don't match."); return; }
                        if (settingsPassword.length < 6) { setSettingsMsg("Password must be at least 6 characters."); return; }
                        try {
                          const voters = await apiFetch("/api/voters");
                          const admin = voters.find((v: any) => v.email?.toLowerCase() === getAdminEmail().toLowerCase());
                          if (!admin) { setSettingsMsg("Admin account not found."); return; }
                          await apiFetch(`/api/voters/${admin.id}/password`, { method: "PATCH", body: JSON.stringify({ password: settingsPassword }) });
                          setSettingsPassword(""); setSettingsPasswordConfirm("");
                          setSettingsMsg("Password updated successfully.");
                        } catch (e: any) {
                          setSettingsMsg(e.message || "Failed to update password.");
                        }
                      }} className="w-full py-3 rounded-[16px] bg-[#0D5D56] text-[#A7F3D0] font-bold text-sm hover:bg-[#0D5D56]/90 transition-colors">Update Password</button>
                      {settingsMsg && <p className={`text-xs font-bold text-center ${settingsMsg.includes("success") ? "text-emerald-600" : "text-rose-600"}`}>{settingsMsg}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Seal Animation ── */}
      <AnimatePresence>
        {showSealAnim && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0D5D56]/80 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center">
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(255,255,255,0.5)]"><Lock size={40} className="text-[#0D5D56]" /></div>
              <h2 className="text-3xl font-bold text-white font-['Figtree'] mb-2">Sealing Environment...</h2>
              <p className="text-[#A7F3D0] font-bold">Locking all parameters for live deployment.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Method Preview Modal ── */}
      <AnimatePresence>
        {previewMethod && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0D5D56]/60 backdrop-blur-md p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }} className="bg-white border-2 border-[#A7F3D0] shadow-2xl rounded-[40px] w-full max-w-2xl overflow-hidden relative flex flex-col h-[70vh]">
              <div className="bg-[#0D5D56] p-6 text-white flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-['Figtree'] text-xl font-bold">Voter UI Preview: {METHODS.find(m => m.id === previewMethod)?.name}</h3>
                  <p className="text-[#A7F3D0] text-xs font-bold">This is exactly what the voter sees in the candidate grid.</p>
                </div>
                <button onClick={() => setPreviewMethod(null)} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full text-sm font-bold transition-all border border-white/20">Close Preview</button>
              </div>
              <div className="p-8 bg-[#F8FAFC] flex-1 overflow-y-auto flex items-center justify-center">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-xl">
                  {[1,2,3,4,5,6].map((card) => (
                    <div key={card} className="bg-white rounded-3xl p-5 border border-[#A7F3D0] shadow-sm flex flex-col items-center text-center">
                      <div className="w-16 h-16 bg-[#F8FAFC] rounded-full mb-3 border border-[#A7F3D0]/50" />
                      <div className="h-4 w-24 bg-[#0D5D56]/10 rounded mb-1" />
                      <div className="h-3 w-16 bg-[#0D5D56]/10 rounded mb-4" />
                      <div className="w-full mt-auto">
                        {previewMethod === "plurality" && <button className="w-full py-2.5 rounded-xl border-2 border-[#A7F3D0] text-[#0D5D56] font-bold text-sm bg-white">Select</button>}
                        {(previewMethod === "stv" || previewMethod === "borda") && (
                          <select className="w-full py-2.5 px-3 rounded-xl border-2 border-[#0D5D56] text-[#0D5D56] font-bold text-sm bg-[#F8FAFC] appearance-none text-center outline-none">
                            <option>Rank 1st</option><option>Rank 2nd</option><option>Rank 3rd</option>
                          </select>
                        )}
                        {previewMethod === "liquid" && (
                          <div className="flex gap-2">
                            <button className="flex-1 py-2.5 rounded-xl border-2 border-[#A7F3D0] text-[#0D5D56] font-bold text-[11px] bg-white">Vote</button>
                            <button className="flex-1 py-2.5 rounded-xl bg-[#0D5D56] text-[#A7F3D0] font-bold text-[11px] shadow-md">Delegate</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

function NavItem({ label, active = false, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`px-5 py-2.5 rounded-full text-sm font-bold transition-all ${active ? "bg-white text-[#0D5D56] shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"}`}>
      {label}
    </button>
  );
}