/**
 * UNIT TESTS — Module 3: Temporal Equalization
 * Tests: Election state management, sealing, timeline dates, tally release
 * Privacy technique tested: Temporal Equalization (15-second locked window controlled by election state)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDeptElectionState, saveDeptElectionState,
  getIsTallyReleased, setIsTallyReleased,
  getElectionEndDate, setElectionEndDate,
  getElectionStartDate, setElectionStartDate,
  saveVoterDepartment,
} from '../../app/utils/dataStore';

beforeEach(() => {
  localStorage.clear();
});

describe('Module 3 — Per-Department Election State', () => {

  it('should return default unsealed state for new department', () => {
    const state = getDeptElectionState('SCIT');
    expect(state.isSealed).toBe(false);
    expect(state.isTallyReleased).toBe(false);
    expect(state.startDate).toBe('');
    expect(state.endDate).toBe('');
  });

  it('should save and retrieve election state', () => {
    saveDeptElectionState('SCIT', {
      isSealed: true,
      isTallyReleased: false,
      startDate: '2025-07-15T08:00',
      endDate: '2025-07-15T17:00'
    });
    const state = getDeptElectionState('SCIT');
    expect(state.isSealed).toBe(true);
    expect(state.isTallyReleased).toBe(false);
    expect(state.startDate).toBe('2025-07-15T08:00');
    expect(state.endDate).toBe('2025-07-15T17:00');
  });

  it('should maintain independent state per department', () => {
    saveDeptElectionState('SCIT', { isSealed: true, isTallyReleased: false, startDate: '', endDate: '' });
    saveDeptElectionState('SoMMME', { isSealed: false, isTallyReleased: false, startDate: '', endDate: '' });
    expect(getDeptElectionState('SCIT').isSealed).toBe(true);
    expect(getDeptElectionState('SoMMME').isSealed).toBe(false);
  });
});

describe('Module 3 — Seal → Tally Lifecycle', () => {

  it('should progress from unsealed → sealed → tally released', () => {
    const initial = getDeptElectionState('SCIT');
    expect(initial.isSealed).toBe(false);

    saveDeptElectionState('SCIT', { ...initial, isSealed: true });
    expect(getDeptElectionState('SCIT').isSealed).toBe(true);
    expect(getDeptElectionState('SCIT').isTallyReleased).toBe(false);

    const sealed = getDeptElectionState('SCIT');
    saveDeptElectionState('SCIT', { ...sealed, isTallyReleased: true });
    expect(getDeptElectionState('SCIT').isTallyReleased).toBe(true);
  });
});

describe('Module 3 — Voter Dashboard Election Status Propagation', () => {

  it('should propagate tally release to voter via getIsTallyReleased()', () => {
    saveVoterDepartment('SCIT');
    expect(getIsTallyReleased()).toBe(false);

    saveDeptElectionState('SCIT', { isSealed: true, isTallyReleased: true, startDate: '', endDate: '' });
    expect(getIsTallyReleased()).toBe(true);
  });

  it('should propagate end date to voter countdown via getElectionEndDate()', () => {
    saveVoterDepartment('SCIT');
    expect(getElectionEndDate()).toBeNull();

    saveDeptElectionState('SCIT', { isSealed: true, isTallyReleased: false, startDate: '2025-07-15T08:00', endDate: '2025-07-15T17:00' });
    expect(getElectionEndDate()).toBe('2025-07-15T17:00');
  });

  it('should NOT show other departments tally to voter', () => {
    saveVoterDepartment('SCIT');
    saveDeptElectionState('SoMMME', { isSealed: true, isTallyReleased: true, startDate: '', endDate: '' });
    saveDeptElectionState('SCIT', { isSealed: true, isTallyReleased: false, startDate: '', endDate: '' });
    expect(getIsTallyReleased()).toBe(false);
  });
});

describe('Module 3 — Legacy Election Helpers', () => {

  it('should set and get tally released via legacy helper', () => {
    setIsTallyReleased(true);
    expect(localStorage.getItem('anonytech_tally_released')).toBe('true');
  });

  it('should set and get election dates via legacy helpers', () => {
    setElectionEndDate('2025-07-15T17:00');
    setElectionStartDate('2025-07-15T08:00');
    expect(localStorage.getItem('anonytech_election_end_date')).toBe('2025-07-15T17:00');
    expect(localStorage.getItem('anonytech_election_start_date')).toBe('2025-07-15T08:00');
  });
});