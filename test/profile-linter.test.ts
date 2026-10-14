import { describe, it, expect } from 'vitest';
import { ProfileLinter } from '../src/engine/profile-linter.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';

describe('ProfileLinter', () => {
  const linter = new ProfileLinter();

  it('should flag deprecated permissions in a legacy profile', () => {
    const dirtyProfile: LoadedProfile = {
      name: 'Legacy_Profile',
      filePath: '/path/Legacy_Profile.profile-meta.xml',
      metadata: {
        objectPermissions: [
          {
            object: 'Account',
            allowRead: true,
            allowCreate: true,
            allowEdit: true,
            allowDelete: false,
          },
        ],
        fieldPermissions: [{ field: 'Account.Name', readable: true, editable: true }],
        userPermissions: [{ name: 'ApiEnabled', enabled: true }],
      },
    };

    const report = linter.lintProfiles([dirtyProfile]);
    expect(report.totalViolations).toBe(3);
    expect(report.violatingProfilesCount).toBe(1);
    expect(report.cleanProfilesCount).toBe(0);
  });

  it('should pass cleanly for a sanitized profile with only layout assignments', () => {
    const cleanProfile: LoadedProfile = {
      name: 'Clean_Profile',
      filePath: '/path/Clean_Profile.profile-meta.xml',
      metadata: {
        custom: true,
        userLicense: 'Salesforce',
        layoutAssignments: [{ layout: 'Account-Layout' }],
      },
    };

    const report = linter.lintProfiles([cleanProfile]);
    expect(report.totalViolations).toBe(0);
    expect(report.violatingProfilesCount).toBe(0);
    expect(report.cleanProfilesCount).toBe(1);
  });
});
