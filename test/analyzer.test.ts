import { describe, it, expect } from 'vitest';
import { ProfileAnalyzer } from '../src/engine/analyzer.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';

describe('ProfileAnalyzer', () => {
  const analyzer = new ProfileAnalyzer();

  it('should analyze profile metrics and calculate complexity score', () => {
    const profile: LoadedProfile = {
      name: 'Standard_User',
      filePath: '/path/Standard_User.profile-meta.xml',
      metadata: {
        custom: true,
        userLicense: 'Salesforce',
        objectPermissions: [
          { object: 'Account', allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false },
          { object: 'Contact', allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false },
        ],
        fieldPermissions: [
          { field: 'Account.AnnualRevenue', readable: true, editable: true },
          { field: 'Contact.Email', readable: true, editable: true },
        ],
        userPermissions: [
          { name: 'ApiEnabled', enabled: true },
          { name: 'ExportReport', enabled: true },
        ],
      },
    };

    const analysis = analyzer.analyzeProfile(profile);

    expect(analysis.name).toBe('Standard_User');
    expect(analysis.metrics.objectPermissionsCount).toBe(2);
    expect(analysis.metrics.fieldPermissionsCount).toBe(2);
    expect(analysis.metrics.userPermissionsCount).toBe(2);
    expect(analysis.highRiskPermissions).toHaveLength(0);
    expect(analysis.complexityScore).toBeGreaterThan(0);
  });

  it('should detect high-risk permissions such as ModifyAllData', () => {
    const adminProfile: LoadedProfile = {
      name: 'Admin_User',
      filePath: '/path/Admin_User.profile-meta.xml',
      metadata: {
        custom: true,
        userLicense: 'Salesforce',
        userPermissions: [
          { name: 'ModifyAllData', enabled: true },
          { name: 'AuthorApex', enabled: true },
        ],
        objectPermissions: [
          { object: 'Case', allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true, modifyAllRecords: true },
        ],
      },
    };

    const analysis = analyzer.analyzeProfile(adminProfile);

    expect(analysis.highRiskPermissions).toContain('ModifyAllData');
    expect(analysis.highRiskPermissions).toContain('AuthorApex');
    expect(analysis.highRiskPermissions).toContain('ModifyAllRecords:Case');
  });
});
