export interface Role {
  id: string;
  name: string;
  votingLogic: "Plurality" | "Borda" | "STV" | "Liquid";
}

export interface Candidate {
  id: string;
  roleId: string;
  departmentId: string;
  name: string;
  course: string;
  imageUrl: string;
}

export interface Department {
  id: string;
  name: string;
  fullName: string;
  prefix: string;
}

export const DEPARTMENTS: Department[] = [
  { id: "SCIT",  name: "SCIT",   fullName: "School of Computing and Information Technology", prefix: "SCT" },
  { id: "SoMMME", name: "SoMMME", fullName: "School of Mechanical, Manufacturing and Materials Engineering", prefix: "SOM" },
  { id: "SCDS",  name: "SCDS",   fullName: "School of Chemical and Metallurgical Engineering", prefix: "SCS" },
  { id: "SABS",  name: "SABS",   fullName: "School of Agriculture and Biotechnology", prefix: "SAS" },
  { id: "SOAES", name: "SOAES",  fullName: "School of Aerospace and Earth Sciences", prefix: "SOE" },
  { id: "SMPS",  name: "SMPS",   fullName: "School of Mathematics, Physics and Statistics", prefix: "SMS" },
];

export const defaultRoles: Role[] = [
  { id: "role_president",  name: "President",        votingLogic: "Plurality" },
  { id: "role_secretary",  name: "Secretary General", votingLogic: "Plurality" },
  { id: "role_academic",   name: "Academic Affairs",  votingLogic: "STV"      },
  { id: "role_treasurer",  name: "Treasurer",         votingLogic: "Plurality" },
];

// Default candidates — one set per department per role
const IMG = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&h=256&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&h=256&q=80",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=256&h=256&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&h=256&q=80",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=256&h=256&q=80",
  "https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=256&h=256&q=80",
];

function makeCandidates(deptId: string, names: string[][]): Candidate[] {
  return names.flatMap(([roleId, name, course], i) => ({
    id: `cand_${deptId}_${roleId}_${i}`,
    roleId,
    departmentId: deptId,
    name,
    course,
    imageUrl: IMG[i % IMG.length],
  }));
}

export const defaultCandidates: Candidate[] = [
  ...makeCandidates("SCIT", [
    ["role_president",  "Vanessa Kalondu",   "BSc Computer Technology"],
    ["role_president",  "Brian Otieno",      "BSc Computer Science"],
    ["role_secretary",  "Amina Hassan",      "BSc Information Technology"],
    ["role_secretary",  "Kevin Mwangi",      "BSc Software Engineering"],
    ["role_academic",   "Grace Njeri",       "BSc Computer Technology"],
    ["role_treasurer",  "Daniel Kiprop",     "BSc Information Technology"],
  ]),
  ...makeCandidates("SoMMME", [
    ["role_president",  "Felix Odhiambo",    "BSc Mechanical Engineering"],
    ["role_president",  "Lilian Waweru",     "BSc Manufacturing Engineering"],
    ["role_secretary",  "Samuel Karanja",    "BSc Mechatronics"],
    ["role_secretary",  "Peninah Achieng",   "BSc Mechanical Engineering"],
    ["role_academic",   "James Mutua",       "BSc Manufacturing Engineering"],
    ["role_treasurer",  "Ruth Wanjiku",      "BSc Mechatronics"],
  ]),
  ...makeCandidates("SCDS", [
    ["role_president",  "Moses Kamau",       "BSc Chemical Engineering"],
    ["role_president",  "Fatuma Omar",       "BSc Metallurgical Engineering"],
    ["role_secretary",  "Patrick Njoroge",   "BSc Chemical Engineering"],
    ["role_secretary",  "Lucy Muthoni",      "BSc Polymer Technology"],
    ["role_academic",   "George Owino",      "BSc Chemical Engineering"],
    ["role_treasurer",  "Anne Wambua",       "BSc Metallurgical Engineering"],
  ]),
  ...makeCandidates("SABS", [
    ["role_president",  "Charles Kimani",    "BSc Agriculture"],
    ["role_president",  "Mercy Auma",        "BSc Biotechnology"],
    ["role_secretary",  "Joseph Wachira",    "BSc Food Science"],
    ["role_secretary",  "Stella Ndungu",     "BSc Agriculture"],
    ["role_academic",   "Paul Muriuki",      "BSc Biotechnology"],
    ["role_treasurer",  "Clara Nyambura",    "BSc Food Science"],
  ]),
  ...makeCandidates("SOAES", [
    ["role_president",  "Victor Omondi",     "BSc Geospatial Engineering"],
    ["role_president",  "Zipporah Kerubo",   "BSc Environmental Science"],
    ["role_secretary",  "Allan Cheruiyot",   "BSc Meteorology"],
    ["role_secretary",  "Irene Wairimu",     "BSc Geospatial Engineering"],
    ["role_academic",   "Edwin Njuguna",     "BSc Environmental Science"],
    ["role_treasurer",  "Beatrice Moraa",    "BSc Meteorology"],
  ]),
  ...makeCandidates("SMPS", [
    ["role_president",  "Isaac Korir",       "BSc Mathematics"],
    ["role_president",  "Eunice Wanjiru",    "BSc Physics"],
    ["role_secretary",  "Timothy Maina",     "BSc Statistics"],
    ["role_secretary",  "Diana Cherono",     "BSc Mathematics"],
    ["role_academic",   "Stephen Gitau",     "BSc Physics"],
    ["role_treasurer",  "Harriet Atieno",    "BSc Statistics"],
  ]),
];

export function getDepartments(): Department[] {
  const data = localStorage.getItem("anonytech_departments");
  if (data) return JSON.parse(data);
  return DEPARTMENTS;
}

export function saveDepartments(departments: Department[]) {
  localStorage.setItem("anonytech_departments", JSON.stringify(departments));
}

export function getDepartmentFromStudentId(studentId: string): Department | null {
  const prefix = studentId.trim().toUpperCase().slice(0, 3);
  return getDepartments().find(d => d.prefix === prefix) || null;
}

export function saveVoterDepartment(deptId: string) {
  localStorage.setItem("anonytech_voter_dept", deptId);
}

export function getVoterDepartment(): Department | null {
  const id = localStorage.getItem("anonytech_voter_dept");
  if (!id) return null;
  return getDepartments().find(d => d.id === id) || null;
}

// ── Roles ──────────────────────────────────────────────────────────────────

export function getRoles(): Role[] {
  const data = localStorage.getItem("anonytech_roles");
  if (data) return JSON.parse(data);
  return defaultRoles;
}

export function saveRoles(roles: Role[]) {
  localStorage.setItem("anonytech_roles", JSON.stringify(roles));
}

// ── Candidates ─────────────────────────────────────────────────────────────

export function getCandidates(): Candidate[] {
  const data = localStorage.getItem("anonytech_candidates");
  if (data) return JSON.parse(data);
  return defaultCandidates;
}

export function getCandidatesForDepartment(deptId: string): Candidate[] {
  return getCandidates().filter(c => c.departmentId === deptId);
}

export function saveCandidates(candidates: Candidate[]) {
  localStorage.setItem("anonytech_candidates", JSON.stringify(candidates));
}

// ── Per-department election state ──────────────────────────────────────────

export interface DeptElectionState {
  isSealed: boolean;
  isTallyReleased: boolean;
  startDate: string;
  endDate: string;
}

const EMPTY_STATE: DeptElectionState = {
  isSealed: false, isTallyReleased: false, startDate: "", endDate: ""
};

export function getDeptElectionState(deptId: string): DeptElectionState {
  const data = localStorage.getItem(`anonytech_election_${deptId}`);
  if (data) return JSON.parse(data);
  return { ...EMPTY_STATE };
}

export function saveDeptElectionState(deptId: string, state: DeptElectionState) {
  localStorage.setItem(`anonytech_election_${deptId}`, JSON.stringify(state));
}

// ── Legacy single-election helpers (kept for voter dashboard compat) ────────

export function getIsTallyReleased(): boolean {
  const dept = getVoterDepartment();
  if (dept) return getDeptElectionState(dept.id).isTallyReleased;
  return localStorage.getItem("anonytech_tally_released") === "true";
}

export function setIsTallyReleased(released: boolean) {
  localStorage.setItem("anonytech_tally_released", released ? "true" : "false");
}

export function getElectionEndDate(): string | null {
  const dept = getVoterDepartment();
  if (dept) return getDeptElectionState(dept.id).endDate || null;
  return localStorage.getItem("anonytech_election_end_date");
}

export function setElectionEndDate(dateTime: string) {
  localStorage.setItem("anonytech_election_end_date", dateTime);
}

export function getElectionStartDate(): string | null {
  const dept = getVoterDepartment();
  if (dept) return getDeptElectionState(dept.id).startDate || null;
  return localStorage.getItem("anonytech_election_start_date");
}

export function setElectionStartDate(dateTime: string) {
  localStorage.setItem("anonytech_election_start_date", dateTime);
}

// ── Results ────────────────────────────────────────────────────────────────

export function getResults() {
  const data = localStorage.getItem("anonytech_results");
  if (data) return JSON.parse(data);
  return {};
}

export function saveResults(results: any) {
  localStorage.setItem("anonytech_results", JSON.stringify(results));
}

// ── Journey timestamps ─────────────────────────────────────────────────────

export function saveJourneyTimestamps(ts: { identityVerified: string; tunnelActive: string; choicesMade: string; ledgerUpdated: string }) {
  localStorage.setItem("anonytech_journey_timestamps", JSON.stringify(ts));
}

export function getJourneyTimestamps(): { identityVerified: string; tunnelActive: string; choicesMade: string; ledgerUpdated: string } | null {
  const data = localStorage.getItem("anonytech_journey_timestamps");
  if (data) return JSON.parse(data);
  return null;
}
// ── Manual voters ──────────────────────────────────────────────────────────

export interface ManualVoter {
  id: string;
  studentId: string;
  name: string;
  deptId: string;
  verified: boolean;
}

export function getManualVoters(): ManualVoter[] {
  const data = localStorage.getItem("anonytech_manual_voters");
  if (data) return JSON.parse(data);
  return [];
}

export function saveManualVoter(voter: ManualVoter) {
  const existing = getManualVoters();
  existing.push(voter);
  localStorage.setItem("anonytech_manual_voters", JSON.stringify(existing));
}

export function isRegisteredVoter(studentId: string): boolean {
  const manual = getManualVoters();
  if (manual.some(v => v.studentId.toLowerCase() === studentId.toLowerCase())) return true;
  return localStorage.getItem("csvUploaded") === "true";
}

// ── Coercion mode ──────────────────────────────────────────────────────────

export function setCoercionMode(value: boolean) {
  localStorage.setItem("anonytech_coercion_mode", value ? "true" : "false");
}

export function getCoercionMode(): boolean {
  return localStorage.getItem("anonytech_coercion_mode") === "true";
}

// ── Theme ──────────────────────────────────────────────────────────────────

export function getTheme(): "light" | "dark" {
  return (localStorage.getItem("anonytech_theme") as "light" | "dark") || "light";
}

export function setTheme(theme: "light" | "dark") {
  localStorage.setItem("anonytech_theme", theme);
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

// ── Admin password ─────────────────────────────────────────────────────────

export function getAdminPassword(): string {
  return localStorage.getItem("anonytech_admin_password") || "admin123";
}

export function setAdminPassword(password: string) {
  localStorage.setItem("anonytech_admin_password", password);
}

export function verifyAdminPassword(password: string): boolean {
  return password === getAdminPassword();
}