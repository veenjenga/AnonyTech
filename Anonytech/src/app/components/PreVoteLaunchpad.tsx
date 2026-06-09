import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import {
  LayoutGrid, Calendar, MessageSquare, Heart, CheckCircle2,
  LifeBuoy, Settings, Search, Info, ShieldAlert, Users, Plus,
  LogOut, Shield, ChevronDown, AlertCircle, Loader2, Clock,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
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
function formatDeadline(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffD = Math.floor(diffMs / 86_400_000);

  if (diffMs < 0) return "Closed";
  if (diffD === 0)
    return `Closes Today • ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (diffD === 1) return "Closes Tomorrow";
  return `Closes ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function electionStatus(config: ElectionConfig): string {
  if (config.is_tally_released) return "Results Released";
  if (config.is_sealed) return "Voting Open";
  return "Not Yet Open";
}

function estimatedMinutes(config: ElectionConfig | null): string {
  // Very rough: 1–2 min per voting method
  if (!config) return "—";
  if (config.voting_method === "STV" || config.voting_method === "Borda") return "3–4 min";
  return "1–2 min";
}

// ─── Component ────────────────────────────────────────────────────────────────
export function PreVoteLaunchpad() {
  const navigate = useNavigate();

  const [voter, setVoter] = useState<Voter | null>(null);
  const [config, setConfig] = useState<ElectionConfig | null>(null);
  const [journey, setJourney] = useState<VoterJourney | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Load data ───────────────────────────────────────────────────────────────
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

        // Fetch election config + journey in parallel; journey may 404 (first visit)
        const [cfg, journeyResult] = await Promise.allSettled([
          apiFetch<ElectionConfig>("/api/config"),
          apiFetch<VoterJourney>(`/api/journey/${v.id}`),
        ]);

        if (cfg.status === "fulfilled") setConfig(cfg.value);
        if (journeyResult.status === "fulfilled") setJourney(journeyResult.value);
        // journey 404 on first visit is fine — journey stays null
      } catch (err: unknown) {
        setLoadError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [navigate]);

  const handleLogout = () => {
    sessionStorage.clear();
    navigate("/");
  };

  const canVote =
    config?.is_sealed === true && config?.is_tally_released === false && !voter?.has_voted;

  // ── System check items derived from real data ─────────────────────────────
  const systemChecks = [
    {
      title: "Identity Found",
      subtitle: voter ? `Logged in as ${voter.student_id}` : "Checking…",
      date: voter ? "Confirmed" : "Pending",
      active: !!voter,
    },
    {
      title: "Eligible to Vote",
      subtitle: voter?.department_name
        ? `Department: ${voter.department_name}`
        : voter?.department_id
        ? `Dept ID: ${voter.department_id}`
        : "No department assigned",
      date: voter?.department_id ? "Confirmed" : "Warning",
      active: !!voter?.department_id,
    },
    {
      title: "Election Open",
      subtitle: config
        ? electionStatus(config)
        : "Checking election state…",
      date: config?.is_sealed ? "Active" : "Pending",
      active: config?.is_sealed === true && config?.is_tally_released === false,
    },
    {
      title: "Secure Tunnel",
      subtitle: journey?.tunnel_active
        ? "Tunnel previously activated"
        : "Will lock on start",
      date: journey?.tunnel_active ? "Done" : "Pending",
      active: !!journey?.tunnel_active,
    },
  ];

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#F8FAFC]">
        <Loader2 size={40} className="animate-spin text-[#136F63]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center">
        <AlertCircle size={48} className="mb-4 text-red-500" />
        <p className="font-bold text-[#000F08] mb-2">Failed to load dashboard</p>
        <p className="text-sm text-[#136F63] mb-6">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-[#000F08] text-white rounded-full font-bold"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full overflow-hidden text-[#000F08]">

      {/* Left Sidebar */}
      <aside className="w-[280px] flex flex-col px-6 py-8 border-r border-white/20 relative z-20 bg-white/10 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-12 px-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-[#136F63] to-[#C5FFFD] text-[#000F08] shadow-sm">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-['Figtree'] font-bold text-xl tracking-tight">VotingApp</span>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem icon={<LayoutGrid size={20} />} label="Dashboard" active />
          <SidebarItem icon={<Calendar size={20} />} label="Elections" />
          <SidebarItem icon={<MessageSquare size={20} />} label="Messages" />
          <SidebarItem icon={<Heart size={20} />} label="Voter Care" />
          <SidebarItem icon={<ShieldAlert size={20} />} label="Security" />
          <SidebarItem icon={<LifeBuoy size={20} />} label="Support" />
          <SidebarItem icon={<Settings size={20} />} label="Settings" />
        </nav>

        <div className="mt-auto">
          <button
            onClick={handleLogout}
            className="flex items-center gap-4 px-4 py-4 w-full rounded-2xl text-[#136F63] font-bold hover:bg-white/40 transition-all text-left"
          >
            <LogOut size={20} />
            <span className="text-sm">Log Out</span>
          </button>
        </div>
      </aside>

      {/* Center Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto hide-scrollbar px-10 py-10 z-10 relative">
        <h1 className="font-['Figtree'] text-4xl font-bold mb-2">
          Welcome{voter?.full_name ? `, ${voter.full_name.split(" ")[0]}` : ""}
        </h1>
        {voter && (
          <p className="text-sm text-[#136F63] font-bold mb-8 tracking-wide">
            {voter.student_id} · {voter.department_name ?? voter.department_id ?? "No department"}
          </p>
        )}

        {/* Election Banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative w-full h-[220px] rounded-[32px] bg-white/60 border border-white/80 shadow-[0_8px_32px_rgba(0,15,8,0.03)] overflow-hidden mb-8 flex flex-col justify-between p-8 backdrop-blur-xl group"
        >
          <div className="absolute right-0 top-0 h-[150%] w-[350px] -translate-y-10 z-0 pointer-events-none">
            <img
              src="https://images.unsplash.com/photo-1765648636065-fd5c0884b629?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx5b3VuZyUyMHN0dWRlbnQlMjBwcm9mZXNzaW9uYWwlMjBzbWlsaW5nfGVufDF8fHx8MTc3NDg3NzIwNXww&ixlib=rb-4.1.0&q=80&w=1080"
              alt="Student Voting"
              className="w-full h-full object-cover object-top [mask-image:linear-gradient(to_left,black_50%,transparent_100%)] opacity-90 transition-transform duration-700 group-hover:scale-105"
            />
          </div>

          <div className="relative z-10">
            <p className="text-sm font-bold text-[#136F63] mb-2">Current Election</p>
            <h2 className="font-['Figtree'] text-3xl font-bold max-w-[280px] leading-tight text-[#000F08]">
              {config
                ? config.voting_method
                  ? `${config.voting_method} Election`
                  : "Active Election"
                : "No election configured"}
            </h2>
          </div>

          <div className="relative z-10 inline-flex items-center gap-4 bg-white/70 backdrop-blur-md rounded-2xl px-5 py-3 text-[#136F63] self-start border border-white">
            <span className="text-xs font-bold flex items-center gap-2">
              <Calendar size={14} />
              {config ? formatDeadline(config.end_date) : "—"}
            </span>
            {config && (
              <>
                <div className="w-px h-3 bg-[#136F63]/30" />
                <span className="text-xs font-bold">
                  {config.is_tally_released
                    ? "Results Out"
                    : config.is_sealed
                    ? "Voting Open"
                    : "Not Yet Open"}
                </span>
              </>
            )}
          </div>
        </motion.div>

        {/* Circular Action Buttons */}
        <div className="flex justify-between items-center mb-10 px-2">
          <CircularAction icon={<Info size={24} />} label="Info" />
          <CircularAction icon={<Shield size={24} />} label="Rules" />
          <CircularAction icon={<Users size={24} />} label="Candidates" />
          <CircularAction icon={<LifeBuoy size={24} />} label="Help" />
          <CircularAction icon={<Calendar size={24} />} label="Schedule" />
          <CircularAction icon={<Plus size={24} />} label="More" />
        </div>

        {/* Bottom Split */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">

          {/* Voting Tips */}
          <div>
            <h3 className="font-['Figtree'] text-xl font-bold mb-4 pl-2">Voting Tips</h3>
            <div className="bg-white/40 backdrop-blur-xl rounded-[32px] border border-white/60 p-6 flex flex-col gap-4 shadow-sm">
              <TipItem
                title="Be Prepared"
                desc="Read about who you want to vote for before starting."
                img="https://images.unsplash.com/photo-1770156812763-c1749bc0ebbf?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=150"
              />
              <TipItem
                title="Private Space"
                desc="Make sure nobody is watching your screen."
                img="https://images.unsplash.com/photo-1767972464040-8bfee42d7bed?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=150"
              />
              <TipItem
                title="Take Your Time"
                desc="You only get one chance to vote, so do not rush."
                img="https://images.unsplash.com/photo-1765648636065-fd5c0884b629?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=150"
              />
            </div>
          </div>

          {/* System Check — real data */}
          <div>
            <div className="flex justify-between items-center mb-4 pl-2">
              <h3 className="font-['Figtree'] text-xl font-bold">System Check</h3>
              <span className="text-sm font-bold text-[#136F63] cursor-pointer">
                {systemChecks.filter((c) => c.active).length}/{systemChecks.length} Ready
              </span>
            </div>

            <div className="bg-white/40 backdrop-blur-xl rounded-[32px] border border-white/60 p-6 flex flex-col gap-5 shadow-sm">
              {systemChecks.map((item, i) => (
                <React.Fragment key={item.title}>
                  <HistoryItem
                    title={item.title}
                    subtitle={item.subtitle}
                    date={item.date}
                    active={item.active}
                  />
                  {i < systemChecks.length - 1 && (
                    <div className="w-full h-px bg-[#C5FFFD]/50" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Right Sidebar */}
      <aside className="w-[340px] flex flex-col p-8 border-l border-white/20 bg-white/20 backdrop-blur-md z-20">
        <h3 className="font-['Figtree'] text-xl font-bold mb-4 pl-2">Find a resource</h3>

        {/* Search */}
        <div className="relative mb-8">
          <input
            type="text"
            placeholder="Search here..."
            className="w-full bg-white/80 rounded-[20px] py-4 pl-5 pr-12 text-sm shadow-inner border border-white/50 focus:outline-none focus:border-[#136F63] transition-colors text-[#000F08] placeholder-[#136F63]/50"
          />
          <Search className="absolute right-5 top-1/2 -translate-y-1/2 text-[#136F63] w-5 h-5" />
        </div>

        {/* Categories Grid */}
        <div className="grid grid-cols-3 gap-3 mb-auto">
          <CategoryBtn icon={<Info size={20} />} label="General" />
          <CategoryBtn icon={<Users size={20} />} label="Departments" />
          <CategoryBtn icon={<Heart size={20} />} label="Wellness" />
          <CategoryBtn icon={<Shield size={20} />} label="Security" />
          <CategoryBtn icon={<MessageSquare size={20} />} label="Feedback" />
          <CategoryBtn icon={<LifeBuoy size={20} />} label="Help Desk" />
          <CategoryBtn icon={<Settings size={20} />} label="Options" />
          <CategoryBtn icon={<Calendar size={20} />} label="Calendar" />
          <CategoryBtn icon={<Plus size={20} />} label="Addons" />
        </div>

        {/* Your Status card — real voter + config data */}
        <div className="mt-8">
          <h3 className="font-['Figtree'] text-xl font-bold mb-4 pl-2">Your Status</h3>
          <div className="bg-white/60 backdrop-blur-2xl border border-white shadow-md rounded-[24px] p-4 flex flex-col">
            <div className="bg-white rounded-[20px] p-4 flex justify-between items-center mb-4 shadow-sm border border-[#C5FFFD]">
              <div>
                <p className="text-xs font-bold text-[#136F63] mb-1">State</p>
                <p className="font-bold text-[#000F08] text-base">
                  {voter?.has_voted
                    ? "Already Voted"
                    : canVote
                    ? "Ready to Vote"
                    : config?.is_tally_released
                    ? "Voting Closed"
                    : "Election Pending"}
                </p>
              </div>
              <ChevronDown className="text-[#136F63] w-5 h-5" />
            </div>

            <div className="flex gap-2 mb-4">
              <div className="bg-[#C5FFFD]/50 rounded-[16px] p-3 flex-1 text-center border border-white">
                <p className="text-[10px] font-bold text-[#136F63] mb-1">Method</p>
                <p className="font-bold text-[#000F08] text-sm">
                  {config?.voting_method ?? "—"}
                </p>
              </div>
              <div className="bg-[#C5FFFD]/50 rounded-[16px] p-3 flex-1 text-center border border-white">
                <p className="text-[10px] font-bold text-[#136F63] mb-1">Est. Time</p>
                <p className="font-bold text-[#000F08] text-sm">
                  {estimatedMinutes(config)}
                </p>
              </div>
            </div>

            {/* Deadline badge */}
            {config?.end_date && (
              <div className="flex items-center gap-2 mb-4 px-1">
                <Clock size={13} className="text-[#136F63] shrink-0" />
                <span className="text-xs font-bold text-[#136F63]">
                  {formatDeadline(config.end_date)}
                </span>
              </div>
            )}

            <motion.button
              whileHover={{ scale: canVote ? 1.02 : 1 }}
              whileTap={{ scale: canVote ? 0.98 : 1 }}
              onClick={() => canVote && navigate("/tunnel")}
              disabled={!canVote}
              className={`rounded-[20px] py-4 font-bold text-base shadow-[0_8px_20px_rgba(0,15,8,0.2)] transition-all w-full flex items-center justify-center gap-2 ${
                canVote
                  ? "bg-[#000F08] text-white cursor-pointer"
                  : "bg-[#000F08]/20 text-[#000F08]/40 cursor-not-allowed"
              }`}
            >
              {voter?.has_voted
                ? "Ballot Submitted"
                : canVote
                ? "Start Voting Now"
                : config?.is_tally_released
                ? "Voting Has Ended"
                : "Waiting for Election to Open"}
            </motion.button>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SidebarItem({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 px-4 py-4 rounded-2xl cursor-pointer transition-all ${
        active
          ? "bg-white text-[#000F08] shadow-sm font-bold border border-white/50"
          : "text-[#136F63] hover:bg-white/40 font-bold"
      }`}
    >
      {icon}
      <span className="text-sm">{label}</span>
    </div>
  );
}

function CircularAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 cursor-pointer group">
      <div className="w-[72px] h-[72px] rounded-full bg-white/70 backdrop-blur-md border border-white shadow-sm flex items-center justify-center text-[#136F63] group-hover:bg-white group-hover:text-[#000F08] group-hover:shadow-md transition-all">
        {icon}
      </div>
      <span className="text-xs font-bold text-[#136F63] group-hover:text-[#000F08]">
        {label}
      </span>
    </div>
  );
}

function CategoryBtn({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 bg-white/40 border border-white/50 rounded-[20px] p-4 cursor-pointer hover:bg-white hover:shadow-sm transition-all text-[#136F63] aspect-square">
      {icon}
      <span className="text-[10px] font-bold mt-1 text-center leading-tight">{label}</span>
    </div>
  );
}

function TipItem({ title, desc, img }: { title: string; desc: string; img: string }) {
  return (
    <div className="flex items-center gap-4">
      <img
        src={img}
        alt={title}
        className="w-16 h-16 rounded-[16px] object-cover shadow-sm border border-white flex-shrink-0"
      />
      <div>
        <h4 className="text-base font-bold text-[#000F08]">{title}</h4>
        <p className="text-xs text-[#136F63] font-medium leading-relaxed mt-1 pr-2">{desc}</p>
      </div>
    </div>
  );
}

function HistoryItem({
  title,
  subtitle,
  date,
  active = true,
}: {
  title: string;
  subtitle: string;
  date: string;
  active?: boolean;
}) {
  return (
    <div className="flex justify-between items-start">
      <div>
        <h4 className="text-sm font-bold text-[#000F08] flex items-center gap-2 mb-1">
          {active ? (
            <div className="w-2 h-2 rounded-full bg-[#136F63]" />
          ) : (
            <div className="w-2 h-2 rounded-full border border-[#136F63]" />
          )}
          {title}
        </h4>
        <p className="text-xs font-bold text-[#136F63]">{subtitle}</p>
      </div>
      <p className="text-xs font-bold text-[#136F63]/60">{date}</p>
    </div>
  );
}