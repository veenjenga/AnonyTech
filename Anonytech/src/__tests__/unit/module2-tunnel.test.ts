/**
 * UNIT TESTS — Module 2: Linear Interaction Tunnel
 * Tests: Role loading, candidate filtering by department, voting method configuration
 * Privacy technique tested: Navigation Standardization (locked sequential path, department-scoped ballots)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRoles, saveRoles,
  getCandidates, getCandidatesForDepartment, saveCandidates,
  getDepartments, saveDepartments,
  setCoercionMode, getCoercionMode,
} from '../../app/utils/dataStore';

beforeEach(() => {
  localStorage.clear();
});

describe('Module 2 — Role Configuration', () => {

  it('should return 4 default roles', () => {
    const roles = getRoles();
    expect(roles.length).toBe(4);
    expect(roles[0].name).toBe('President');
    expect(roles[1].name).toBe('Secretary General');
    expect(roles[2].name).toBe('Academic Affairs');
    expect(roles[3].name).toBe('Treasurer');
  });

  it('should save and retrieve custom roles', () => {
    saveRoles([{ id: 'role_test', name: 'Sports Rep', votingLogic: 'Plurality' }]);
    const roles = getRoles();
    expect(roles.length).toBe(1);
    expect(roles[0].name).toBe('Sports Rep');
  });

  it('should preserve voting logic per role', () => {
    const roles = getRoles();
    expect(roles.find(r => r.id === 'role_academic')!.votingLogic).toBe('STV');
    expect(roles.find(r => r.id === 'role_president')!.votingLogic).toBe('Plurality');
  });
});

describe('Module 2 — Department-Scoped Candidate Loading', () => {

  it('should return default candidates when none saved', () => {
    expect(getCandidates().length).toBeGreaterThan(0);
  });

  it('should filter candidates by SCIT department — exactly 6', () => {
    const scitCands = getCandidatesForDepartment('SCIT');
    expect(scitCands.length).toBe(6);
    scitCands.forEach(c => expect(c.departmentId).toBe('SCIT'));
  });

  it('should filter candidates by SoMMME department — exactly 6', () => {
    const sommeCands = getCandidatesForDepartment('SoMMME');
    expect(sommeCands.length).toBe(6);
    sommeCands.forEach(c => expect(c.departmentId).toBe('SoMMME'));
  });

  it('should return empty array for non-existent department', () => {
    expect(getCandidatesForDepartment('NONEXISTENT').length).toBe(0);
  });

  it('should save and retrieve custom candidates', () => {
    saveCandidates([{ id: 'c1', roleId: 'role_president', departmentId: 'SCIT', name: 'Test', course: 'BSc', imageUrl: '' }]);
    expect(getCandidates().length).toBe(1);
    expect(getCandidatesForDepartment('SCIT').length).toBe(1);
  });

  it('should ensure zero overlap between department candidate pools', () => {
    const scitIds = new Set(getCandidatesForDepartment('SCIT').map(c => c.id));
    const sommeIds = new Set(getCandidatesForDepartment('SoMMME').map(c => c.id));
    const overlap = [...scitIds].filter(id => sommeIds.has(id));
    expect(overlap.length).toBe(0);
  });
});

describe('Module 2 — Mode A/B Selection (Coercion Flag)', () => {

  it('should default to Mode B (coercion mode false)', () => {
    expect(getCoercionMode()).toBe(false);
  });

  it('should set Mode A (coercion mode true)', () => {
    setCoercionMode(true);
    expect(getCoercionMode()).toBe(true);
  });

  it('should reset back to Mode B after submission', () => {
    setCoercionMode(true);
    expect(getCoercionMode()).toBe(true);
    setCoercionMode(false);
    expect(getCoercionMode()).toBe(false);
  });
});