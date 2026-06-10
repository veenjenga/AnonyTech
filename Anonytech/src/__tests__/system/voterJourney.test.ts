/**
 * SYSTEM TESTS — Voter Journey
 * Tests the complete voter data flow from login to post-vote dashboard.
 * Simulates every data operation that happens during a real voting session,
 * verifying the entire pipeline works end to end.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDepartmentFromStudentId, saveVoterDepartment, getVoterDepartment,
  getCandidatesForDepartment,
  saveDeptElectionState, getDeptElectionState,
  getIsTallyReleased, getElectionEndDate,
  setCoercionMode, getCoercionMode,
  saveResults, getResults,
  saveJourneyTimestamps, getJourneyTimestamps,
} from '../../app/utils/dataStore';

beforeEach(() => {
  localStorage.clear();
});

describe('Complete Voter Journey — Mode B (Real Vote)', () => {

  it('should complete the full voting data flow from login to dashboard', () => {

    // ── STEP 1: LOGIN ─────────────────────────────────────────────
    // Voter enters student ID: SCT212-0159/2022
    const dept = getDepartmentFromStudentId('SCT212-0159/2022');
    expect(dept).not.toBeNull();
    expect(dept!.id).toBe('SCIT');

    // LoginPage saves voter department
    saveVoterDepartment(dept!.id);
    expect(getVoterDepartment()!.id).toBe('SCIT');

    // ── STEP 2: WELCOME BRIEFING ──────────────────────────────────
    // Voter selects Mode B (real vote) — coercion mode stays false
    expect(getCoercionMode()).toBe(false);

    // ── STEP 3: BALLOT ────────────────────────────────────────────
    // BallotPage loads candidates for SCIT only
    const candidates = getCandidatesForDepartment('SCIT');
    expect(candidates.length).toBe(6);
    expect(candidates.every(c => c.departmentId === 'SCIT')).toBe(true);

    // Voter makes selections
    const results = {
      selected: { role_president: 'cand_SCIT_role_president_0' },
      ranked: {},
      timestamp: Date.now()
    };
    saveResults(results);

    // ── STEP 4: SUBMISSION SHIELD ─────────────────────────────────
    // Coercion mode is false — ballot marked as real
    expect(getCoercionMode()).toBe(false);

    // Results are persisted
    const saved = getResults();
    expect(saved.selected.role_president).toBe('cand_SCIT_role_president_0');

    // ── STEP 5: POST-VOTE DASHBOARD ───────────────────────────────
    // Journey timestamps saved on first dashboard load
    const timestamps = {
      identityVerified: '14:28',
      tunnelActive: '14:31',
      choicesMade: '14:32',
      ledgerUpdated: '14:32'
    };
    saveJourneyTimestamps(timestamps);

    const journey = getJourneyTimestamps();
    expect(journey).not.toBeNull();
    expect(journey!.identityVerified).toBe('14:28');
    expect(journey!.ledgerUpdated).toBe('14:32');

    // ── STEP 6: ELECTION STATUS CHECK ─────────────────────────────
    // Admin has not released tally yet
    expect(getIsTallyReleased()).toBe(false);

    // Voter sees countdown to election end
    saveDeptElectionState('SCIT', {
      isSealed: true,
      isTallyReleased: false,
      startDate: '2025-07-15T08:00',
      endDate: '2025-07-15T17:00'
    });
    expect(getElectionEndDate()).toBe('2025-07-15T17:00');

    // ── STEP 7: TALLY RELEASED ────────────────────────────────────
    // Admin releases tally
    saveDeptElectionState('SCIT', {
      isSealed: true,
      isTallyReleased: true,
      startDate: '2025-07-15T08:00',
      endDate: '2025-07-15T17:00'
    });

    // Voter dashboard detects tally release
    expect(getIsTallyReleased()).toBe(true);
  });
});

describe('Complete Voter Journey — Mode A (Coercion Safety Vote)', () => {

  it('should mark ballot as coercion mode when Mode A is selected', () => {

    // Login
    const dept = getDepartmentFromStudentId('SCT212-0159/2022');
    saveVoterDepartment(dept!.id);

    // Voter selects Mode A (coercion safety vote)
    setCoercionMode(true);
    expect(getCoercionMode()).toBe(true);

    // Ballot proceeds normally — candidates load as usual
    const candidates = getCandidatesForDepartment('SCIT');
    expect(candidates.length).toBe(6);

    // Voter submits — SubmissionShield reads coercion flag
    expect(getCoercionMode()).toBe(true);
    // In real system, ballot is saved with isReal: false on the bulletin board

    // After submission, coercion mode is reset
    setCoercionMode(false);
    expect(getCoercionMode()).toBe(false);
  });
});

describe('Cross-Department Isolation', () => {

  it('should prevent SCIT voter from seeing SoMMME candidates', () => {
    saveVoterDepartment('SCIT');
    const scitCands = getCandidatesForDepartment(getVoterDepartment()!.id);
    const sommeCands = getCandidatesForDepartment('SoMMME');

    // Both departments have candidates
    expect(scitCands.length).toBeGreaterThan(0);
    expect(sommeCands.length).toBeGreaterThan(0);

    // No overlap — zero shared candidates
    const scitIds = new Set(scitCands.map(c => c.id));
    const sommeIds = new Set(sommeCands.map(c => c.id));
    const overlap = [...scitIds].filter(id => sommeIds.has(id));
    expect(overlap.length).toBe(0);
  });

  it('should show tally only for the voters own department', () => {
    // SCIT voter
    saveVoterDepartment('SCIT');

    // Only SoMMME tally released, SCIT still active
    saveDeptElectionState('SoMMME', {
      isSealed: true, isTallyReleased: true, startDate: '', endDate: ''
    });
    saveDeptElectionState('SCIT', {
      isSealed: true, isTallyReleased: false, startDate: '', endDate: ''
    });

    // SCIT voter should NOT see tally released
    expect(getIsTallyReleased()).toBe(false);

    // Now SCIT tally released too
    saveDeptElectionState('SCIT', {
      isSealed: true, isTallyReleased: true, startDate: '', endDate: ''
    });
    expect(getIsTallyReleased()).toBe(true);
  });
});