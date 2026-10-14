import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RolloutPlanner } from '../src/engine/rollout-planner.js';

describe('RolloutPlanner', () => {
  const testOutputDir = path.join(process.cwd(), 'tmp-test-plan');
  const planner = new RolloutPlanner();

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  it('should generate all required migration rollout files', async () => {
    const result = await planner.generatePlan({
      profileName: 'Sales_User',
      psgName: 'Sales_User_PSG',
      targetBaseProfile: 'Minimum Access - Salesforce',
      outputDir: testOutputDir,
    });

    expect(await fs.stat(result.planFilePath)).toBeDefined();
    expect(await fs.stat(result.csvTemplatePath)).toBeDefined();
    expect(await fs.stat(result.scriptPath)).toBeDefined();
    expect(await fs.stat(result.rollbackScriptPath)).toBeDefined();

    const planContent = await fs.readFile(result.planFilePath, 'utf-8');
    expect(planContent).toContain('Sales_User');
    expect(planContent).toContain('Minimum Access - Salesforce');
    expect(planContent).toContain('Sales_User_PSG');
  });
});
