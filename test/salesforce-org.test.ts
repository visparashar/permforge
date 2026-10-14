import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalesforceOrgService } from '../src/services/salesforce-org.js';

describe('SalesforceOrgService', () => {
  let service: SalesforceOrgService;

  beforeEach(() => {
    service = new SalesforceOrgService();
    vi.restoreAllMocks();
  });

  describe('resolveAuth', () => {
    it('resolves auth from environment variables when present', () => {
      const origToken = process.env.SF_ACCESS_TOKEN;
      const origUrl = process.env.SF_INSTANCE_URL;

      process.env.SF_ACCESS_TOKEN = 'test-token-12345';
      process.env.SF_INSTANCE_URL = 'https://test-sandbox.my.salesforce.com';

      const auth = service.resolveAuth();
      expect(auth.accessToken).toBe('test-token-12345');
      expect(auth.instanceUrl).toBe('https://test-sandbox.my.salesforce.com');

      process.env.SF_ACCESS_TOKEN = origToken;
      process.env.SF_INSTANCE_URL = origUrl;
    });

    it('throws meaningful error when no credentials can be found', () => {
      const origToken = process.env.SF_ACCESS_TOKEN;
      const origUrl = process.env.SF_INSTANCE_URL;
      delete process.env.SF_ACCESS_TOKEN;
      delete process.env.SF_INSTANCE_URL;

      expect(() => service.resolveAuth('non-existent-org-alias-99999')).toThrow(
        /Could not resolve Salesforce credentials/
      );

      process.env.SF_ACCESS_TOKEN = origToken;
      process.env.SF_INSTANCE_URL = origUrl;
    }, 15000);
  });

  describe('retrieveProfiles', () => {
    it('returns empty array when profileNames is empty', async () => {
      const result = await service.retrieveProfiles([]);
      expect(result).toEqual([]);
    });

    it('retrieves and normalizes live profile metadata into LoadedProfile structure', async () => {
      const mockConn = {
        metadata: {
          read: vi.fn().mockResolvedValue([
            {
              fullName: 'Custom_Sales_Agent',
              custom: 'true',
              userLicense: 'Salesforce',
              objectPermissions: [
                {
                  object: 'Account',
                  allowCreate: true,
                  allowRead: true,
                  allowEdit: true,
                  allowDelete: false,
                  viewAllRecords: false,
                  modifyAllRecords: false,
                },
              ],
              fieldPermissions: [
                { field: 'Account.AnnualRevenue', readable: true, editable: true },
              ],
              userPermissions: [
                { name: 'RunReports', enabled: true },
              ],
            },
          ]),
        },
      };

      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const profiles = await service.retrieveProfiles(['Custom_Sales_Agent']);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe('Custom_Sales_Agent');
      expect(profiles[0].metadata.custom).toBe(true);
      expect(profiles[0].metadata.objectPermissions).toHaveLength(1);
      expect(profiles[0].metadata.objectPermissions![0].object).toBe('Account');
      expect(profiles[0].metadata.fieldPermissions).toHaveLength(1);
      expect(profiles[0].metadata.userPermissions).toHaveLength(1);
    });

    it('handles single object instead of array from metadata API', async () => {
      const mockConn = {
        metadata: {
          read: vi.fn().mockResolvedValue({
            fullName: 'Single_Perm_Profile',
            custom: true,
            objectPermissions: {
              object: 'Contact',
              allowRead: true,
            },
          }),
        },
      };

      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const profiles = await service.retrieveProfiles(['Single_Perm_Profile']);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].metadata.objectPermissions).toHaveLength(1);
      expect(profiles[0].metadata.objectPermissions![0].object).toBe('Contact');
    });
  });

  describe('deployPermissionSets', () => {
    it('deploys generated Permission Sets in chunks', async () => {
      const mockCreate = vi.fn().mockResolvedValue([
        { fullName: 'Test_PS_1', success: true },
        { fullName: 'Test_PS_2', success: true },
      ]);

      const mockConn = {
        metadata: {
          create: mockCreate,
        },
      };

      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const result = await service.deployPermissionSets([
        {
          apiName: 'Test_PS_1',
          fileName: 'Test_PS_1.permissionset-meta.xml',
          category: 'domain',
          metadata: { label: 'Test PS 1', hasActivationRequired: false },
        },
        {
          apiName: 'Test_PS_2',
          fileName: 'Test_PS_2.permissionset-meta.xml',
          category: 'domain',
          metadata: { label: 'Test PS 2', hasActivationRequired: false },
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.created).toHaveLength(2);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
