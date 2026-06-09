import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus, Edit2, Trash2, ShieldCheck, Image as ImageIcon,
  X, Building2, Users, CheckCircle2, Loader2, AlertCircle,
  Upload, Link as LinkIcon, Zap, AlertTriangle, Info,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Department {
  id: string;
  name: string;
  full_name: string;
  prefix: string;
}

interface Role {
  id: string;
  name: string;
  voting_logic: "Plurality" | "STV" | "Borda" | "Liquid";
}

interface Candidate {
  id: string;
  role_id: string;
  department_id: string;
  name: string;
  course: string;
  image_url: string;
}

interface PluginInfo {
  method: string;
  ballot_structure: {
    type: string;
    description: string;
    fields: Record<
      string,
      {
        type: string;
        description: string;
        required?: boolean;
        enum?: string[];
        default?: unknown;
      }
    >;
  };
}

// ─── Voting method definitions (mirrors AdminDashboard) ───────────────────────

const METHODS = [
  {
    id: "plurality",
    name: "Plurality",
    label: "First Past the Post",
    desc: "Voters select exactly one candidate. Most votes wins. Simple and fast.",
    voterUiDesc: "Single-choice ballot — tap to select one candidate.",
    icon: "①",
  },
  {
    id: "stv",
    name: "Single Transferable Vote",
    label: "STV — Ranked Choice",
    desc: "Voters rank candidates. Votes transfer on elimination ensuring broader representation.",
    voterUiDesc: "Ranked ballot — assign preference order to candidates.",
    icon: "↑↓",
  },
  {
    id: "borda",
    name: "Borda Count",
    label: "Positional Scoring",
    desc: "Points assigned by rank. Rank 1 = N-1 pts, rank 2 = N-2 pts … encourages consensus.",
    voterUiDesc: "Ranked ballot — scores computed from your ranking order.",
    icon: "∑",
  },
  {
    id: "liquid",
    name: "Liquid Democracy",
    label: "Vote or Delegate",
    desc: "Vote directly or delegate your vote to a trusted proxy. Delegation is transitive.",
    voterUiDesc: "Dual-action ballot — vote directly or assign a delegate.",
    icon: "⇆",
  },
] as const;

type MethodId = (typeof METHODS)[number]["id"];

// Map Role.voting_logic → MethodId
const LOGIC_TO_METHOD: Record<Role["voting_logic"], MethodId> = {
  Plurality: "plurality",
  STV: "stv",
  Borda: "borda",
  Liquid: "liquid",
};
const METHOD_TO_LOGIC: Record<MethodId, Role["voting_logic"]> = {
  plurality: "Plurality",
  stv: "STV",
  borda: "Borda",
  liquid: "Liquid",
};

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE: string =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env
    .VITE_API_URL || "http://localhost:5000";

const PLUGIN_API: string =
  (import.meta as ImportMeta & { env: { VITE_PLUGIN_API_URL?: string } }).env
    .VITE_PLUGIN_API_URL || "http://localhost:8000";

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

async function pluginFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PLUGIN_API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string; error?: string }).detail ??
        (body as { error?: string }).error ??
        `HTTP ${res.status}`
    );
  }
  return res.json() as Promise<T>;
}

// ─── Image helpers ────────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

// ─── Shared components (outside main component to prevent focus loss) ─────────

const Modal = ({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) => (
  <AnimatePresence>
    {open && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-[#0D5D56]/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className={`bg-white w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-[32px] p-8 shadow-2xl relative z-10 border border-[#A7F3D0] max-h-[90vh] overflow-y-auto`}
        >
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-['Figtree'] text-2xl font-bold text-[#0D5D56]">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-[#F8FAFC] border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-[#A7F3D0]/30 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

const Field = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => (
  <div>
    <label className="block text-sm font-bold text-[#0D5D56] mb-2">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-xl px-4 py-3 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] transition-colors"
    />
  </div>
);

const SaveCancelRow = ({
  onSave,
  onCancel,
  label,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  label: string;
  saving: boolean;
}) => (
  <div className="flex gap-3 pt-4">
    <button
      onClick={onCancel}
      className="flex-1 py-3 rounded-xl font-bold text-[#0D5D56] bg-slate-100 hover:bg-slate-200 transition-colors"
    >
      Cancel
    </button>
    <button
      onClick={onSave}
      disabled={saving}
      className="flex-1 py-3 rounded-xl font-bold text-[#A7F3D0] bg-[#0D5D56] hover:bg-[#0D5D56]/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
    >
      {saving && <Loader2 size={14} className="animate-spin" />}
      {label}
    </button>
  </div>
);

// ─── Image Upload Field ────────────────────────────────────────────────────────

function ImageUploadField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [urlInput, setUrlInput] = useState(value.startsWith("data:") ? "" : value);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    if (!value.startsWith("data:")) setUrlInput(value);
  }, [value]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please select an image file (JPEG, PNG, WebP, etc.).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Image must be under 2 MB.");
      return;
    }
    setUploadError("");
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      onChange(dataUrl);
    } catch {
      setUploadError("Failed to read image. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleUrlCommit = () => {
    onChange(urlInput.trim());
    setUrlMode(false);
  };

  const hasImage = !!value;

  return (
    <div>
      <label className="block text-sm font-bold text-[#0D5D56] mb-2">
        Candidate Photo
      </label>
      <div className="flex items-start gap-4 mb-3">
        <div className="w-20 h-20 rounded-full border-4 border-[#A7F3D0] bg-[#F8FAFC] flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
          {hasImage ? (
            <img src={value} alt="Preview" className="w-full h-full object-cover" />
          ) : (
            <ImageIcon size={28} className="text-[#0D5D56]/30" />
          )}
        </div>
        <div className="flex flex-col gap-2 flex-1">
          <label
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 cursor-pointer font-bold text-sm transition-all ${
              uploading
                ? "border-[#A7F3D0] bg-[#F8FAFC] text-[#0D5D56]/50 cursor-not-allowed"
                : "border-[#0D5D56] bg-white text-[#0D5D56] hover:bg-[#0D5D56]/5"
            }`}
          >
            {uploading ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload size={15} /> Upload from device
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={handleFileChange}
            />
          </label>
          <button
            onClick={() => setUrlMode((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-[#A7F3D0] bg-white text-[#0D5D56] font-bold text-sm hover:border-[#0D5D56]/40 transition-all"
          >
            <LinkIcon size={15} />{" "}
            {urlMode ? "Hide URL field" : "Paste image URL"}
          </button>
        </div>
      </div>
      {urlMode && (
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUrlCommit();
            }}
            placeholder="https://example.com/photo.jpg"
            className="flex-1 bg-[#F8FAFC] border-2 border-[#A7F3D0] rounded-xl px-4 py-2.5 text-[#0D5D56] font-bold focus:outline-none focus:border-[#0D5D56] text-sm"
          />
          <button
            onClick={handleUrlCommit}
            className="px-4 py-2.5 bg-[#0D5D56] text-[#A7F3D0] rounded-xl font-bold text-sm hover:bg-[#0D5D56]/90 transition-colors"
          >
            Set
          </button>
        </div>
      )}
      {hasImage && (
        <button
          onClick={() => {
            onChange("");
            setUrlInput("");
          }}
          className="text-xs font-bold text-rose-500 hover:text-rose-700 transition-colors mt-1"
        >
          Remove photo
        </button>
      )}
      {uploadError && (
        <p className="text-xs font-bold text-rose-600 mt-2 flex items-center gap-1">
          <AlertCircle size={12} /> {uploadError}
        </p>
      )}
      <p className="text-[10px] font-bold text-[#0D5D56]/40 mt-2">
        Accepted: JPEG, PNG, WebP — max 2 MB. Or paste any direct image URL.
      </p>
    </div>
  );
}

// ─── Voting Method Selector ────────────────────────────────────────────────────

function VotingMethodSelector({
  value,
  onChange,
  pluginInfo,
  pluginLoading,
  pluginError,
  switching,
  disabled,
}: {
  value: MethodId;
  onChange: (id: MethodId) => void;
  pluginInfo: PluginInfo | null;
  pluginLoading: boolean;
  pluginError: string | null;
  switching: boolean;
  disabled: boolean;
}) {
  return (
    <div>
      {/* Plugin engine status pill */}
      <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-[#F8FAFC] border border-[#A7F3D0]/60 rounded-2xl">
        <Zap size={13} className="text-[#0D5D56]/60 shrink-0" />
        <span className="text-xs font-bold text-[#0D5D56]/50 uppercase tracking-wider">
          Plugin Engine:
        </span>
        {pluginLoading ? (
          <span className="text-xs font-bold text-amber-600 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Connecting…
          </span>
        ) : pluginError ? (
          <span className="text-xs font-bold text-rose-600 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {pluginError}
          </span>
        ) : pluginInfo ? (
          <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> Connected — active:{" "}
            <span className="text-[#0D5D56] capitalize ml-0.5">{pluginInfo.method}</span>
          </span>
        ) : (
          <span className="text-xs font-bold text-amber-600">Waiting…</span>
        )}
        {switching && (
          <span className="ml-auto text-xs font-bold text-[#0D5D56]/50 flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Switching…
          </span>
        )}
      </div>

      {/* Method cards — 2×2 compact grid, icon + name only */}
      <div className="grid grid-cols-2 gap-3">
        {METHODS.map((method) => {
          const isSelected = value === method.id;
          const isEngineActive = pluginInfo?.method === method.id;

          return (
            <button
              key={method.id}
              type="button"
              disabled={disabled || switching}
              onClick={() => onChange(method.id)}
              className={`relative text-left rounded-[20px] border-2 p-4 transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected
                  ? "border-[#0D5D56] bg-[#0D5D56]/5 shadow-[0_2px_12px_rgba(13,93,86,0.12)]"
                  : "border-[#A7F3D0]/60 bg-[#F8FAFC] hover:border-[#0D5D56]/30 hover:bg-white"
              }`}
            >
              {/* Active badge */}
              {isSelected && (
                <span className="absolute top-2.5 right-2.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                  <Check size={9} /> Active
                </span>
              )}

              {/* Icon */}
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-base font-black mb-3 border-2 ${
                  isSelected
                    ? "bg-[#0D5D56] text-[#A7F3D0] border-[#0D5D56]"
                    : "bg-white text-[#0D5D56] border-[#A7F3D0]"
                }`}
              >
                {method.icon}
              </div>

              {/* Name only — no label or description */}
              <p className="font-bold text-sm text-[#0D5D56] leading-tight">
                {method.name}
              </p>

              {/* Plugin loaded indicator */}
              <div
                className={`flex items-center gap-1 text-[10px] font-bold mt-2 ${
                  isEngineActive ? "text-emerald-600" : "text-[#0D5D56]/25"
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    isEngineActive ? "bg-emerald-500" : "bg-[#0D5D56]/20"
                  }`}
                />
                {isEngineActive ? "Plugin loaded in engine" : "Not in engine"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Active ballot schema preview (shown when selected method has schema) */}
      {pluginInfo && pluginInfo.method === value && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 bg-[#0D5D56] rounded-[20px] p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Info size={13} className="text-[#A7F3D0] shrink-0" />
            <p className="text-[11px] font-bold text-[#A7F3D0] uppercase tracking-wider">
              Active Ballot Schema —{" "}
              <span className="capitalize">{pluginInfo.method}</span>
            </p>
          </div>
          <p className="text-[11px] text-white/60 font-bold leading-relaxed">
            {pluginInfo.ballot_structure.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(pluginInfo.ballot_structure.fields)
              .slice(0, 4)
              .map(([fieldName, fieldDef]) => (
                <span
                  key={fieldName}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                    fieldDef.required
                      ? "bg-rose-500/20 border-rose-400/40 text-rose-300"
                      : "bg-white/10 border-white/20 text-white/60"
                  }`}
                >
                  {fieldName}:{" "}
                  <span className="text-[#A7F3D0]">{fieldDef.type}</span>
                </span>
              ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function AdminRegistry({ isSealed }: { isSealed: boolean }) {
  const { t } = useTranslation();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);

  const [adminVerified, setAdminVerified] = useState<boolean | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  // ── Plugin engine state (shared across Role modal) ─────────────────────────
  const [pluginInfo, setPluginInfo] = useState<PluginInfo | null>(null);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginSwitching, setPluginSwitching] = useState(false);

  const loadPluginInfo = useCallback(async () => {
    setPluginLoading(true);
    setPluginError(null);
    try {
      const info = await pluginFetch<PluginInfo>("/plugin/info");
      setPluginInfo(info);
    } catch (e: unknown) {
      setPluginError(
        e instanceof Error ? e.message : "Failed to connect to plugin engine."
      );
    } finally {
      setPluginLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPluginInfo();
  }, [loadPluginInfo]);

  // ── Admin session verification ─────────────────────────────────────────────
  useEffect(() => {
    const email = localStorage.getItem("adminEmail");
    if (!email) {
      setAdminError("No admin session found. Please log in as an admin.");
      setAdminVerified(false);
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/voters?role=admin`, {
      headers: { "Content-Type": "application/json", "x-admin-email": email },
    })
      .then(async (res) => {
        if (res.ok) {
          setAdminVerified(true);
        } else {
          const body = await res.json().catch(() => ({}));
          setAdminError(
            `Access denied: "${email}" is not an admin account. ` +
              `(${(body as { error?: string }).error ?? `HTTP ${res.status}`})`
          );
          setAdminVerified(false);
          setLoading(false);
        }
      })
      .catch(() => {
        setAdminVerified(true);
      });
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [depts, rls, cands] = await Promise.all([
        apiFetch<Department[]>("/api/departments"),
        apiFetch<Role[]>("/api/roles"),
        apiFetch<Candidate[]>("/api/candidates"),
      ]);
      setDepartments(depts);
      setRoles(rls);
      setCandidates(cands);
      if (depts.length && !activeDeptId) setActiveDeptId(depts[0].id);
      if (rls.length && !activeRoleId) setActiveRoleId(rls[0].id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (adminVerified === true) loadAll();
  }, [adminVerified, loadAll]);

  const loadCandidates = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeRoleId) params.set("roleId", activeRoleId);
      if (activeDeptId) params.set("departmentId", activeDeptId);
      const cands = await apiFetch<Candidate[]>(`/api/candidates?${params}`);
      setCandidates((prev) => {
        const other = prev.filter(
          (c) =>
            !(c.role_id === activeRoleId && c.department_id === activeDeptId)
        );
        return [...other, ...cands];
      });
    } catch {
      /* silent */
    }
  }, [activeDeptId, activeRoleId]);

  useEffect(() => {
    if (activeDeptId && activeRoleId) loadCandidates();
  }, [activeDeptId, activeRoleId, loadCandidates]);

  // ── Department modal state ─────────────────────────────────────────────────
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState({
    name: "",
    fullName: "",
    prefix: "",
  });
  const [saving, setSaving] = useState(false);

  const openNewDept = () => {
    setEditingDept(null);
    setDeptForm({ name: "", fullName: "", prefix: "" });
    setIsDeptModalOpen(true);
  };

  const openEditDept = (dept: Department) => {
    setEditingDept(dept);
    setDeptForm({
      name: dept.name,
      fullName: dept.full_name,
      prefix: dept.prefix,
    });
    setIsDeptModalOpen(true);
  };

  const handleSaveDept = async () => {
    if (!deptForm.name.trim() || !deptForm.prefix.trim()) return;
    setSaving(true);
    try {
      if (editingDept) {
        const updated = await apiFetch<Department>(
          `/api/departments/${editingDept.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              name: deptForm.name.trim(),
              fullName:
                deptForm.fullName.trim() || deptForm.name.trim(),
              prefix: deptForm.prefix.toUpperCase().slice(0, 3),
            }),
          }
        );
        setDepartments((prev) =>
          prev.map((d) => (d.id === updated.id ? updated : d))
        );
      } else {
        const id = `dept_${Date.now()}`;
        const created = await apiFetch<Department>("/api/departments", {
          method: "POST",
          body: JSON.stringify({
            id,
            name: deptForm.name.trim(),
            fullName:
              deptForm.fullName.trim() || deptForm.name.trim(),
            prefix: deptForm.prefix.toUpperCase().slice(0, 3),
          }),
        });
        setDepartments((prev) => [...prev, created]);
        setActiveDeptId(created.id);
      }
      setIsDeptModalOpen(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDept = async (id: string) => {
    if (!confirm("Delete this department and all its candidates?")) return;
    try {
      await apiFetch(`/api/departments/${id}`, { method: "DELETE" });
      setDepartments((prev) => prev.filter((d) => d.id !== id));
      setCandidates((prev) => prev.filter((c) => c.department_id !== id));
      if (activeDeptId === id) {
        const remaining = departments.filter((d) => d.id !== id);
        setActiveDeptId(remaining.length ? remaining[0].id : null);
      }
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // ── Role modal state ───────────────────────────────────────────────────────
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleMethod, setRoleMethod] = useState<MethodId>("plurality");

  const handleRoleMethodChange = useCallback(
    async (newMethodId: MethodId) => {
      setRoleMethod(newMethodId);

      if (isSealed) return;

      setPluginSwitching(true);
      setPluginError(null);
      try {
        await pluginFetch("/plugin/switch", {
          method: "POST",
          body: JSON.stringify({ method: newMethodId }),
        });
        const info = await pluginFetch<PluginInfo>("/plugin/info");
        setPluginInfo(info);
        await apiFetch("/api/config", {
          method: "PATCH",
          body: JSON.stringify({ votingMethod: newMethodId }),
        });
      } catch (e: unknown) {
        setPluginError(
          e instanceof Error ? e.message : "Plugin switch failed."
        );
      } finally {
        setPluginSwitching(false);
      }
    },
    [isSealed]
  );

  const openNewRole = () => {
    setEditingRole(null);
    setRoleName("");
    const currentMethod = (pluginInfo?.method as MethodId) ?? "plurality";
    setRoleMethod(currentMethod);
    setIsRoleModalOpen(true);
  };

  const openEditRole = (role: Role) => {
    setEditingRole(role);
    setRoleName(role.name);
    setRoleMethod(LOGIC_TO_METHOD[role.voting_logic] ?? "plurality");
    setIsRoleModalOpen(true);
  };

  const handleSaveRole = async () => {
    if (!roleName.trim()) return;
    setSaving(true);
    try {
      if (editingRole) {
        const updated = await apiFetch<Role>(`/api/roles/${editingRole.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: roleName,
            votingLogic: METHOD_TO_LOGIC[roleMethod],
          }),
        });
        setRoles((prev) =>
          prev.map((r) => (r.id === updated.id ? updated : r))
        );
      } else {
        const id = `role_${Date.now()}`;
        const created = await apiFetch<Role>("/api/roles", {
          method: "POST",
          body: JSON.stringify({
            id,
            name: roleName,
            votingLogic: METHOD_TO_LOGIC[roleMethod],
          }),
        });
        setRoles((prev) => [...prev, created]);
        setActiveRoleId(created.id);
      }
      setIsRoleModalOpen(false);
      setEditingRole(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!confirm("Delete this role and all its candidates?")) return;
    try {
      await apiFetch(`/api/roles/${id}`, { method: "DELETE" });
      setRoles((prev) => prev.filter((r) => r.id !== id));
      setCandidates((prev) => prev.filter((c) => c.role_id !== id));
      if (activeRoleId === id) {
        const remaining = roles.filter((r) => r.id !== id);
        setActiveRoleId(remaining.length ? remaining[0].id : null);
      }
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // ── Candidate modal state ──────────────────────────────────────────────────
  const [isCandModalOpen, setIsCandModalOpen] = useState(false);
  const [editingCand, setEditingCand] = useState<Candidate | null>(null);
  const [candForm, setCandForm] = useState<Partial<Candidate>>({
    name: "",
    course: "",
    image_url: "",
  });

  const openNewCand = () => {
    setEditingCand(null);
    setCandForm({ name: "", course: "", image_url: "" });
    setIsCandModalOpen(true);
  };

  const openEditCand = (cand: Candidate) => {
    setEditingCand(cand);
    setCandForm(cand);
    setIsCandModalOpen(true);
  };

  const handleSaveCand = async () => {
    if (!activeRoleId || !activeDeptId || !candForm.name?.trim()) return;
    setSaving(true);
    try {
      if (editingCand) {
        const updated = await apiFetch<Candidate>(
          `/api/candidates/${editingCand.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              name: candForm.name,
              course: candForm.course,
              imageUrl: candForm.image_url,
            }),
          }
        );
        setCandidates((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c))
        );
      } else {
        const id = `cand_${Date.now()}`;
        const created = await apiFetch<Candidate>("/api/candidates", {
          method: "POST",
          body: JSON.stringify({
            id,
            roleId: activeRoleId,
            departmentId: activeDeptId,
            name: candForm.name,
            course: candForm.course || "",
            imageUrl: candForm.image_url || "",
          }),
        });
        setCandidates((prev) => [...prev, created]);
      }
      setIsCandModalOpen(false);
      setEditingCand(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCand = async (id: string) => {
    if (!confirm("Remove this candidate?")) return;
    try {
      await apiFetch(`/api/candidates/${id}`, { method: "DELETE" });
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeCandidates = candidates.filter(
    (c) => c.role_id === activeRoleId && c.department_id === activeDeptId
  );
  const activeDept = departments.find((d) => d.id === activeDeptId);
  const activeRole = roles.find((r) => r.id === activeRoleId);

  // ── Admin verification failed ──────────────────────────────────────────────
  if (adminVerified === false) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-rose-600 p-8 text-center">
        <AlertCircle size={48} />
        <p className="font-bold text-xl">Admin Access Required</p>
        <p className="text-sm text-rose-500 max-w-md">{adminError}</p>
        <button
          onClick={() => {
            localStorage.removeItem("adminEmail");
            window.location.href = "/";
          }}
          className="mt-2 px-6 py-2.5 bg-rose-600 text-white rounded-full font-bold shadow hover:bg-rose-700 transition-colors"
        >
          Clear Session &amp; Go to Login
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-[#0D5D56]/60">
        <Loader2 size={40} className="animate-spin" />
        <p className="font-bold text-lg">Loading registry…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-rose-600">
        <AlertCircle size={40} />
        <p className="font-bold text-lg">Failed to load: {error}</p>
        <button
          onClick={loadAll}
          className="px-6 py-2.5 bg-[#0D5D56] text-[#A7F3D0] rounded-full font-bold shadow hover:bg-[#0D5D56]/90 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      key="Registry"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col h-full gap-8"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-['Figtree'] text-5xl font-bold text-[#0D5D56] tracking-tight">
            {t("Registry")}
          </h1>
          <p className="text-[#0D5D56]/70 font-bold mt-2 text-lg">
            Manage Departments, Roles &amp; Candidates
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Plugin engine status bar */}
          <div className="flex items-center gap-2 bg-white border border-[#A7F3D0]/50 px-4 py-2.5 rounded-full shadow-sm text-sm">
            <Zap size={14} className="text-[#0D5D56]/50" />
            {pluginLoading ? (
              <span className="font-bold text-amber-600 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Connecting…
              </span>
            ) : pluginError ? (
              <span className="font-bold text-rose-600 flex items-center gap-1.5">
                <AlertCircle size={12} /> Offline
              </span>
            ) : pluginInfo ? (
              <span className="font-bold text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 size={12} /> Plugin:{" "}
                <span className="text-[#0D5D56] capitalize ml-0.5">
                  {pluginInfo.method}
                </span>
              </span>
            ) : null}
          </div>
          {isSealed && (
            <div className="bg-amber-100 px-5 py-2.5 rounded-full border border-amber-300 text-amber-800 font-bold shadow-sm flex items-center gap-2 text-sm">
              <ShieldCheck size={15} /> Registry is Sealed (Read-Only)
            </div>
          )}
        </div>
      </div>

      {/* Two-panel grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[560px]">
        {/* Panel 1: Departments + Roles */}
        <div className="lg:col-span-5 bg-white rounded-[40px] border border-[#A7F3D0]/50 shadow-sm p-6 flex flex-col gap-6">
          {/* Departments */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-['Figtree'] text-lg font-bold text-[#0D5D56] flex items-center gap-2">
                <Building2 size={16} /> Departments
              </h3>
              {!isSealed && (
                <button
                  onClick={openNewDept}
                  className="w-8 h-8 bg-[#0D5D56] text-[#A7F3D0] rounded-full flex items-center justify-center hover:bg-[#0D5D56]/90 transition-all shadow-sm"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto hide-scrollbar max-h-[200px]">
              {departments.map((dept) => (
                <div
                  key={dept.id}
                  onClick={() => setActiveDeptId(dept.id)}
                  className={`group px-4 py-3 rounded-[16px] border-2 cursor-pointer transition-all flex items-center justify-between ${
                    activeDeptId === dept.id
                      ? "border-[#0D5D56] bg-[#0D5D56]/5"
                      : "border-[#A7F3D0]/50 hover:border-[#0D5D56]/30"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm text-[#0D5D56] truncate">
                      {dept.name}
                    </p>
                    <p className="text-xs text-[#0D5D56]/50 font-bold">
                      Prefix: {dept.prefix}
                    </p>
                  </div>
                  {!isSealed && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDept(dept);
                        }}
                        className="w-6 h-6 rounded-full bg-white border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-emerald-50 shadow-sm"
                      >
                        <Edit2 size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDept(dept.id);
                        }}
                        className="w-6 h-6 rounded-full bg-white border border-rose-200 flex items-center justify-center text-rose-500 hover:bg-rose-50 shadow-sm"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {departments.length === 0 && (
                <div className="text-center p-4 text-[#0D5D56]/40 font-bold border-2 border-dashed border-[#A7F3D0] rounded-[16px] text-xs">
                  No departments yet. Click + to add.
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-[#A7F3D0]/30" />

          {/* Roles */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-['Figtree'] text-lg font-bold text-[#0D5D56] flex items-center gap-2">
                <Users size={16} /> Roles
              </h3>
              {!isSealed && (
                <button
                  onClick={openNewRole}
                  className="w-8 h-8 bg-[#0D5D56] text-[#A7F3D0] rounded-full flex items-center justify-center hover:bg-[#0D5D56]/90 transition-all shadow-sm"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto hide-scrollbar max-h-[220px]">
              {roles.map((role) => {
                const methodId = LOGIC_TO_METHOD[role.voting_logic];
                const method = METHODS.find((m) => m.id === methodId);
                return (
                  <div
                    key={role.id}
                    onClick={() => setActiveRoleId(role.id)}
                    className={`group px-4 py-3 rounded-[16px] border-2 cursor-pointer transition-all flex items-center justify-between ${
                      activeRoleId === role.id
                        ? "border-[#0D5D56] bg-[#0D5D56]/5"
                        : "border-[#A7F3D0]/50 hover:border-[#0D5D56]/30"
                    }`}
                  >
                    <div>
                      <p className="font-bold text-sm text-[#0D5D56]">
                        {role.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#A7F3D0]/30 text-[#0D5D56] rounded-full text-[10px] font-bold border border-[#A7F3D0]">
                          <span className="text-[10px]">{method?.icon}</span>
                          {role.voting_logic}
                        </span>
                        {pluginInfo?.method === methodId && (
                          <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            live
                          </span>
                        )}
                      </div>
                    </div>
                    {!isSealed && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditRole(role);
                          }}
                          className="w-6 h-6 rounded-full bg-white border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-emerald-50 shadow-sm"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRole(role.id);
                          }}
                          className="w-6 h-6 rounded-full bg-white border border-rose-200 flex items-center justify-center text-rose-500 hover:bg-rose-50 shadow-sm"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {roles.length === 0 && (
                <div className="text-center p-4 text-[#0D5D56]/40 font-bold border-2 border-dashed border-[#A7F3D0] rounded-[16px] text-xs">
                  No roles yet. Click + to add.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Panel 2: Candidates */}
        <div className="lg:col-span-7 bg-white rounded-[40px] border border-[#A7F3D0]/50 shadow-sm p-6 flex flex-col">
          {!activeDeptId || !activeRoleId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[#0D5D56]/40 font-bold gap-3">
              <ShieldCheck size={40} className="opacity-40" />
              <p className="text-sm text-center">
                Select a department and role
                <br />
                to manage candidates
              </p>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-start mb-5 pb-5 border-b border-[#A7F3D0]/30">
                <div>
                  <h3 className="font-['Figtree'] text-xl font-bold text-[#0D5D56]">
                    {activeRole?.name} Candidates
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-bold text-[#0D5D56]/50 bg-[#F8FAFC] border border-[#A7F3D0]/50 px-3 py-1 rounded-full">
                      {activeDept?.name}
                    </span>
                    <span className="text-xs font-bold text-[#0D5D56]/50">
                      {activeCandidates.length} / 6 slots
                    </span>
                  </div>
                </div>
                {!isSealed && activeCandidates.length < 6 && (
                  <button
                    onClick={openNewCand}
                    className="bg-[#0D5D56] text-[#A7F3D0] px-5 py-2.5 rounded-full font-bold text-sm shadow-md hover:bg-[#0D5D56]/90 transition-colors flex items-center gap-2"
                  >
                    <Plus size={16} /> Add
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 overflow-y-auto hide-scrollbar pb-2 flex-1 content-start">
                {activeCandidates.map((cand) => (
                  <div
                    key={cand.id}
                    className="group bg-[#F8FAFC] rounded-[28px] border border-[#A7F3D0]/50 p-5 flex flex-col gap-3 relative hover:border-[#0D5D56]/30 hover:shadow-md transition-all"
                  >
                    {!isSealed && (
                      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                          onClick={() => openEditCand(cand)}
                          className="w-7 h-7 bg-white rounded-full border border-[#A7F3D0] flex items-center justify-center text-[#0D5D56] hover:bg-emerald-50 shadow-sm"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteCand(cand.id)}
                          className="w-7 h-7 bg-white rounded-full border border-rose-200 flex items-center justify-center text-rose-500 hover:bg-rose-50 shadow-sm"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                    <div className="w-16 h-16 rounded-full border-4 border-white shadow-sm mx-auto overflow-hidden bg-[#A7F3D0] flex items-center justify-center text-[#0D5D56]">
                      {cand.image_url ? (
                        <img
                          src={cand.image_url}
                          alt={cand.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImageIcon size={24} className="opacity-50" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-sm text-[#0D5D56] leading-tight">
                        {cand.name}
                      </p>
                      <p className="text-xs text-[#0D5D56]/50 font-bold mt-0.5">
                        {cand.course}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Empty slots */}
                {!isSealed &&
                  Array.from({
                    length: Math.max(0, 6 - activeCandidates.length),
                  }).map((_, i) => (
                    <div
                      key={`empty_${i}`}
                      onClick={openNewCand}
                      className="bg-[#F8FAFC]/50 rounded-[28px] border-2 border-dashed border-[#A7F3D0] p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-[#A7F3D0]/10 transition-colors min-h-[140px]"
                    >
                      <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-[#0D5D56]/40">
                        <Plus size={20} />
                      </div>
                      <p className="text-xs font-bold text-[#0D5D56]/40 text-center">
                        Empty Slot
                      </p>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Department Modal ── */}
      <Modal
        open={isDeptModalOpen}
        onClose={() => setIsDeptModalOpen(false)}
        title={editingDept ? "Edit Department" : "Add Department"}
      >
        <div className="space-y-4">
          <Field
            label="Abbreviation (e.g. SCIT)"
            value={deptForm.name}
            onChange={(v) => setDeptForm((f) => ({ ...f, name: v }))}
            placeholder="e.g. SCIT"
          />
          <Field
            label="Full Name"
            value={deptForm.fullName}
            onChange={(v) => setDeptForm((f) => ({ ...f, fullName: v }))}
            placeholder="e.g. School of Computing and Information Technology"
          />
          <div>
            <Field
              label="Student ID Prefix — first 3 letters (e.g. SCT)"
              value={deptForm.prefix}
              onChange={(v) =>
                setDeptForm((f) => ({
                  ...f,
                  prefix: v.toUpperCase().slice(0, 3),
                }))
              }
              placeholder="e.g. SCT"
            />
            <p className="text-xs font-bold text-[#0D5D56]/50 mt-1.5 ml-1">
              Voters with a Student ID starting with these 3 letters will be
              assigned to this department.
            </p>
          </div>
          {deptForm.prefix.length === 3 && deptForm.name && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-emerald-700 text-xs font-bold">
              <CheckCircle2 size={14} className="text-emerald-500" />
              Students with IDs like{" "}
              <span className="font-mono">{deptForm.prefix}212-…</span> →{" "}
              {deptForm.name}
            </div>
          )}
          <SaveCancelRow
            onSave={handleSaveDept}
            onCancel={() => setIsDeptModalOpen(false)}
            label={editingDept ? "Save Changes" : "Add Department"}
            saving={saving}
          />
        </div>
      </Modal>

      {/* ── Role Modal ── */}
      <Modal
        open={isRoleModalOpen}
        onClose={() => {
          setIsRoleModalOpen(false);
          setEditingRole(null);
        }}
        title={editingRole ? "Edit Role" : "Create Role"}
        wide
      >
        <div className="space-y-6">
          <Field
            label="Role Name"
            value={roleName}
            onChange={setRoleName}
            placeholder="e.g. President"
          />

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-bold text-[#0D5D56]">
                Voting Method
              </label>
              {!isSealed && (
                <button
                  onClick={loadPluginInfo}
                  className="text-xs font-bold text-[#0D5D56]/50 hover:text-[#0D5D56] underline underline-offset-2 transition-colors"
                >
                  Refresh engine
                </button>
              )}
            </div>
            <VotingMethodSelector
              value={roleMethod}
              onChange={handleRoleMethodChange}
              pluginInfo={pluginInfo}
              pluginLoading={pluginLoading}
              pluginError={pluginError}
              switching={pluginSwitching}
              disabled={isSealed}
            />
          </div>

          <div className="bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-4 py-3 flex items-center gap-2">
            <Info size={13} className="text-[#0D5D56]/40 shrink-0" />
            <p className="text-xs font-bold text-[#0D5D56]/60">
              Selecting a method here activates it in the plugin engine
              immediately and stores it with this role. The global voting method
              in the Command Center will also update.
            </p>
          </div>

          <SaveCancelRow
            onSave={handleSaveRole}
            onCancel={() => {
              setIsRoleModalOpen(false);
              setEditingRole(null);
            }}
            label={editingRole ? "Save Changes" : "Create Role"}
            saving={saving}
          />
        </div>
      </Modal>

      {/* ── Candidate Modal ── */}
      <Modal
        open={isCandModalOpen}
        onClose={() => setIsCandModalOpen(false)}
        title={editingCand ? "Edit Candidate" : "Add Candidate"}
      >
        <div className="space-y-4">
          <Field
            label="Full Name"
            value={candForm.name || ""}
            onChange={(v) => setCandForm((f) => ({ ...f, name: v }))}
            placeholder="e.g. John Doe"
          />
          <Field
            label="Course / Programme"
            value={candForm.course || ""}
            onChange={(v) => setCandForm((f) => ({ ...f, course: v }))}
            placeholder="e.g. BSc Computer Technology"
          />
          <ImageUploadField
            value={candForm.image_url || ""}
            onChange={(url) => setCandForm((f) => ({ ...f, image_url: url }))}
          />
          <div className="bg-[#F8FAFC] border border-[#A7F3D0]/50 rounded-2xl px-4 py-3 text-xs font-bold text-[#0D5D56]/60">
            Adding to:{" "}
            <span className="text-[#0D5D56]">{activeDept?.name}</span> →{" "}
            <span className="text-[#0D5D56]">{activeRole?.name}</span>
          </div>
          <SaveCancelRow
            onSave={handleSaveCand}
            onCancel={() => setIsCandModalOpen(false)}
            label={editingCand ? "Save Changes" : "Add Candidate"}
            saving={saving}
          />
        </div>
      </Modal>
    </motion.div>
  );
}