/**
 * INTEGRATION TESTS — Module-to-Module Connections
 * Tests how data flows between modules:
 *   Module 1 (Onboarding) → Module 2 (Tunnel)
 *   Module 2 (Tunnel) → Module 3 (Equalization)
 *   Module 3 (Equalization) → Module 4 (Ephemeral Handler)
 *   Module 1 (Admin) → Module 3 (Election Config)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDepartmentFromStudentId, saveVoterDepartment, getVoterDepartment,
  getCandidatesForDepartment,
  getDeptElectionState, saveDeptElectionState,
  getIsTallyReleased, getElectionEndDate,
  saveManualVoter, isRegisteredVoter, getManualVoters,
  setCoercionMode, getCoercionMode,
  saveDepartments, getDepartments,
  saveResults, getResults,
  saveJourneyTimestamps, getJourneyTimestamps,
} from '../../app/utils/dataStore';

beforeEach(() => {
  localStorage.clear();
});

// ── Module 1 → Module 2: Onboarding feeds the Tunnel ─────────────────────

describe('Module 1 → Module 2: Department detection feeds candidate loading', () => {

  it('should detect department at login and load correct ballot candidates', () => {
    // Module 1: Voter logs in with SCT student ID
    const dept = getDepartmentFromStudentId('SCT212-0159/2022');
    expect(dept).not.toBeNull();
    saveVoterDepartment(dept!.id);

    // Module 2: Ballot page reads voter department and loads candidates
    const voterDept = getVoterDepartment();
    expect(voterDept!.id).toBe('SCIT');
    const candidates = getCandidatesForDepartment(voterDept!.id);
    expect(candidates.length).toBe(6);
    candidates.forEach(c => expect(c.departmentId).toBe('SCIT'));
  });

  it('should isolate departments — SoMMME voter cannot see SCIT candidates', () => {
    const dept = getDepartmentFromStudentId('SOM211-0042/2023');
    saveVoterDepartment(dept!.id);
    const candidates = getCandidatesForDepartment(getVoterDepartment()!.id);
    expect(candidates.every(c => c.departmentId === 'SoMMME')).toBe(true);
    expect(candidates.some(c => c.departmentId === 'SCIT')).toBe(false);
  });
});

// ── Module 2 → Module 3: Tunnel feeds Equalization ────────────────────────

describe('Module 2 → Module 3: Coercion mode set in tunnel affects submission', () => {

  it('should carry Mode A flag from WelcomeBriefing through to SubmissionShield', () => {
    // Module 2: Voter selects Mode A in WelcomeBriefing
    setCoercionMode(true);

    // Module 3/4: SubmissionShield reads flag to mark ballot
    expect(getCoercionMode()).toBe(true);
    const isReal = !getCoercionMode();
    expect(isReal).toBe(false);
  });
});

// ── Module 3 → Module 4: Equalization state feeds Dashboard ───────────────

describe('Module 3 → Module 4: Election state drives voter dashboard', () => {

  it('should propagate sealed + end date to voter countdown', () => {
    saveVoterDepartment('SCIT');
    saveDeptElectionState('SCIT', {
      isSealed: true, isTallyReleased: false,
      startDate: '2025-07-15T08:00', endDate: '2025-07-15T17:00'
    });
    expect(getElectionEndDate()).toBe('2025-07-15T17:00');
    expect(getIsTallyReleased()).toBe(false);
  });

  it('should propagate tally release to voter dashboard', () => {
    saveVoterDepartment('SCIT');
    saveDeptElectionState('SCIT', {
      isSealed: true, isTallyReleased: true, startDate: '', endDate: ''
    });
    expect(getIsTallyReleased()).toBe(true);
  });
});

// ── Module 1 (Admin) → Module 3: Voter registration enables election ──────

describe('Module 1 (Admin) → Module 3: Voter registration enables participation', () => {

  it('should register voter manually then verify eligibility for voting', () => {
    expect(isRegisteredVoter('SCT212-0001/2024')).toBe(false);
    saveManualVoter({ id: 'v1', studentId: 'SCT212-0001/2024', name: 'Jane Doe', deptId: 'SCIT', verified: true });
    expect(isRegisteredVoter('SCT212-0001/2024')).toBe(true);
  });

  it('should grant universal eligibility after CSV upload', () => {
    expect(isRegisteredVoter('SCT212-9999/2024')).toBe(false);
    localStorage.setItem('csvUploaded', 'true');
    expect(isRegisteredVoter('SCT212-9999/2024')).toBe(true);
  });
});

// ── Module 1 (Admin) → Module 2: Custom department flows to ballot ────────

describe('Module 1 (Admin) → Module 2: Admin-created department detected at voter login', () => {

  it('should persist custom department and detect it from student ID', () => {
    const existing = getDepartments();
    saveDepartments([...existing, { id: 'SOED', name: 'SOED', fullName: 'School of Education', prefix: 'SOD' }]);
    const detected = getDepartmentFromStudentId('SOD210-0001/2024');
    expect(detected).not.toBeNull();
    expect(detected!.id).toBe('SOED');
  });
});

// ── Module 4 → Module 4: Results + Journey persistence ────────────────────

describe('Module 4: Post-submission data consistency', () => {

  it('should persist both results and journey timestamps after voting', () => {
    // Voter submits ballot
    saveResults({ selected: { role_president: 'cand_1' }, ranked: {}, timestamp: Date.now() });
    // Dashboard loads journey
    saveJourneyTimestamps({ identityVerified: '14:28', tunnelActive: '14:31', choicesMade: '14:32', ledgerUpdated: '14:32' });

    // Both should coexist
    expect(getResults().selected.role_president).toBe('cand_1');
    expect(getJourneyTimestamps()!.identityVerified).toBe('14:28');
  });
});