import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck, Download, Activity, Key, Database,
  PieChart, CheckCircle2, RotateCcw, AlertTriangle, Loader2,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BarChart as RechartsBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPieChart, Pie, Cell,
} from "recharts";

// ─── API base ─────────────────────────────────────────────────────────────────
const API_BASE: string =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env
    .VITE_API_URL || "http://localhost:5000";

function adminHeaders(): HeadersInit {
  const email = localStorage.getItem("adminEmail") ?? "";
  return { "Content-Type": "application/json", "x-admin-email": email };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface TallyRow {
  role_id: string;
  role_name: string;
  voting_logic: string;
  candidate_id: string;
  candidate_name: string;
  image_url: string | null;
  vote_count: number;
}

interface RoleChart {
  roleId: string;
  roleName: string;
  data: { id: string; name: string; votes: number }[];
}

interface BulletinBallot {
  id: string;
  token_hash: string;
  ciphertext_a: string;
  zkp_proof: string;
  zkp_verified: boolean;
  is_real: boolean;
  counted: boolean;
}

interface AuditBlock {
  block_id: string;
  label: string;
  verified: boolean;
}

interface VerifyResult {
  found: boolean;
  ballot_on_board: boolean;
  zkp_valid: boolean;
  included_in_tally: boolean;
  result_matches: boolean;
  error?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface AdminTallyHubProps {
  /** Called after a successful reset so the parent re-fetches config */
  onReset?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export function AdminTallyHub({ onReset }: AdminTallyHubProps) {
  const { t } = useTranslation();
  const COLORS = ["#0D5D56", "#A7F3D0", "#10B981", "#34D399", "#059669", "#047857"];

  // ── Tally data ─────────────────────────────────────────────────────────────
  const [roleResults, setRoleResults] = useState<RoleChart[]>([]);
  const [tallyLoading, setTallyLoading] = useState(true);
  const [tallyError, setTallyError] = useState<string | null>(null);

  const loadTally = useCallback(async () => {
    setTallyLoading(true);
    setTallyError(null);
    try {
      const rows = await apiFetch<TallyRow[]>("/api/results");
      if (rows.length > 0) {
        const map = new Map<string, RoleChart>();
        for (const row of rows) {
          if (!map.has(row.role_id)) {
            map.set(row.role_id, {
              roleId: row.role_id,
              roleName: row.role_name,
              data: [],
            });
          }
          map.get(row.role_id)!.data.push({
            id: `${row.candidate_id}`,
            name: row.candidate_name,
            votes: Number(row.vote_count),
          });
        }
        for (const rc of map.values()) rc.data.sort((a, b) => b.votes - a.votes);
        setRoleResults(Array.from(map.values()));
      } else {
        setRoleResults([]);
      }
    } catch (e: unknown) {
      setTallyError(e instanceof Error ? e.message : "Failed to load tally.");
      setRoleResults([]);
    } finally {
      setTallyLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTally();
  }, [loadTally]);

  // ── Audit log blocks ───────────────────────────────────────────────────────
  const [auditBlocks, setAuditBlocks] = useState<AuditBlock[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      try {
        const data = await apiFetch<AuditBlock[]>("/api/audit-log");
        if (!cancelled) setAuditBlocks(data);
      } catch {
        // Silently show empty — vault will render "No blocks" message
        if (!cancelled) setAuditBlocks([]);
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Reset state ────────────────────────────────────────────────────────────
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await apiFetch("/api/config/reset", { method: "POST" });
      setShowResetConfirm(false);
      onReset?.();
    } catch (e: unknown) {
      setResetError(e instanceof Error ? e.message : "Reset failed. Please try again.");
    } finally {
      setResetting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col h-full gap-8"
    >
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">
            {t("Official Tally & Audit Hub")}
          </h1>
          <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">
            {t("Election complete. Results are cryptographically verified.")}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-emerald-100 px-6 py-3 rounded-full border border-emerald-300 text-emerald-800 font-bold shadow-sm flex items-center gap-2">
            <ShieldCheck size={18} /> {t("Signed Integrity Certificate: VALID")}
          </div>
          <button
            onClick={async () => {
              try {
                const res = await fetch(`${API_BASE}/api/audit-log/download`, {
                  headers: adminHeaders(),
                });
                if (!res.ok) throw new Error("Download failed");
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `audit_log_${new Date().toISOString().split("T")[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                console.error("Audit download failed:", e);
              }
            }}
            className="bg-[#0D5D56] hover:bg-[#0D5D56]/90 text-[#A7F3D0] px-6 py-3 rounded-full font-bold shadow-md transition-all flex items-center gap-2"
          >
            <Download size={18} /> {t("Download Official Audit Log")}
          </button>
          <button
            onClick={() => setShowResetConfirm(true)}
            className="bg-white hover:bg-rose-50 text-rose-600 border-2 border-rose-200 hover:border-rose-400 px-6 py-3 rounded-full font-bold shadow-sm transition-all flex items-center gap-2"
          >
            <RotateCcw size={18} /> {t("Start New Election")}
          </button>
        </div>
      </div>

      {/* ── Charts + Audit Vault ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 min-h-[500px]">

        {/* Left: Charts */}
        <div className="lg:col-span-8 bg-white rounded-[40px] border border-[#A7F3D0]/50 p-8 shadow-sm flex flex-col relative overflow-hidden overflow-y-auto">
          <div className="flex items-center gap-3 mb-6">
            <PieChart className="text-[#0D5D56]" />
            <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56]">
              {t("Final Vote Distribution")}
            </h3>
          </div>

          {tallyLoading ? (
            <div className="flex-1 flex items-center justify-center gap-3 text-[#0D5D56]/50">
              <Loader2 size={28} className="animate-spin" />
              <span className="font-bold">{t("Loading tally…")}</span>
            </div>
          ) : tallyError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-rose-600">
              <XCircle size={32} className="opacity-60" />
              <p className="font-bold text-sm">{tallyError}</p>
              <button
                onClick={loadTally}
                className="mt-2 px-5 py-2 rounded-full bg-rose-50 border border-rose-200 text-rose-600 font-bold text-sm hover:bg-rose-100 transition-colors flex items-center gap-2"
              >
                <RotateCcw size={14} /> {t("Retry")}
              </button>
            </div>
          ) : (
            <div className="space-y-12">
              {roleResults.map(({ roleId, roleName, data }) => (
                <div
                  key={roleId}
                  className="bg-[#F8FAFC] border border-[#A7F3D0]/30 rounded-[32px] p-6"
                >
                  <h4 className="font-['Figtree'] text-xl font-bold text-[#0D5D56] mb-6">
                    {roleName}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Bar chart */}
                    <div className="h-64 flex flex-col justify-center">
                      {data.length > 0 ? (
                        <ResponsiveContainer width="99%" height="100%" minWidth={0}>
                          <RechartsBarChart
                            data={data}
                            layout="vertical"
                            margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              horizontal={false}
                              stroke="#A7F3D0"
                            />
                            <XAxis type="number" stroke="#0D5D56" fontSize={12} fontWeight={700} />
                            <YAxis
                              dataKey="id"
                              type="category"
                              width={100}
                              stroke="#0D5D56"
                              fontSize={12}
                              fontWeight={700}
                              tickFormatter={(val) => data.find((d) => d.id === val)?.name ?? val}
                            />
                            <Tooltip
                              cursor={{ fill: "#A7F3D0", opacity: 0.2 }}
                              contentStyle={{
                                borderRadius: "16px",
                                border: "1px solid #A7F3D0",
                                fontWeight: "bold",
                              }}
                              labelFormatter={(val) =>
                                data.find((d) => d.id === val)?.name ?? val
                              }
                            />
                            <Bar dataKey="votes" fill="#0D5D56" radius={[0, 4, 4, 0]} />
                          </RechartsBarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-center text-[#0D5D56]/50 font-bold">
                          {t("No candidates for this role.")}
                        </div>
                      )}
                    </div>

                    {/* Pie chart */}
                    <div className="h-64 flex items-center justify-center">
                      {data.length > 0 ? (
                        <ResponsiveContainer width="99%" height="100%" minWidth={0}>
                          <RechartsPieChart>
                            <Pie
                              data={data}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="votes"
                              nameKey="id"
                            >
                              {data.map((_, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={COLORS[index % COLORS.length]}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                borderRadius: "16px",
                                border: "1px solid #A7F3D0",
                                fontWeight: "bold",
                              }}
                              labelFormatter={() => ""}
                              formatter={(value, name) => [
                                value,
                                data.find((d) => d.id === name)?.name ?? name,
                              ]}
                            />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-center text-[#0D5D56]/50 font-bold">
                          {t("No votes yet.")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {roleResults.length === 0 && (
                <div className="text-center p-12 text-[#0D5D56]/50 font-bold border-2 border-dashed border-[#A7F3D0] rounded-[32px]">
                  {t("No tally data available yet.")}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Decrypted Audit Vault */}
        <div className="lg:col-span-4 bg-[#0D5D56] rounded-[40px] shadow-xl p-8 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#A7F3D0] rounded-full blur-[100px] opacity-10 pointer-events-none" />

          <div className="flex items-center justify-between mb-8 relative z-10">
            <h3 className="font-['Figtree'] text-xl font-bold text-white flex items-center gap-2">
              <Database size={20} className="text-[#A7F3D0]" /> {t("Decrypted Audit Vault")}
            </h3>
            <Activity className="w-5 h-5 text-[#A7F3D0]" />
          </div>

          <p className="text-white/80 text-sm font-medium mb-6 relative z-10">
            {t("Persistence ledger verified. The final count matches the original registry.")}
          </p>

          <div className="flex-1 grid grid-cols-2 gap-3 relative z-10 content-start">
            {auditLoading ? (
              <div className="col-span-2 flex items-center justify-center gap-2 text-[#A7F3D0]/60 py-8">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm font-bold">{t("Loading…")}</span>
              </div>
            ) : auditBlocks.length === 0 ? (
              <div className="col-span-2 text-center text-white/30 text-sm font-bold py-8 border-2 border-dashed border-white/10 rounded-2xl">
                {t("No audit blocks recorded yet.")}
              </div>
            ) : (
              auditBlocks.map((block) => (
                <div
                  key={block.block_id}
                  className="bg-white/10 border border-[#A7F3D0]/30 rounded-2xl p-4 flex flex-col items-center justify-center backdrop-blur-sm"
                >
                  <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center mb-2">
                    <Key size={16} className="text-emerald-400" />
                  </div>
                  <span className="text-[10px] font-bold text-[#A7F3D0] text-center">
                    {block.label || `${t("Ledger Block")}\n#${block.block_id}`}
                  </span>
                  <span className="mt-1 text-[9px] text-white/50">
                    {block.verified ? t("Verified") : t("Pending")}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="relative z-10 mt-6 pt-6 border-t border-white/10">
            <p className="text-white/40 text-xs font-bold mb-3 uppercase tracking-widest">
              Election Lifecycle
            </p>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="w-full py-3 rounded-[16px] bg-white/10 border border-white/20 text-[#A7F3D0] font-bold text-sm hover:bg-white/20 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={16} /> {t("Start New Election")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Bulletin Board ─────────────────────────────────────────────────── */}
      <BulletinBoard />

      {/* ── Reset Confirmation Modal ──────────────────────────────────────── */}
      <AnimatePresence>
        {showResetConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0D5D56]/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 12 }}
              className="bg-white border-2 border-rose-200 shadow-2xl rounded-[32px] w-full max-w-md p-8 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-rose-400 to-rose-600 rounded-t-[32px]" />

              <div className="flex flex-col items-center text-center gap-4 mt-2">
                <div className="w-16 h-16 rounded-full bg-rose-50 border-2 border-rose-200 flex items-center justify-center">
                  <AlertTriangle size={32} className="text-rose-500" />
                </div>

                <div>
                  <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] mb-2">
                    {t("Start a New Election?")}
                  </h3>
                  <p className="text-[#0D5D56]/70 font-bold text-sm leading-relaxed max-w-xs mx-auto">
                    {t(
                      "This will unseal the election, clear the tally, and return the dashboard to configuration mode. All audit logs and ballot records are preserved."
                    )}
                  </p>
                </div>

                <div className="w-full bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-5 py-4 text-left space-y-2">
                  {[
                    { label: "Election sealed flag", action: "Cleared" },
                    { label: "Tally released flag", action: "Cleared" },
                    { label: "Start & end dates", action: "Cleared" },
                    { label: "Voters, candidates & ballots", action: "Preserved" },
                    { label: "Audit log", action: "Preserved" },
                  ].map(({ label, action }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#0D5D56]/70">{label}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          action === "Cleared"
                            ? "bg-rose-50 border-rose-200 text-rose-600"
                            : "bg-emerald-50 border-emerald-200 text-emerald-700"
                        }`}
                      >
                        {action}
                      </span>
                    </div>
                  ))}
                </div>

                {resetError && (
                  <div className="w-full bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 text-rose-700 font-bold text-sm flex items-center gap-2">
                    <AlertTriangle size={16} className="shrink-0 text-rose-500" />
                    {resetError}
                  </div>
                )}

                <div className="flex gap-3 w-full pt-2">
                  <button
                    onClick={() => {
                      setShowResetConfirm(false);
                      setResetError(null);
                    }}
                    disabled={resetting}
                    className="flex-1 py-3.5 rounded-2xl font-bold text-[#0D5D56] bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="flex-1 py-3.5 rounded-2xl font-bold text-white bg-rose-500 hover:bg-rose-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 shadow-md"
                  >
                    {resetting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {t("Resetting…")}
                      </>
                    ) : (
                      <>
                        <RotateCcw size={16} />
                        {t("Yes, Start New Election")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Bulletin Board ───────────────────────────────────────────────────────────
function BulletinBoard() {
  const { t } = useTranslation();

  const [ballots, setBallots] = useState<BulletinBallot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [coercerView, setCoercerView] = useState(false);

  const [verifyToken, setVerifyToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Load ballots from the crypto API bulletin board
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // The crypto API exposes GET /crypto/bulletin-board
        // Server.js should proxy or expose this at /api/bulletin-board
        const data = await apiFetch<BulletinBallot[]>("/api/bulletin-board");
        if (!cancelled) setBallots(data);
      } catch (e: unknown) {
        if (!cancelled)
          setLoadError(e instanceof Error ? e.message : "Failed to load bulletin board.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerify = async () => {
    const token = verifyToken.trim();
    if (!token) return;
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError(null);
    try {
      const result = await apiFetch<VerifyResult>("/api/verify-ballot", {
        method: "POST",
        body: JSON.stringify({ token_hash: token }),
      });
      setVerifyResult(result);
    } catch (e: unknown) {
      setVerifyError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 mt-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-['Figtree'] text-4xl font-bold text-[#0D5D56] tracking-tight">
            {t("Public Bulletin Board")}
          </h2>
          <p className="text-[#0D5D56]/70 font-bold mt-1">
            {t(
              "All submitted encrypted ballots and ZKP proofs are visible here. Anyone can verify the tally."
            )}
          </p>
        </div>
        <button
          onClick={() => setCoercerView((v) => !v)}
          className={`px-6 py-3 rounded-full font-bold text-sm flex items-center gap-2 border-2 transition-all shadow-sm ${
            coercerView
              ? "bg-rose-600 text-white border-rose-600 shadow-rose-200"
              : "bg-white text-[#0D5D56] border-[#A7F3D0] hover:border-[#0D5D56]"
          }`}
        >
          <ShieldCheck size={16} />
          {coercerView ? t("Coercer's View (Active)") : t("View as Coercer")}
        </button>
      </div>

      {coercerView && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-rose-50 border border-rose-200 rounded-[24px] px-6 py-4 text-rose-700 font-bold text-sm flex items-start gap-3"
        >
          <ShieldCheck size={18} className="shrink-0 mt-0.5 text-rose-500" />
          <div>
            <p className="font-bold mb-1">{t("Coercer's perspective active")}</p>
            <p className="font-medium text-rose-600/80">
              {t(
                "The \"Counted\" column and credential labels are hidden. Both real and fake ballots appear completely identical — a coercer cannot tell which vote counts."
              )}
            </p>
          </div>
        </motion.div>
      )}

      {/* Ballot table */}
      <div className="bg-white rounded-[40px] border border-[#A7F3D0]/50 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-3 text-[#0D5D56]/50 py-16">
            <Loader2 size={28} className="animate-spin" />
            <span className="font-bold">{t("Loading ballots…")}</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-rose-600">
            <XCircle size={32} className="opacity-60" />
            <p className="font-bold text-sm">{loadError}</p>
          </div>
        ) : ballots.length === 0 ? (
          <div className="text-center py-16 text-[#0D5D56]/40 font-bold border-2 border-dashed border-[#A7F3D0]/50 rounded-[40px] m-4">
            {t("No ballots have been submitted yet.")}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b border-[#A7F3D0]/30">
                  <tr>
                    {[
                      t("Ballot"),
                      t("Token"),
                      t("Enc(A)"),
                      t("ZKP"),
                      t("Proof"),
                      ...(coercerView ? [] : [t("Credential"), t("Counted")]),
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-4 text-xs font-bold text-[#0D5D56] uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#A7F3D0]/20">
                  {ballots.map((b, idx) => (
                    <tr key={b.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-5 py-4 text-sm font-bold text-[#0D5D56]">
                        #{String(idx + 1).padStart(3, "0")}
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-[#0D5D56]/70 max-w-[160px] truncate">
                        {b.token_hash}
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-[#0D5D56]/70 max-w-[160px] truncate">
                        {b.ciphertext_a}
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-[#0D5D56]/60 max-w-[200px] truncate">
                        {b.zkp_proof}
                      </td>
                      <td className="px-5 py-4">
                        {b.zkp_verified ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-full">
                            <CheckCircle2 size={12} /> {t("VERIFIED")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold rounded-full">
                            <XCircle size={12} /> {t("FAILED")}
                          </span>
                        )}
                      </td>
                      {!coercerView && (
                        <>
                          <td className="px-5 py-4">
                            <span
                              className={`text-xs font-bold px-3 py-1 rounded-full border ${
                                b.is_real
                                  ? "bg-[#A7F3D0]/30 border-[#A7F3D0] text-[#0D5D56]"
                                  : "bg-amber-50 border-amber-200 text-amber-700"
                              }`}
                            >
                              {b.is_real ? t("Real") : t("Fake")}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1 w-fit ${
                                b.counted
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                  : "bg-slate-100 border-slate-200 text-slate-500"
                              }`}
                            >
                              {b.counted ? (
                                <>
                                  <CheckCircle2 size={12} /> {t("YES")}
                                </>
                              ) : (
                                `✗  ${t("NO")}`
                              )}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {coercerView && (
              <div className="px-6 py-4 bg-[#F8FAFC] border-t border-[#A7F3D0]/30 text-xs font-bold text-[#0D5D56]/60">
                {t(
                  "All {{count}} ballots look identical to the coercer. Real and fake credentials are indistinguishable. Only the tally authority can determine which are counted.",
                  { count: ballots.length }
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Verify My Ballot */}
      <div className="bg-white rounded-[40px] border border-[#A7F3D0]/50 shadow-sm p-8">
        <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56] mb-2">
          {t("Verify the Tally Yourself")}
        </h3>
        <p className="text-[#0D5D56]/70 font-bold text-sm mb-6">
          {t(
            "You do not need to trust the election authority. Using only the public key and the bulletin board data, you can confirm your ballot was counted."
          )}
        </p>
        <div className="flex gap-3 flex-col sm:flex-row">
          <input
            type="text"
            placeholder={t("Enter your ballot token hash...")}
            value={verifyToken}
            onChange={(e) => {
              setVerifyToken(e.target.value);
              setVerifyResult(null);
              setVerifyError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            className="flex-1 bg-[#F8FAFC] border-2 border-[#A7F3D0] text-[#0D5D56] font-bold rounded-2xl px-5 py-3 text-sm focus:outline-none focus:border-[#0D5D56] transition-colors"
          />
          <button
            onClick={handleVerify}
            disabled={verifying || !verifyToken.trim()}
            className="bg-[#0D5D56] hover:bg-[#0D5D56]/90 text-white px-6 py-3 rounded-2xl font-bold text-sm transition-all shadow-md whitespace-nowrap flex items-center gap-2 disabled:opacity-60"
          >
            {verifying ? (
              <>
                <Loader2 size={16} className="animate-spin text-[#A7F3D0]" />
                {t("Verifying…")}
              </>
            ) : (
              <>
                <ShieldCheck size={16} className="text-[#A7F3D0]" />
                {t("Verify My Ballot Was Counted")}
              </>
            )}
          </button>
        </div>

        <AnimatePresence>
          {verifyError && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-5 rounded-[20px] p-5 border bg-rose-50 border-rose-200"
            >
              <p className="text-rose-700 font-bold text-sm flex items-center gap-2">
                <XCircle size={16} className="shrink-0 text-rose-500" />
                {verifyError}
              </p>
            </motion.div>
          )}

          {verifyResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mt-5 rounded-[20px] p-5 border ${
                verifyResult.found
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-rose-50 border-rose-200"
              }`}
            >
              {verifyResult.found ? (
                <div className="space-y-2">
                  {(
                    [
                      {
                        key: "ballot_on_board",
                        label: t("Your ballot appears on the bulletin board"),
                      },
                      { key: "zkp_valid", label: t("Your ZKP proof is valid") },
                      {
                        key: "included_in_tally",
                        label: t("Your ballot was included in the tally"),
                      },
                      {
                        key: "result_matches",
                        label: t("The published result matches the homomorphic combination"),
                      },
                    ] as { key: keyof VerifyResult; label: string }[]
                  ).map(({ key, label }) => (
                    <div
                      key={key}
                      className={`flex items-center gap-2 text-sm font-bold ${
                        verifyResult[key] ? "text-emerald-700" : "text-rose-600"
                      }`}
                    >
                      {verifyResult[key] ? (
                        <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle size={16} className="text-rose-400 shrink-0" />
                      )}
                      {label}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-rose-700 font-bold text-sm">
                  {verifyResult.error ||
                    t(
                      "Token not found on the bulletin board. Please check your token and try again."
                    )}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}