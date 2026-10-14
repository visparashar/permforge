import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProfileDecomposer } from '../src/engine/decomposer.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';

describe('ProfileDecomposer', () => {
  const testOutputDir = path.join(process.cwd(), 'tmp-test-output');
  const decomposer = new ProfileDecomposer();

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  const sampleProfile: LoadedProfile = {
    name: 'Sales_Rep',
    filePath: '/dummy/Sales_Rep.profile-meta.xml',
    metadata: {
      custom: true,
      userLicense: 'Salesforce',
      objectPermissions: [
        { object: 'Account', allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false },
        { object: 'Opportunity', allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false },
      ],
      fieldPermissions: [
        { field: 'Account.AnnualRevenue', readable: true, editable: true },
        { field: 'Opportunity.Amount', readable: true, editable: true },
      ],
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
      classAccesses: [{ apexClass: 'DiscountService', enabled: true }],
      customPermissions: [{ name: 'Approve_Deals', enabled: true }],
    },
  };

  it('should decompose into domain permission sets and a PSG by default', async () => {
    const result = await decomposer.decompose(sampleProfile, {
      outputDir: testOutputDir,
    });

    expect(result.permissionSets.length).toBeGreaterThan(0);
    expect(result.permissionSetGroup).toBeDefined();
    expect(result.permissionSetGroup?.apiName).toBe('Sales_Rep_PSG');

    // Check files written to filesystem
    const permSetsDir = path.join(testOutputDir, 'permissionsets');
    const psgDir = path.join(testOutputDir, 'permissionsetgroups');

    const permSetFiles = await fs.readdir(permSetsDir);
    const psgFiles = await fs.readdir(psgDir);

    expect(permSetFiles).toContain('Sales_Rep_Account_Management.permissionset-meta.xml');
    expect(permSetFiles).toContain('Sales_Rep_Sales_Opportunity.permissionset-meta.xml');
    expect(permSetFiles).toContain('Sales_Rep_System_Permissions.permissionset-meta.xml');
    expect(permSetFiles).toContain('Sales_Rep_Apex_Access.permissionset-meta.xml');
    expect(permSetFiles).toContain('Sales_Rep_Custom_Permissions.permissionset-meta.xml');

    expect(psgFiles).toContain('Sales_Rep_PSG.permissionsetgroup-meta.xml');
  });

  it('should decompose in consolidated mode when requested', async () => {
    const result = await decomposer.decompose(sampleProfile, {
      outputDir: testOutputDir,
      strategy: 'consolidated',
    });

    expect(result.permissionSets).toHaveLength(1);
    expect(result.permissionSets[0].apiName).toBe('Sales_Rep_Full');
  });
});
