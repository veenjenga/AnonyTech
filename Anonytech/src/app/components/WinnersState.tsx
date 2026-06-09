import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, Star, ShieldCheck, Activity, BarChart2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const API_BASE: string =
  (import.meta as ImportMeta & {
    env: { VITE_API_URL?: string };
  }).env.VITE_API_URL || "http://localhost:5000";

// ── Types ────────────────────────────────────────────────────
interface TallyRow {
  role_id: string;
  role_name: string;
  voting_logic: string;
  candidate_id: string;
  candidate_name: string;
  image_url: string | null;
  course: string | null;
  department_id: string | null;
  department_name: string | null;
  vote_count: number;
  tallied_at: string;
}

interface RoleResult {
  roleId: string;
  roleName: string;
  votingLogic: string;
  candidates: {
    id: string;
    name: string;
    votes: number;
    imageUrl: string | null;
    department: string | null;
  }[];
  winner: RoleResult["candidates"][number] | null;
  runnerUp: RoleResult["candidates"][number] | null;
  winPercentage: number;
  totalVotes: number;
}

// ── Data fetching ────────────────────────────────────────────
async function fetchResults(): Promise<TallyRow[]> {
  const res = await fetch(`${API_BASE}/api/results`);
  if (res.status === 403) return []; // tally not yet released
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function groupByRole(rows: TallyRow[]): RoleResult[] {
  const map = new Map<string, RoleResult>();

  for (const row of rows) {
    if (!map.has(row.role_id)) {
      map.set(row.role_id, {
        roleId: row.role_id,
        roleName: row.role_name,
        votingLogic: row.voting_logic,
        candidates: [],
        winner: null,
        runnerUp: null,
        winPercentage: 0,
        totalVotes: 0,
      });
    }

    map.get(row.role_id)!.candidates.push({
      id: row.candidate_id,
      name: row.candidate_name,
      votes: Number(row.vote_count),
      imageUrl: row.image_url,
      department: row.department_name,
    });
  }

  for (const result of map.values()) {
    // Server already returns DESC by vote_count, but sort defensively
    result.candidates.sort((a, b) => b.votes - a.votes);
    result.totalVotes = result.candidates.reduce((s, c) => s + c.votes, 0);
    result.winner    = result.candidates[0] ?? null;
    result.runnerUp  = result.candidates[1] ?? null;
    result.winPercentage = result.winner && result.totalVotes > 0
      ? Math.round((result.winner.votes / result.totalVotes) * 100)
      : 0;
  }

  return Array.from(map.values());
}

// ── Component ────────────────────────────────────────────────
export function WinnersState() {
  const { t } = useTranslation();
  const [results, setResults]         = useState<RoleResult[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  useEffect(() => {
    fetchResults()
      .then((rows) => setResults(groupByRole(rows)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-[#0D5D56]/60">
        <Loader2 size={40} className="animate-spin" />
        <p className="font-bold text-lg">{t("Loading results…")}</p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-red-500">
        <Activity size={40} />
        <p className="font-bold text-lg">{t("Failed to load results")}</p>
        <p className="text-sm opacity-70">{error}</p>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────
  return (
    <motion.div
      key="Elections"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col h-full space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">
            {t("Election Results")}
          </h1>
          <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">
            {t("Final tallies and verified winners across all roles.")}
          </p>
        </div>
        <div className="bg-[#A7F3D0]/30 px-6 py-3 rounded-full border border-[#A7F3D0] text-[#0D5D56] font-bold shadow-sm flex items-center gap-2">
          <ShieldCheck size={18} /> {t("Results Mathematically Verified")}
        </div>
      </div>

      {results.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-[40px] border border-[#A7F3D0]/50 shadow-sm min-h-[400px] text-[#0D5D56]/50">
          <Activity size={48} className="mb-4 opacity-50" />
          <p className="text-xl font-bold">{t("No election data available yet.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 pb-8">
          {results.map(({ roleId, roleName, votingLogic, winner, runnerUp, winPercentage, candidates }) => (
            <div
              key={roleId}
              className="bg-white rounded-[40px] border border-[#A7F3D0]/50 shadow-sm overflow-hidden flex flex-col relative group hover:border-[#0D5D56]/30 transition-all hover:shadow-xl"
            >
              {/* Role Header */}
              <div className="px-8 py-6 bg-[#F8FAFC] border-b border-[#A7F3D0]/30 flex justify-between items-center relative z-10">
                <h2 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56]">{roleName}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-[#0D5D56]/60 text-xs font-bold uppercase tracking-widest">{t("Logic")}:</span>
                  <span className="bg-white border border-[#A7F3D0] text-[#0D5D56] px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                    {votingLogic}
                  </span>
                </div>
              </div>

              {winner ? (
                <div className="flex flex-col md:flex-row items-center p-8 gap-8 relative z-10">
                  {/* Winner Avatar */}
                  <div className="relative shrink-0">
                    <div className="absolute -top-4 -right-4 w-12 h-12 bg-amber-400 rounded-full border-4 border-white shadow-lg flex items-center justify-center text-white z-20 animate-bounce">
                      <Trophy size={20} className="drop-shadow-md" />
                    </div>
                    <div className="w-32 h-32 rounded-full border-[6px] border-[#A7F3D0] shadow-xl overflow-hidden bg-[#F8FAFC]">
                      {winner.imageUrl ? (
                        <img src={winner.imageUrl} alt={winner.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#0D5D56]/30 text-3xl font-bold">
                          {winner.name.charAt(0)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Winner Details */}
                  <div className="flex-1 text-center md:text-left">
                    <h3 className="font-['Figtree'] text-3xl font-bold text-[#0D5D56] mb-1">{winner.name}</h3>
                    {winner.department && (
                      <p className="text-[#0D5D56]/70 font-bold mb-4">{winner.department}</p>
                    )}
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-end text-sm font-bold text-[#0D5D56]">
                        <span>{t("Verified Mandate")}</span>
                        <span className="text-xl text-emerald-600">{winPercentage}%</span>
                      </div>
                      <div className="w-full h-3 bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-full overflow-hidden shadow-inner">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${winPercentage}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
                          className="h-full bg-gradient-to-r from-[#0D5D56] to-emerald-400 rounded-full"
                        />
                      </div>
                      <p className="text-xs font-bold text-[#0D5D56]/50 text-right">
                        {winner.votes.toLocaleString()} / {candidates.reduce((s, c) => s + c.votes, 0).toLocaleString()} {t("votes")}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center text-[#0D5D56]/50 font-bold flex-1 flex flex-col items-center justify-center">
                  <Star size={32} className="mb-3 opacity-30" />
                  <p>{t("Awaiting Results")}</p>
                </div>
              )}

              {/* Runner Up Banner & Full Tally */}
              {runnerUp && (
                <div className="mt-auto bg-[#F8FAFC]/50 px-8 py-4 border-t border-[#A7F3D0]/20 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full border-2 border-[#A7F3D0] overflow-hidden bg-white shrink-0">
                        {runnerUp.imageUrl
                          ? <img src={runnerUp.imageUrl} alt={runnerUp.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-[#0D5D56]/40 text-xs font-bold">{runnerUp.name.charAt(0)}</div>
                        }
                      </div>
                      <span className="text-sm font-bold text-[#0D5D56]/70">
                        {t("Runner Up")}: {runnerUp.name}
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedRole(expandedRole === roleId ? null : roleId)}
                      className="bg-white border border-[#A7F3D0] text-[#0D5D56] px-4 py-2 rounded-full text-xs font-bold hover:bg-[#A7F3D0]/20 transition-colors flex items-center gap-2 shadow-sm"
                    >
                      <BarChart2 size={14} />
                      {expandedRole === roleId ? t("Hide Full Tally") : t("View Full Tally")}
                    </button>
                  </div>

                  <AnimatePresence>
                    {expandedRole === roleId && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="h-48 pt-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={candidates}
                              layout="vertical"
                              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#A7F3D0" />
                              <XAxis type="number" hide />
                              <YAxis
                                dataKey="id"
                                type="category"
                                width={100}
                                stroke="#0D5D56"
                                fontSize={10}
                                fontWeight={700}
                                tick={{ fill: "#0D5D56" }}
                                tickFormatter={(val) => candidates.find((c) => c.id === val)?.name ?? val}
                              />
                              <Tooltip
                                cursor={{ fill: "#A7F3D0", opacity: 0.2 }}
                                contentStyle={{ borderRadius: "12px", border: "1px solid #A7F3D0", fontSize: "12px", fontWeight: "bold" }}
                                labelFormatter={(val) => candidates.find((c) => c.id === val)?.name ?? val}
                              />
                              <Bar dataKey="votes" fill="#0D5D56" radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}