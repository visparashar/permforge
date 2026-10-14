import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ClusterEngine } from '../src/engine/cluster-engine.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';

describe('ClusterEngine', () => {
  const testOutputDir = path.join(process.cwd(), 'tmp-cluster-test');
  const engine = new ClusterEngine();

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  const profileA: LoadedProfile = {
    name: 'Sales_Rep',
    filePath: '/dummy/Sales_Rep.profile-meta.xml',
    metadata: {
      objectPermissions: [
        {
          object: 'Account',
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: false,
        },
        {
          object: 'Opportunity',
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: false,
        },
      ],
      fieldPermissions: [
        { field: 'Account.Name', readable: true, editable: true },
        { field: 'Opportunity.Amount', readable: true, editable: true },
      ],
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
    },
  };

  const profileB: LoadedProfile = {
    name: 'Support_Rep',
    filePath: '/dummy/Support_Rep.profile-meta.xml',
    metadata: {
      objectPermissions: [
        {
          object: 'Account',
          allowRead: true,
          allowCreate: false,
          allowEdit: false,
          allowDelete: false,
        },
        { object: 'Case', allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
      ],
      fieldPermissions: [
        { field: 'Account.Name', readable: true, editable: false },
        { field: 'Case.Subject', readable: true, editable: true },
      ],
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
    },
  };

  it('should extract common permissions into baseline with 50% threshold', async () => {
    const result = await engine.clusterProfiles([profileA, profileB], {
      threshold: 0.5,
      baselineName: 'Shared_Core_Base',
      outputDir: testOutputDir,
    });

    expect(result.totalProfilesAnalyzed).toBe(2);
    expect(result.baselinePermissionSet.apiName).toBe('Shared_Core_Base');

    // Both profiles have Read on Account and ApiEnabled
    const baseMeta = result.baselinePermissionSet.metadata;
    expect(baseMeta.userPermissions?.some((u) => u.name === 'ApiEnabled')).toBe(true);
    expect(baseMeta.objectPermissions?.some((o) => o.object === 'Account' && o.allowRead)).toBe(
      true
    );

    // Delta checks
    expect(result.profileDeltas).toHaveLength(2);

    const salesDelta = result.profileDeltas.find((d) => d.profileName === 'Sales_Rep');
    expect(salesDelta).toBeDefined();
    expect(salesDelta?.permissionSetGroup?.metadata.permissionSets).toContain('Shared_Core_Base');
  });
});
