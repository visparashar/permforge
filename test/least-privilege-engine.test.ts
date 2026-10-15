import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LeastPrivilegeEngine } from '../src/engine/least-privilege-engine.js';
import { ProfileReader, LoadedProfile } from '../src/parser/profile-reader.js';
import Prune from '../src/commands/prune.js';

describe('LeastPrivilegeEngine', () => {
  let engine: LeastPrivilegeEngine;
  const tempDir = path.join(process.cwd(), 'tmp-test-least-privilege');

  beforeEach(() => {
    engine = new LeastPrivilegeEngine();
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseEvents', () => {
    it('parses CSV telemetry with SObjects, fields, Apex, and user actions', () => {
      const csv = `TIMESTAMP,EVENT_TYPE,USER_ID,ENTITY_NAME,APEX_NAME,ACTION_TYPE
2026-10-01T08:12:00.000Z,UriEvent,005000000000001,/services/data/v60.0/sobjects/Account,,READ
2026-10-01T08:15:30.000Z,RestApiEvent,005000000000001,Opportunity,,EDIT
2026-10-01T09:20:00.000Z,ApexExecution,005000000000001,,OpportunityDiscountHelper,EXECUTE
2026-10-02T11:05:00.000Z,UriEvent,005000000000001,Account.AnnualRevenue,,READ
2026-10-03T10:15:00.000Z,ApiEvent,005000000000001,,,ApiEnabled`;

      const footprint = engine.parseEvents(csv);
      expect(footprint.totalEventsCount).toBe(5);
      expect(footprint.accessedObjects.has('Account')).toBe(true);
      expect(footprint.accessedObjects.has('Opportunity')).toBe(true);
      expect(footprint.accessedFields.has('Account.AnnualRevenue')).toBe(true);
      expect(footprint.executedApexClasses.has('OpportunityDiscountHelper')).toBe(true);
      expect(footprint.exercisedUserPermissions.has('ApiEnabled')).toBe(true);
      expect(footprint.accessedObjectActions.get('Opportunity')?.has('EDIT')).toBe(true);
    });

    it('parses JSON telemetry array', () => {
      const jsonEvents = JSON.stringify([
        {
          timestamp: '2026-10-01T00:00:00.000Z',
          eventType: 'UriEvent',
          entityName: 'Lead',
          actionType: 'CREATE',
        },
        {
          timestamp: '2026-10-01T00:01:00.000Z',
          eventType: 'ApexExecution',
          apexName: 'LeadProcessor',
        },
      ]);

      const footprint = engine.parseEvents(jsonEvents);
      expect(footprint.totalEventsCount).toBe(2);
      expect(footprint.accessedObjects.has('Lead')).toBe(true);
      expect(footprint.executedApexClasses.has('LeadProcessor')).toBe(true);
    });

    it('handles empty or malformed telemetry gracefully', () => {
      const footprint = engine.parseEvents('');
      expect(footprint.totalEventsCount).toBe(0);
      expect(footprint.accessedObjects.size).toBe(0);
    });
  });

  describe('auditProfile', () => {
    const mockProfile: LoadedProfile = {
      name: 'Custom_Support_Rep',
      filePath: '/path/to/Custom_Support_Rep.profile-meta.xml',
      metadata: {
        custom: true,
        objectPermissions: [
          {
            object: 'Case',
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: false,
            viewAllRecords: false,
            modifyAllRecords: false,
          },
          {
            object: 'Order',
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: true,
            viewAllRecords: false,
            modifyAllRecords: true, // Critical dormant risk
          },
        ],
        fieldPermissions: [
          { field: 'Case.Subject', readable: true, editable: true },
          { field: 'Case.Status', readable: true, editable: true },
          { field: 'Order.TotalAmount', readable: true, editable: false },
        ],
        classAccesses: [
          { apexClass: 'CaseCloseController', enabled: true },
          { apexClass: 'OrderProcessingJob', enabled: true },
        ],
        userPermissions: [
          { name: 'ApiEnabled', enabled: true },
          { name: 'ModifyAllData', enabled: true }, // Critical dormant risk
        ],
      },
    };

    it('computes dormant permissions, utilization %, and over-privilege score', async () => {
      const footprint = engine.parseEvents(`TIMESTAMP,EVENT_TYPE,USER_ID,ENTITY_NAME,APEX_NAME,ACTION_TYPE
2026-10-01T00:00:00Z,UriEvent,00501,Case,,READ
2026-10-01T00:01:00Z,UriEvent,00501,Case.Subject,,EDIT
2026-10-01T00:02:00Z,ApexExecution,00501,,CaseCloseController,EXECUTE
2026-10-01T00:03:00Z,ApiEvent,00501,,,ApiEnabled`);

      const report = await engine.auditProfile(mockProfile, footprint, {
        mode: 'audit-only',
      });

      expect(report.profileName).toBe('Custom_Support_Rep');
      expect(report.totalPermissionsGranted).toBe(9); // 2 objects, 3 fields, 2 apex, 2 user
      expect(report.exercisedPermissionsCount).toBe(4); // Case, Case.Subject, CaseCloseController, ApiEnabled
      expect(report.dormantPermissionsCount).toBeGreaterThan(0);
      expect(report.utilizationRatePercent).toBe(44); // 4/9 = 44%
      expect(report.overPrivilegeScore).toBe(56); // 100 - 44 = 56%
      expect(report.dormantRiskLevel).toBe('CRITICAL'); // because of ModifyAllData and Order ModifyAllRecords

      const criticalPerms = report.dormantPermissions.filter((d) => d.riskLevel === 'CRITICAL');
      expect(criticalPerms.some((d) => d.name === 'ModifyAllData')).toBe(true);
      expect(criticalPerms.some((d) => d.name === 'Order')).toBe(true);
    });

    it('generates a pruned least-privilege permission set in prune mode', async () => {
      const footprint = engine.parseEvents(`TIMESTAMP,EVENT_TYPE,USER_ID,ENTITY_NAME,APEX_NAME,ACTION_TYPE
2026-10-01T00:00:00Z,UriEvent,00501,Case,,READ
2026-10-01T00:01:00Z,UriEvent,00501,Case.Subject,,EDIT
2026-10-01T00:02:00Z,ApexExecution,00501,,CaseCloseController,EXECUTE
2026-10-01T00:03:00Z,ApiEvent,00501,,,ApiEnabled`);

      const report = await engine.auditProfile(mockProfile, footprint, {
        mode: 'prune',
        outputDir: tempDir,
        prunedName: 'Support_Rep_Pruned',
      });

      expect(report.generatedPrunedPermissionSet).toBeDefined();
      expect(report.generatedPrunedPermissionSet?.apiName).toBe('Support_Rep_Pruned');

      const expectedFile = path.join(
        tempDir,
        'permissionsets',
        'Support_Rep_Pruned.permissionset-meta.xml'
      );
      expect(fs.existsSync(expectedFile)).toBe(true);

      const xmlContent = fs.readFileSync(expectedFile, 'utf-8');
      expect(xmlContent).toContain('<object>Case</object>');
      expect(xmlContent).not.toContain('<object>Order</object>');
      expect(xmlContent).toContain('<apexClass>CaseCloseController</apexClass>');
      expect(xmlContent).not.toContain('<apexClass>OrderProcessingJob</apexClass>');
      expect(xmlContent).not.toContain('<name>ModifyAllData</name>');
    });

    it('generates a muting permission set in mute mode', async () => {
      const footprint = engine.parseEvents(`TIMESTAMP,EVENT_TYPE,USER_ID,ENTITY_NAME,APEX_NAME,ACTION_TYPE
2026-10-01T00:00:00Z,UriEvent,00501,Case,,READ
2026-10-01T00:03:00Z,ApiEvent,00501,,,ApiEnabled`);

      const report = await engine.auditProfile(mockProfile, footprint, {
        mode: 'mute',
        outputDir: tempDir,
        mutingName: 'Support_Rep_Mute_Dormant',
      });

      expect(report.generatedMutingPermissionSet).toBeDefined();
      expect(report.generatedMutingPermissionSet?.apiName).toBe('Support_Rep_Mute_Dormant');

      const expectedMuteFile = path.join(
        tempDir,
        'mutingpermissionsets',
        'Support_Rep_Mute_Dormant.mutingpermissionset-meta.xml'
      );
      expect(fs.existsSync(expectedMuteFile)).toBe(true);

      const xmlContent = fs.readFileSync(expectedMuteFile, 'utf-8');
      expect(xmlContent).toContain('<hasActivationRequired>false</hasActivationRequired>');
      expect(xmlContent).toContain('MutingPermissionSet');
    });
  });

  describe('Integration with sample_events.csv and Sales_User.profile-meta.xml', () => {
    it('accurately audits Sales_User profile against sample_events.csv', async () => {
      const reader = new ProfileReader();
      const profilePath = path.join(__dirname, 'fixtures/profiles/Sales_User.profile-meta.xml');
      const eventsPath = path.join(__dirname, 'fixtures/event_logs/sample_events.csv');

      const profile = await reader.loadProfile(profilePath);
      const eventsCsv = fs.readFileSync(eventsPath, 'utf-8');

      const footprint = engine.parseEvents(eventsCsv);
      const report = await engine.auditProfile(profile, footprint);

      expect(report.profileName).toBe('Sales_User');
      expect(report.exercisedPermissionsCount).toBeGreaterThan(0);
      expect(report.dormantPermissionsCount).toBeGreaterThan(0);
      expect(report.utilizationRatePercent).toBeGreaterThan(0);
      expect(report.overPrivilegeScore).toBeGreaterThan(0);

      // Verify Account and Opportunity are exercised
      expect(report.exercisedPermissions.some((e) => e.name === 'Account')).toBe(true);
      expect(report.exercisedPermissions.some((e) => e.name === 'Opportunity')).toBe(true);

      // Verify Contact is dormant
      expect(report.dormantPermissions.some((d) => d.name === 'Contact')).toBe(true);
    });
  });

  describe('Prune CLI command', () => {
    it('executes prune CLI with --json output', async () => {
      const profilePath = path.join(__dirname, 'fixtures/profiles/Sales_User.profile-meta.xml');
      const eventsPath = path.join(__dirname, 'fixtures/event_logs/sample_events.csv');

      let loggedOutput = '';
      const logSpy = vi.spyOn(Prune.prototype, 'log').mockImplementation((msg?: string) => {
        loggedOutput += (msg || '') + '\n';
      });

      await Prune.run(['--profile', profilePath, '--events', eventsPath, '--json']);

      logSpy.mockRestore();
      expect(loggedOutput).toContain('"profileName": "Sales_User"');
      expect(loggedOutput).toContain('"overPrivilegeScore"');
    });

    it('executes prune CLI with --mode prune and generates least-privilege permission set', async () => {
      const profilePath = path.join(__dirname, 'fixtures/profiles/Sales_User.profile-meta.xml');
      const eventsPath = path.join(__dirname, 'fixtures/event_logs/sample_events.csv');

      let loggedOutput = '';
      const logSpy = vi.spyOn(Prune.prototype, 'log').mockImplementation((msg?: string) => {
        loggedOutput += (msg || '') + '\n';
      });

      await Prune.run([
        '--profile',
        profilePath,
        '--events',
        eventsPath,
        '--mode',
        'prune',
        '--output-dir',
        tempDir,
      ]);

      logSpy.mockRestore();
      expect(loggedOutput).toContain('Generated Pruned Least-Privilege Permission Set');

      const generatedPs = path.join(
        tempDir,
        'permissionsets',
        'Sales_User_LeastPrivilege.permissionset-meta.xml'
      );
      expect(fs.existsSync(generatedPs)).toBe(true);
    });
  });
});
