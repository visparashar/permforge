import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProfileStripper } from '../src/engine/profile-stripper.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';

describe('ProfileStripper', () => {
  const testOutputDir = path.join(process.cwd(), 'tmp-strip-test');
  const stripper = new ProfileStripper();

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  const profile: LoadedProfile = {
    name: 'Sales_User',
    filePath: path.join(testOutputDir, 'Sales_User.profile-meta.xml'),
    metadata: {
      custom: true,
      userLicense: 'Salesforce',
      objectPermissions: [
        {
          object: 'Account',
          allowCreate: true,
          allowRead: true,
          allowEdit: true,
          allowDelete: false,
        },
      ],
      fieldPermissions: [{ field: 'Account.AnnualRevenue', readable: true, editable: true }],
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
      layoutAssignments: [{ layout: 'Account-Account Layout' }],
    },
  };

  it('should strip permissions while preserving layout assignments and license', async () => {
    // Write dummy source file first
    await fs.writeFile(profile.filePath, '<Profile></Profile>', 'utf-8');

    const result = await stripper.stripProfile(profile, {
      outputDir: testOutputDir,
    });

    expect(result.strippedStats.objectPermissionsRemoved).toBe(1);
    expect(result.strippedStats.fieldPermissionsRemoved).toBe(1);
    expect(result.strippedStats.userPermissionsRemoved).toBe(1);
    expect(result.preservedSettings.layoutAssignmentsCount).toBe(1);

    const strippedContent = await fs.readFile(result.outputPath, 'utf-8');
    expect(strippedContent).toContain('<userLicense>Salesforce</userLicense>');
    expect(strippedContent).not.toContain('<objectPermissions>');
    expect(strippedContent).not.toContain('<fieldPermissions>');
    expect(strippedContent).not.toContain('<userPermissions>');
    expect(strippedContent).toContain('<layoutAssignments>');
  });
});
