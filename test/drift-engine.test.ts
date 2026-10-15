import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DriftEngine } from '../src/engine/drift-engine.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';
import Drift from '../src/commands/drift.js';

describe('DriftEngine', () => {
  let engine: DriftEngine;
  const tempDir = path.join(process.cwd(), 'tmp-test-drift');

  beforeEach(() => {
    engine = new DriftEngine();
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseProfile: LoadedProfile = {
    name: 'Sales_Rep',
    filePath: '/path/to/Sales_Rep.profile-meta.xml',
    metadata: {
      custom: true,
      objectPermissions: [
        {
          object: 'Account',
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: false,
          viewAllRecords: false,
          modifyAllRecords: false,
        },
        {
          object: 'Contact',
          allowRead: true,
          allowCreate: true,
          allowEdit: false,
          allowDelete: false,
          viewAllRecords: false,
          modifyAllRecords: false,
        },
      ],
      fieldPermissions: [
        { field: 'Account.AnnualRevenue', readable: true, editable: true },
        { field: 'Account.AccountNumber', readable: true, editable: false },
      ],
      classAccesses: [{ apexClass: 'AccountDiscountCalculator', enabled: true }],
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
    },
  };

  it('detects zero drift when base and target are identical', () => {
    const report = engine.compareProfiles(baseProfile, baseProfile);
    expect(report.hasDrift).toBe(false);
    expect(report.totalDrifts).toBe(0);
    expect(report.overallSeverity).toBe('NONE');
  });

  it('detects added, removed, and modified object permissions and marks critical severity', () => {
    const targetProfile: LoadedProfile = {
      name: 'Sales_Rep',
      filePath: '/path/to/target/Sales_Rep.profile-meta.xml',
      metadata: {
        custom: true,
        objectPermissions: [
          // Account modified with allowDelete and modifyAllRecords
          {
            object: 'Account',
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: true,
            viewAllRecords: true,
            modifyAllRecords: true, // CRITICAL
          },
          // Contact removed
          // Opportunity added
          {
            object: 'Opportunity',
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: false,
            viewAllRecords: false,
            modifyAllRecords: false,
          },
        ],
        fieldPermissions: [
          // Account.AnnualRevenue modified to read-only
          { field: 'Account.AnnualRevenue', readable: true, editable: false },
          // Opportunity.Amount added
          { field: 'Opportunity.Amount', readable: true, editable: true },
        ],
        classAccesses: [
          // AccountDiscountCalculator removed
          // OpportunityManager added
          { apexClass: 'OpportunityManager', enabled: true },
        ],
        userPermissions: [
          { name: 'ApiEnabled', enabled: true },
          { name: 'ModifyAllData', enabled: true }, // CRITICAL added
        ],
      },
    };

    const report = engine.compareProfiles(baseProfile, targetProfile);
    expect(report.hasDrift).toBe(true);
    expect(report.totalDrifts).toBeGreaterThan(0);
    expect(report.overallSeverity).toBe('CRITICAL');

    // Check object drifts
    const objDrifts = report.drifts.filter((d) => d.category === 'Object');
    expect(objDrifts.some((d) => d.name === 'Account' && d.type === 'MODIFIED')).toBe(true);
    expect(objDrifts.some((d) => d.name === 'Contact' && d.type === 'REMOVED')).toBe(true);
    expect(objDrifts.some((d) => d.name === 'Opportunity' && d.type === 'ADDED')).toBe(true);

    // Check user perm drift
    const userDrifts = report.drifts.filter((d) => d.category === 'UserPermission');
    expect(userDrifts.some((d) => d.name === 'ModifyAllData' && d.type === 'ADDED' && d.severity === 'CRITICAL')).toBe(true);

    // Check apex drift
    const apexDrifts = report.drifts.filter((d) => d.category === 'ApexClass');
    expect(apexDrifts.some((d) => d.name === 'OpportunityManager' && d.type === 'ADDED')).toBe(true);
    expect(apexDrifts.some((d) => d.name === 'AccountDiscountCalculator' && d.type === 'REMOVED')).toBe(true);
  });

  it('generates a reconciliation Permission Set when requested', () => {
    const targetProfile: LoadedProfile = {
      name: 'Sales_Rep',
      filePath: '/path/to/Sales_Rep.profile-meta.xml',
      metadata: {
        custom: true,
        objectPermissions: [
          ...baseProfile.metadata.objectPermissions!,
          {
            object: 'Lead',
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: false,
          },
        ],
        fieldPermissions: [
          ...baseProfile.metadata.fieldPermissions!,
          { field: 'Lead.Rating', readable: true, editable: true },
        ],
      },
    };

    const report = engine.compareProfiles(baseProfile, targetProfile, {
      generateReconciliation: true,
      reconciliationOutputDir: tempDir,
      reconciliationName: 'Sales_Rep_Reconciled',
    });

    expect(report.hasDrift).toBe(true);
    expect(report.reconciliationPermissionSet).toBeDefined();
    expect(report.reconciliationPermissionSet?.apiName).toBe('Sales_Rep_Reconciled');

    const expectedFile = path.join(
      tempDir,
      'permissionsets',
      'Sales_Rep_Reconciled.permissionset-meta.xml'
    );
    expect(fs.existsSync(expectedFile)).toBe(true);

    const xml = fs.readFileSync(expectedFile, 'utf-8');
    expect(xml).toContain('<object>Lead</object>');
    expect(xml).toContain('<field>Lead.Rating</field>');
  });

  describe('compareProfileCollections', () => {
    it('compares lists of profiles and identifies missing profiles across sources', () => {
      const p1: LoadedProfile = { name: 'P1', filePath: '/p1.xml', metadata: { custom: true } };
      const p2: LoadedProfile = { name: 'P2', filePath: '/p2.xml', metadata: { custom: true } };
      const p3: LoadedProfile = { name: 'P3', filePath: '/p3.xml', metadata: { custom: true } };

      const baseList = [p1, p2];
      const targetList = [p2, p3];

      const multi = engine.compareProfileCollections(baseList, targetList, {
        baseLabel: 'Local',
        targetLabel: 'LiveOrg',
      });

      expect(multi.totalProfilesCompared).toBe(3);
      expect(multi.profilesWithDrift).toBe(2); // P1 missing in target, P3 added in target
      expect(multi.highestSeverity).toBe('HIGH');
    });
  });

  describe('Drift CLI command', () => {
    it('runs drift CLI and outputs formatted JSON', async () => {
      const fixtureProfile = path.join(__dirname, 'fixtures/profiles/Sales_User.profile-meta.xml');

      let logged = '';
      const logSpy = vi.spyOn(Drift.prototype, 'log').mockImplementation((m?: string) => {
        logged += (m || '') + '\n';
      });

      await Drift.run(['--base', fixtureProfile, '--target', fixtureProfile, '--json']);

      logSpy.mockRestore();
      expect(logged).toContain('"totalDriftsFound": 0');
      expect(logged).toContain('"highestSeverity": "NONE"');
    });
  });
});
