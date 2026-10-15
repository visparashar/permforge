import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModernizationAdvisor } from '../src/engine/modernization-advisor.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';

describe('ModernizationAdvisor', () => {
  let advisor: ModernizationAdvisor;
  const tempDir = path.join(process.cwd(), 'tmp-test-advisor');

  beforeEach(() => {
    advisor = new ModernizationAdvisor();
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const sampleProfile: LoadedProfile = {
    name: 'Custom_Sales_Agent',
    filePath: '/path/to/Custom_Sales_Agent.profile-meta.xml',
    metadata: {
      custom: true,
      customPermissions: [{ name: 'Discount_Approver', enabled: true }],
      fieldPermissions: [
        { field: 'Account.AnnualRevenue', readable: true, editable: true },
        { field: 'Account.AccountNumber', readable: true, editable: false },
        { field: 'Opportunity.Amount', readable: true, editable: true },
        { field: 'Opportunity.ContractNumber', readable: true, editable: false },
      ],
      recordTypeVisibilities: [
        { recordType: 'Opportunity.Enterprise', default: true, visible: true },
        { recordType: 'Opportunity.SMB', default: false, visible: true },
        { recordType: 'Account.Customer', default: true, visible: true },
        { recordType: 'Account.Partner', default: false, visible: true },
        { recordType: 'Case.Internal', default: false, visible: false }, // not visible
      ],
    },
  };

  describe('decoupleRecordTypes', () => {
    it('separates default record types and decouples non-default visible record types', () => {
      const result = advisor.decoupleRecordTypes(sampleProfile);

      expect(result.totalRecordTypes).toBe(5);
      expect(result.defaultsKeptOnProfile).toHaveLength(2);
      expect(result.defaultsKeptOnProfile.map((r) => r.recordType)).toEqual([
        'Opportunity.Enterprise',
        'Account.Customer',
      ]);

      expect(result.decoupledRecordTypes).toHaveLength(2);
      expect(result.decoupledRecordTypes.map((r) => r.recordType)).toEqual([
        'Opportunity.SMB',
        'Account.Partner',
      ]);

      expect(result.generatedPermissionSets).toHaveLength(1);
      const ps = result.generatedPermissionSets[0];
      expect(ps.apiName).toBe('Custom_Sales_Agent_RecordTypes');
      expect(ps.metadata.recordTypeVisibilities).toHaveLength(2);

      // Verify retained defaults on profile
      expect(result.retainedProfileRecordTypes).toHaveLength(2);
      expect(result.retainedProfileRecordTypes[0].default).toBe(true);
    });

    it('supports separating decoupled record types into per-object Permission Sets', () => {
      const result = advisor.decoupleRecordTypes(sampleProfile, {
        separateByObject: true,
        outputDir: tempDir,
      });

      expect(result.generatedPermissionSets).toHaveLength(2);
      const apiNames = result.generatedPermissionSets.map((p) => p.apiName);
      expect(apiNames).toContain('Custom_Sales_Agent_RT_Opportunity');
      expect(apiNames).toContain('Custom_Sales_Agent_RT_Account');

      // Verify files written to disk
      const psDir = path.join(tempDir, 'permissionsets');
      expect(fs.existsSync(path.join(psDir, 'Custom_Sales_Agent_RT_Opportunity.permissionset-meta.xml'))).toBe(true);
      expect(fs.existsSync(path.join(psDir, 'Custom_Sales_Agent_RT_Account.permissionset-meta.xml'))).toBe(true);
    });

    it('returns empty result when profile has no record types', () => {
      const emptyProfile: LoadedProfile = {
        name: 'No_RT_Profile',
        filePath: '/path/to/No_RT_Profile.profile-meta.xml',
        metadata: { custom: true },
      };

      const result = advisor.decoupleRecordTypes(emptyProfile);
      expect(result.totalRecordTypes).toBe(0);
      expect(result.generatedPermissionSets).toEqual([]);
      expect(result.decoupledRecordTypes).toEqual([]);
    });
  });

  describe('analyzeDynamicFormsReadiness', () => {
    it('analyzes field permissions and identifies UI read-only candidates for Dynamic Forms', () => {
      const advisory = advisor.analyzeDynamicFormsReadiness(sampleProfile);

      expect(advisory.profileName).toBe('Custom_Sales_Agent');
      expect(advisory.overallReadinessScore).toBeGreaterThanOrEqual(80);
      expect(advisory.analyzedObjects).toHaveLength(2); // Account and Opportunity

      const accountObj = advisory.analyzedObjects.find((o) => o.objectName === 'Account')!;
      expect(accountObj.totalFields).toBe(2);
      expect(accountObj.readOnlyFieldsCount).toBe(1);
      expect(accountObj.editableFieldsCount).toBe(1);
      expect(accountObj.status).toBe('Ready');

      const candidate = accountObj.candidates[0];
      expect(candidate.field).toBe('Account.AccountNumber');
      expect(candidate.isReadOnlyInProfile).toBe(true);
      expect(candidate.suggestedVisibilityRule).toContain('$Permission.Discount_Approver');

      expect(advisory.keyRecommendations.length).toBeGreaterThan(0);
      expect(advisory.keyRecommendations.some((r) => r.includes("Object 'Account'"))).toBe(true);
      expect(advisory.keyRecommendations.some((r) => r.includes('Record Types: Decouple'))).toBe(true);
    });
  });
});
