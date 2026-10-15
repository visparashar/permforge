import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComplianceEngine } from '../src/engine/compliance-engine.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';
import Compliance from '../src/commands/compliance.js';

describe('ComplianceEngine', () => {
  let engine: ComplianceEngine;
  const tempDir = path.join(process.cwd(), 'tmp-test-compliance');

  beforeEach(() => {
    engine = new ComplianceEngine();
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const compliantProfile: LoadedProfile = {
    name: 'Standard_User',
    filePath: '/path/to/Standard_User.profile-meta.xml',
    metadata: {
      custom: true,
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
      fieldPermissions: [{ field: 'Account.Name', readable: true, editable: true }],
      objectPermissions: [
        {
          object: 'Account',
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: false,
          modifyAllRecords: false,
          viewAllRecords: false,
        },
      ],
    },
  };

  const highRiskProfile: LoadedProfile = {
    name: 'Super_Admin',
    filePath: '/path/to/Super_Admin.profile-meta.xml',
    metadata: {
      custom: true,
      userPermissions: [
        { name: 'ModifyAllData', enabled: true },
        { name: 'ViewAllData', enabled: true },
        { name: 'AuthorApex', enabled: true },
        { name: 'ManageUsers', enabled: true },
        { name: 'ExportReport', enabled: true },
        { name: 'PasswordNeverExpires', enabled: true },
      ],
      fieldPermissions: [
        { field: 'Contact.Email', readable: true, editable: true },
        { field: 'Patient.Diagnosis__c', readable: true, editable: true },
      ],
      objectPermissions: [
        {
          object: 'Account',
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: true,
          modifyAllRecords: true,
          viewAllRecords: true,
        },
      ],
    },
  };

  it('reports COMPLIANT when no high-risk superuser or SoD violations exist', () => {
    const report = engine.auditCompliance([compliantProfile]);
    expect(report.overallStatus).toBe('COMPLIANT');
    expect(report.scorePercent).toBeGreaterThanOrEqual(90);
    expect(report.adminPrivileges).toHaveLength(0);
    expect(report.sodViolations).toHaveLength(0);
  });

  it('detects SOC 2, HIPAA, and ISO27001 violations in high-risk profiles', () => {
    const report = engine.auditCompliance([highRiskProfile]);
    expect(report.overallStatus).toBe('NON_COMPLIANT');
    expect(report.adminPrivileges.length).toBeGreaterThan(0);

    // SOC 2 Superuser & SoD verification
    expect(report.sodViolations.length).toBeGreaterThan(0);
    const sodConflicts = report.sodViolations.map((s) => s.conflictingPermissions.join('+'));
    expect(sodConflicts).toContain('AuthorApex+ModifyAllData');
    expect(sodConflicts).toContain('ManageUsers+ModifyAllData');

    // HIPAA ePHI verification
    const ephi = report.phiPiiAccesses.filter((p) => p.dataType === 'ePHI');
    expect(ephi.some((e) => e.objectOrField === 'Patient.Diagnosis__c')).toBe(true);

    // PasswordNeverExpires
    const isoControl = report.controlResults.find((c) => c.controlId === 'ISO27001-A.9.2');
    expect(isoControl?.status).toBe('NON_COMPLIANT');
  });

  it('generates full compliance evidence package files (HTML, CSV, Markdown)', () => {
    const report = engine.auditCompliance([compliantProfile, highRiskProfile], {
      outputDir: tempDir,
      generateArtifacts: true,
    });

    expect(report.exportedFiles).toBeDefined();
    expect(report.exportedFiles?.htmlReportPath).toBeDefined();
    expect(report.exportedFiles?.csvMatrixPath).toBeDefined();
    expect(report.exportedFiles?.markdownSummaryPath).toBeDefined();

    expect(fs.existsSync(report.exportedFiles!.htmlReportPath!)).toBe(true);
    expect(fs.existsSync(report.exportedFiles!.csvMatrixPath!)).toBe(true);
    expect(fs.existsSync(report.exportedFiles!.markdownSummaryPath!)).toBe(true);

    const html = fs.readFileSync(report.exportedFiles!.htmlReportPath!, 'utf-8');
    expect(html).toContain('PermForge SOC 2 & HIPAA Compliance Audit Package');
    expect(html).toContain('Super_Admin');

    const csv = fs.readFileSync(report.exportedFiles!.csvMatrixPath!, 'utf-8');
    expect(csv).toContain('"Super_Admin","Admin_Privilege","ModifyAllData"');
    expect(csv).toContain('Patient.Diagnosis__c');
  });

  describe('Compliance CLI command', () => {
    it('executes compliance CLI and outputs formatted JSON', async () => {
      const fixtureDir = path.join(__dirname, 'fixtures/profiles');

      let logged = '';
      const logSpy = vi.spyOn(Compliance.prototype, 'log').mockImplementation((m?: string) => {
        logged += (m || '') + '\n';
      });

      await Compliance.run(['--source', fixtureDir, '--json', '--no-export']);

      logSpy.mockRestore();
      expect(logged).toContain('"frameworksAudited"');
      expect(logged).toContain('"overallStatus"');
      expect(logged).toContain('"scorePercent"');
    });
  });
});
