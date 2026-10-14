import { describe, it, expect } from 'vitest';
import { ParityEngine } from '../src/engine/parity-engine.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';
import { PermissionSetMetadata } from '../src/types/metadata.js';

describe('ParityEngine', () => {
  const parityEngine = new ParityEngine();

  const profile: LoadedProfile = {
    name: 'Sales_Profile',
    filePath: '/dummy/Sales_Profile.profile-meta.xml',
    metadata: {
      objectPermissions: [
        {
          object: 'Account',
          allowCreate: true,
          allowRead: true,
          allowEdit: true,
          allowDelete: false,
        },
      ],
      fieldPermissions: [
        { field: 'Account.Name', readable: true, editable: true },
        { field: 'Account.AnnualRevenue', readable: true, editable: false },
      ],
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
    },
  };

  it('should report 100% parity when target permission sets cover all permissions', () => {
    const targetPermSets: PermissionSetMetadata[] = [
      {
        label: 'Account Access',
        objectPermissions: [
          {
            object: 'Account',
            allowCreate: true,
            allowRead: true,
            allowEdit: true,
            allowDelete: false,
          },
        ],
        fieldPermissions: [
          { field: 'Account.Name', readable: true, editable: true },
          { field: 'Account.AnnualRevenue', readable: true, editable: false },
        ],
      },
      {
        label: 'System Access',
        userPermissions: [{ name: 'ApiEnabled', enabled: true }],
      },
    ];

    const report = parityEngine.verifyParity(profile, targetPermSets);

    expect(report.is100PercentMatch).toBe(true);
    expect(report.parityScore).toBe(100);
    expect(report.mismatches).toHaveLength(0);
    expect(report.summary.objectsMatch).toBe(true);
    expect(report.summary.fieldsMatch).toBe(true);
    expect(report.summary.userPermissionsMatch).toBe(true);
  });

  it('should detect missing permissions accurately', () => {
    // Missing Account allowEdit and Account.Name editable
    const incompletePermSets: PermissionSetMetadata[] = [
      {
        label: 'Incomplete Account Access',
        objectPermissions: [
          {
            object: 'Account',
            allowCreate: true,
            allowRead: true,
            allowEdit: false,
            allowDelete: false,
          },
        ],
        fieldPermissions: [
          { field: 'Account.Name', readable: true, editable: false },
          { field: 'Account.AnnualRevenue', readable: true, editable: false },
        ],
      },
    ];

    const report = parityEngine.verifyParity(profile, incompletePermSets);

    expect(report.is100PercentMatch).toBe(false);
    expect(report.parityScore).toBeLessThan(100);
    expect(report.mismatches.length).toBeGreaterThan(0);
    expect(report.summary.objectsMatch).toBe(false);
  });
});
