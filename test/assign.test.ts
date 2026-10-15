import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalesforceOrgService, AssignmentPlan } from '../src/services/salesforce-org.js';

describe('SalesforceOrgService - User Reassignment', () => {
  let service: SalesforceOrgService;
  const tempDir = path.join(process.cwd(), 'tmp-test-rollbacks');

  beforeEach(() => {
    service = new SalesforceOrgService();
    vi.restoreAllMocks();
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('resolveAssignmentTarget', () => {
    it('resolves PermissionSetGroup when DeveloperName matches', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValueOnce({
          records: [{ Id: '0PG000000000001', DeveloperName: 'Custom_Admin_PSG', MasterLabel: 'Custom Admin PSG' }],
        }),
      };
      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const target = await service.resolveAssignmentTarget('Custom_Admin_PSG');
      expect(target.id).toBe('0PG000000000001');
      expect(target.name).toBe('Custom_Admin_PSG');
      expect(target.type).toBe('PermissionSetGroup');
    });

    it('falls back to PermissionSet when not found in PermissionSetGroup', async () => {
      const mockConn = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ records: [] }) // PSG query returns empty
          .mockResolvedValueOnce({
            records: [{ Id: '0PS000000000001', Name: 'Sales_Baseline_PS', Label: 'Sales Baseline' }],
          }),
      };
      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const target = await service.resolveAssignmentTarget('Sales_Baseline_PS');
      expect(target.id).toBe('0PS000000000001');
      expect(target.name).toBe('Sales_Baseline_PS');
      expect(target.type).toBe('PermissionSet');
    });

    it('throws meaningful error when target does not exist', async () => {
      const mockConn = {
        query: vi.fn().mockResolvedValue({ records: [] }),
      };
      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      await expect(service.resolveAssignmentTarget('NonExistentTarget')).rejects.toThrow(
        /was not found as a Permission Set Group or Permission Set/
      );
    });
  });

  describe('planUserAssignments', () => {
    it('accurately plans assignments and detects already assigned users', async () => {
      const mockConn = {
        query: vi
          .fn()
          // 1. resolveAssignmentTarget query for PSG
          .mockResolvedValueOnce({
            records: [{ Id: '0PG000000000001', DeveloperName: 'Custom_Admin_PSG', MasterLabel: 'Custom Admin' }],
          })
          // 2. getProfileUsers query
          .mockResolvedValueOnce({
            records: [
              {
                Id: '005000000000001',
                Username: 'alice@example.com',
                Name: 'Alice Admin',
                Email: 'alice@example.com',
                IsActive: true,
                ProfileId: '00e000000000001',
                Profile: { Name: 'Custom Admin' },
              },
              {
                Id: '005000000000002',
                Username: 'bob@example.com',
                Name: 'Bob Admin',
                Email: 'bob@example.com',
                IsActive: true,
                ProfileId: '00e000000000001',
                Profile: { Name: 'Custom Admin' },
              },
              {
                Id: '005000000000003',
                Username: 'charlie@example.com',
                Name: 'Charlie Inactive',
                Email: 'charlie@example.com',
                IsActive: false,
                ProfileId: '00e000000000001',
                Profile: { Name: 'Custom Admin' },
              },
            ],
          })
          // 3. check existing assignments query (Alice is already assigned)
          .mockResolvedValueOnce({
            records: [{ Id: '0Pa000000000001', AssigneeId: '005000000000001' }],
          }),
      };
      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const plan = await service.planUserAssignments('Custom Admin', 'Custom_Admin_PSG');

      expect(plan.totalUsersFound).toBe(3);
      expect(plan.activeUsersCount).toBe(2);
      expect(plan.inactiveUsersCount).toBe(1);
      expect(plan.alreadyAssignedCount).toBe(1); // Alice
      expect(plan.usersToAssign).toHaveLength(1); // Bob
      expect(plan.usersToAssign[0].username).toBe('bob@example.com');
      expect(plan.skippedUsers).toHaveLength(1); // Alice
      expect(plan.skippedUsers[0].username).toBe('alice@example.com');
    });

    it('returns empty assignment plan when profile has 0 users', async () => {
      const mockConn = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            records: [{ Id: '0PG000000000001', DeveloperName: 'Custom_Admin_PSG', MasterLabel: 'Custom Admin' }],
          })
          .mockResolvedValueOnce({ records: [] }),
      };
      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const plan = await service.planUserAssignments('Empty Profile', 'Custom_Admin_PSG');
      expect(plan.totalUsersFound).toBe(0);
      expect(plan.usersToAssign).toEqual([]);
    });
  });

  describe('executeUserAssignments and rollback', () => {
    it('executes assignments, writes rollback manifest, and successfully rolls back', async () => {
      const plan: AssignmentPlan = {
        profileName: 'Custom Admin',
        target: {
          id: '0PG000000000001',
          name: 'Custom_Admin_PSG',
          type: 'PermissionSetGroup',
        },
        totalUsersFound: 1,
        activeUsersCount: 1,
        inactiveUsersCount: 0,
        alreadyAssignedCount: 0,
        usersToAssign: [
          {
            id: '005000000000002',
            username: 'bob@example.com',
            name: 'Bob Admin',
            email: 'bob@example.com',
            isActive: true,
            profileId: '00e000000000001',
            profileName: 'Custom Admin',
          },
        ],
        skippedUsers: [],
      };

      const mockConn = {
        sobject: vi.fn().mockReturnValue({
          create: vi.fn().mockResolvedValue([
            {
              id: '0Pa000000000002',
              success: true,
            },
          ]),
          destroy: vi.fn().mockResolvedValue([
            {
              id: '0Pa000000000002',
              success: true,
            },
          ]),
        }),
      };
      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      // 1. Execute Assignment
      const result = await service.executeUserAssignments(plan, undefined, {
        rollbackDir: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.assignedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.rollbackFile).toBeDefined();
      expect(fs.existsSync(result.rollbackFile!)).toBe(true);

      const manifestContent = JSON.parse(fs.readFileSync(result.rollbackFile!, 'utf-8'));
      expect(manifestContent.createdAssignmentIds).toEqual(['0Pa000000000002']);
      expect(manifestContent.profileName).toBe('Custom Admin');

      // 2. Rollback Assignment
      const rollbackResult = await service.rollbackUserAssignments(result.rollbackFile!);
      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.deletedCount).toBe(1);
      expect(rollbackResult.failedCount).toBe(0);
    });

    it('handles DML errors gracefully during assignment', async () => {
      const plan: AssignmentPlan = {
        profileName: 'Custom Admin',
        target: {
          id: '0PS000000000001',
          name: 'Sales_PS',
          type: 'PermissionSet',
        },
        totalUsersFound: 1,
        activeUsersCount: 1,
        inactiveUsersCount: 0,
        alreadyAssignedCount: 0,
        usersToAssign: [
          {
            id: '005000000000002',
            username: 'error_user@example.com',
            name: 'Error User',
            email: 'error_user@example.com',
            isActive: true,
            profileId: '00e000000000001',
            profileName: 'Custom Admin',
          },
        ],
        skippedUsers: [],
      };

      const mockConn = {
        sobject: vi.fn().mockReturnValue({
          create: vi.fn().mockResolvedValue([
            {
              success: false,
              errors: [{ message: 'User license does not allow this permission set' }],
            },
          ]),
        }),
      };
      vi.spyOn(service, 'getConnection').mockReturnValue(mockConn as any);

      const result = await service.executeUserAssignments(plan, undefined, {
        rollbackDir: tempDir,
      });

      expect(result.success).toBe(false);
      expect(result.assignedCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.assignments[0].error).toContain('User license does not allow');
    });
  });
});
