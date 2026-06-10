/**
 * UNIT TESTS — Module 1: Voter Onboarding
 * Tests: Login department detection, voter registration, admin authentication, PIN/OTP readiness
 * Privacy technique tested: Low-Literacy UI Shield (department auto-detection removes manual input)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDepartmentFromStudentId, saveVoterDepartment, getVoterDepartment,
  getManualVoters, saveManualVoter, isRegisteredVoter,
  getAdminPassword, setAdminPassword, verifyAdminPassword,
} from '../../app/utils/dataStore';

beforeEach(() => {
  localStorage.clear();
});

describe('Module 1 — Department Detection from Student ID', () => {

  it('should detect SCIT from SCT prefix', () => {
    const dept = getDepartmentFromStudentId('SCT212-0159/2022');
    expect(dept).not.toBeNull();
    expect(dept!.id).toBe('SCIT');
    expect(dept!.name).toBe('SCIT');
    expect(dept!.prefix).toBe('SCT');
  });

  it('should detect SoMMME from SOM prefix', () => {
    const dept = getDepartmentFromStudentId('SOM211-0042/2023');
    expect(dept).not.toBeNull();
    expect(dept!.id).toBe('SoMMME');
  });

  it('should detect SMPS from SMS prefix', () => {
    const dept = getDepartmentFromStudentId('SMS210-0001/2024');
    expect(dept).not.toBeNull();
    expect(dept!.id).toBe('SMPS');
  });

  it('should return null for unknown prefix', () => {
    expect(getDepartmentFromStudentId('XYZ999-0001/2024')).toBeNull();
  });

  it('should be case-insensitive', () => {
    const dept = getDepartmentFromStudentId('sct212-0159/2022');
    expect(dept).not.toBeNull();
    expect(dept!.id).toBe('SCIT');
  });

  it('should handle empty string', () => {
    expect(getDepartmentFromStudentId('')).toBeNull();
  });
});

describe('Module 1 — Voter Department Persistence', () => {

  it('should return null when no department is saved', () => {
    expect(getVoterDepartment()).toBeNull();
  });

  it('should save and retrieve voter department', () => {
    saveVoterDepartment('SCIT');
    const dept = getVoterDepartment();
    expect(dept).not.toBeNull();
    expect(dept!.id).toBe('SCIT');
    expect(dept!.fullName).toBe('School of Computing and Information Technology');
  });
});

describe('Module 1 — Voter Registration', () => {

  it('should register a manual voter', () => {
    expect(getManualVoters().length).toBe(0);
    saveManualVoter({ id: 'v1', studentId: 'SCT212-0001/2024', name: 'Jane Doe', deptId: 'SCIT', verified: true });
    expect(getManualVoters().length).toBe(1);
    expect(getManualVoters()[0].name).toBe('Jane Doe');
  });

  it('should verify registered voter eligibility', () => {
    expect(isRegisteredVoter('SCT212-0001/2024')).toBe(false);
    saveManualVoter({ id: 'v1', studentId: 'SCT212-0001/2024', name: 'Jane Doe', deptId: 'SCIT', verified: true });
    expect(isRegisteredVoter('SCT212-0001/2024')).toBe(true);
  });

  it('should be case-insensitive for student ID lookup', () => {
    saveManualVoter({ id: 'v1', studentId: 'SCT212-0001/2024', name: 'Jane Doe', deptId: 'SCIT', verified: true });
    expect(isRegisteredVoter('sct212-0001/2024')).toBe(true);
  });
});

describe('Module 1 — Admin Authentication', () => {

  it('should return default password admin123', () => {
    expect(getAdminPassword()).toBe('admin123');
  });

  it('should verify correct password', () => {
    expect(verifyAdminPassword('admin123')).toBe(true);
  });

  it('should reject incorrect password', () => {
    expect(verifyAdminPassword('wrongpassword')).toBe(false);
  });

  it('should allow password change', () => {
    setAdminPassword('newpass456');
    expect(verifyAdminPassword('newpass456')).toBe(true);
    expect(verifyAdminPassword('admin123')).toBe(false);
  });
});