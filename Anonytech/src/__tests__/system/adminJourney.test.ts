/**
 * SYSTEM TESTS — Admin Journey
 * Tests the complete admin data flow from configuration to tally release.
 * Simulates every data operation an admin performs when setting up and
 * running a multi-department election.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDepartments, saveDepartments,
  getRoles, saveRoles,
  getCandidates, saveCandidates, getCandidatesForDepartment,
  getDeptElectionState, saveDeptElectionState,
  getManualVoters, saveManualVoter, isRegisteredVoter,
  setAdminPassword, verifyAdminPassword,
  getDepartmentFromStudentId,
} from '../../app/utils/dataStore';

beforeEach(() => {
  localStorage.clear();
});

describe('Complete Admin Journey — Multi-Department Election Setup', () => {

  it('should set up a full election from scratch and release tally', () => {

    // ── STEP 1: ADMIN LOGIN ───────────────────────────────────────
    // Verify default password works
    expect(verifyAdminPassword('admin123')).toBe(true);

    // Admin changes password
    setAdminPassword('secure2025');
    expect(verifyAdminPassword('secure2025')).toBe(true);
    expect(verifyAdminPassword('admin123')).toBe(false);

    // ── STEP 2: CREATE DEPARTMENTS ────────────────────────────────
    // Admin uses the Registry tab to add departments
    const depts = getDepartments();
    expect(depts.length).toBe(6); // 6 default departments

    // Admin adds a custom department
    const newDept = { id: 'SOED', name: 'SOED', fullName: 'School of Education', prefix: 'SOD' };
    saveDepartments([...depts, newDept]);
    expect(getDepartments().length).toBe(7);

    // Verify it's now detectable from student IDs
    const detected = getDepartmentFromStudentId('SOD210-0001/2024');
    expect(detected!.id).toBe('SOED');

    // ── STEP 3: CREATE ROLES ──────────────────────────────────────
    const roles = getRoles();
    expect(roles.length).toBe(4); // 4 default roles

    // Admin adds a custom role
    saveRoles([...roles, { id: 'role_sports', name: 'Sports Rep', votingLogic: 'Plurality' }]);
    expect(getRoles().length).toBe(5);

    // ── STEP 4: ADD CANDIDATES ────────────────────────────────────
    const existing = getCandidates();

    // Admin adds a candidate to the new department for the new role
    const newCandidate = {
      id: 'cand_SOED_sports_1',
      roleId: 'role_sports',
      departmentId: 'SOED',
      name: 'Alice Wanjiru',
      course: 'BSc Education',
      imageUrl: ''
    };
    saveCandidates([...existing, newCandidate]);

    // Verify candidate is scoped to SOED only
    const soedCands = getCandidatesForDepartment('SOED');
    expect(soedCands.length).toBe(1);
    expect(soedCands[0].name).toBe('Alice Wanjiru');

    // SCIT candidates unaffected
    const scitCands = getCandidatesForDepartment('SCIT');
    expect(scitCands.length).toBe(6);

    // ── STEP 5: REGISTER VOTERS ───────────────────────────────────
    expect(getManualVoters().length).toBe(0);

    saveManualVoter({ id: 'v1', studentId: 'SCT212-0001/2024', name: 'Voter One', deptId: 'SCIT', verified: true });
    saveManualVoter({ id: 'v2', studentId: 'SOD210-0001/2024', name: 'Voter Two', deptId: 'SOED', verified: true });

    expect(getManualVoters().length).toBe(2);
    expect(isRegisteredVoter('SCT212-0001/2024')).toBe(true);
    expect(isRegisteredVoter('SOD210-0001/2024')).toBe(true);
    expect(isRegisteredVoter('XYZ000-0000/2024')).toBe(false);

    // ── STEP 6: CONFIGURE ELECTION TIMELINE ───────────────────────
    saveDeptElectionState('SCIT', {
      isSealed: false,
      isTallyReleased: false,
      startDate: '2025-07-15T08:00',
      endDate: '2025-07-15T17:00'
    });

    const scitState = getDeptElectionState('SCIT');
    expect(scitState.startDate).toBe('2025-07-15T08:00');
    expect(scitState.endDate).toBe('2025-07-15T17:00');

    // ── STEP 7: SEAL ALL ELECTIONS ────────────────────────────────
    const allDepts = getDepartments();
    allDepts.forEach(d => {
      const state = getDeptElectionState(d.id);
      saveDeptElectionState(d.id, { ...state, isSealed: true });
    });

    // Verify all are sealed
    allDepts.forEach(d => {
      expect(getDeptElectionState(d.id).isSealed).toBe(true);
    });

    // ── STEP 8: RELEASE TALLY ─────────────────────────────────────
    allDepts.forEach(d => {
      const state = getDeptElectionState(d.id);
      saveDeptElectionState(d.id, { ...state, isTallyReleased: true });
    });

    // Verify all tallies released
    allDepts.forEach(d => {
      expect(getDeptElectionState(d.id).isTallyReleased).toBe(true);
    });
  });
});

describe('Department Deletion Cascade', () => {

  it('should remove department candidates when department is deleted', () => {
    // Start with defaults
    const depts = getDepartments();
    const scitCandsBefore = getCandidatesForDepartment('SCIT');
    expect(scitCandsBefore.length).toBe(6);

    // Admin deletes SCIT department
    const remaining = depts.filter(d => d.id !== 'SCIT');
    saveDepartments(remaining);

    // Remove SCIT candidates too (as AdminRegistry does)
    const allCands = getCandidates();
    const filtered = allCands.filter(c => c.departmentId !== 'SCIT');
    saveCandidates(filtered);

    // Verify
    expect(getDepartments().length).toBe(5);
    expect(getCandidatesForDepartment('SCIT').length).toBe(0);

    // Other departments unaffected
    expect(getCandidatesForDepartment('SoMMME').length).toBe(6);
  });
});

describe('Election State Independence', () => {

  it('should maintain independent state per department', () => {
    // Seal SCIT but not SoMMME
    saveDeptElectionState('SCIT', {
      isSealed: true, isTallyReleased: false, startDate: '', endDate: ''
    });

    expect(getDeptElectionState('SCIT').isSealed).toBe(true);
    expect(getDeptElectionState('SoMMME').isSealed).toBe(false);

    // Release tally for SoMMME but not SCIT
    saveDeptElectionState('SoMMME', {
      isSealed: true, isTallyReleased: true, startDate: '', endDate: ''
    });

    expect(getDeptElectionState('SCIT').isTallyReleased).toBe(false);
    expect(getDeptElectionState('SoMMME').isTallyReleased).toBe(true);
  });
});