import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { PipelineRunner } from '../src/engine/pipeline-runner.js';

describe('PipelineRunner', () => {
  const runner = new PipelineRunner();
  const testDir = path.resolve('tmp/pipeline-test');
  const sourceDir = path.join(testDir, 'profiles');
  const outputDir = path.join(testDir, 'output');

  beforeEach(async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    // Create a mock profile
    const profileXml = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>true</custom>
    <objectPermissions>
        <allowCreate>true</allowCreate>
        <allowDelete>false</allowDelete>
        <allowEdit>true</allowEdit>
        <allowRead>true</allowRead>
        <viewAllRecords>false</viewAllRecords>
        <modifyAllRecords>false</modifyAllRecords>
        <object>Account</object>
    </objectPermissions>
    <fieldPermissions>
        <editable>true</editable>
        <field>Account.AnnualRevenue</field>
        <readable>true</readable>
    </fieldPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ViewHelpLink</name>
    </userPermissions>
</Profile>`;

    await fs.writeFile(
      path.join(sourceDir, 'PipelineTestUser.profile-meta.xml'),
      profileXml,
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should run complete migration pipeline in simulation mode (dry-run)', async () => {
    const result = await runner.runPipeline({
      sourceDir,
      outputDir,
      dryRun: true,
      strict: true,
      stages: {
        audit: { enabled: true },
        decompose: { enabled: true, strategy: 'by-domain' },
        verify: { enabled: true, minParityPercent: 100 },
        strip: { enabled: true },
      },
    });

    expect(result.success).toBe(true);
    expect(result.profilesProcessed).toBe(1);
    expect(result.summary.averageParityScore).toBe(100);
    expect(result.summary.allParityPassed).toBe(true);

    const auditStage = result.stages.find((s) => s.stage === 'audit');
    expect(auditStage?.status).toBe('SUCCESS');

    const verifyStage = result.stages.find((s) => s.stage === 'verify');
    expect(verifyStage?.status).toBe('SUCCESS');
  });

  it('should execute full pipeline and write all artifacts to disk', async () => {
    const result = await runner.runPipeline({
      sourceDir,
      outputDir,
      dryRun: false,
      strict: true,
      stages: {
        audit: { enabled: true },
        decompose: { enabled: true, strategy: 'by-domain' },
        verify: { enabled: true, minParityPercent: 100 },
        strip: { enabled: true, inPlace: false },
        uap: { enabled: true },
        plan: { enabled: true },
        report: { enabled: true },
      },
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalPermissionSetsCreated).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalGroupsCreated).toBe(1);
    expect(result.summary.averageParityScore).toBe(100);

    // Verify written files
    const permSets = await fs.readdir(path.join(outputDir, 'permissionsets'));
    expect(permSets.length).toBeGreaterThanOrEqual(1);

    const psgs = await fs.readdir(path.join(outputDir, 'permissionsetgroups'));
    expect(psgs.length).toBe(1);

    const uaps = await fs.readdir(path.join(outputDir, 'userAccessPolicies'));
    expect(uaps.length).toBe(1);
  });
});
