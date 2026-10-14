import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HtmlReporter } from '../src/engine/html-reporter.js';
import { ProfileAnalysis } from '../src/types/decomposition.js';

describe('HtmlReporter', () => {
  const testOutputDir = path.join(process.cwd(), 'tmp-report-test');
  const reporter = new HtmlReporter();

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  it('should generate a valid, self-contained HTML report', async () => {
    const sampleAnalysis: ProfileAnalysis = {
      name: 'Sales_Rep',
      filePath: '/path/Sales_Rep.profile-meta.xml',
      custom: true,
      complexityScore: 42,
      metrics: {
        objectPermissionsCount: 3,
        fieldPermissionsCount: 10,
        userPermissionsCount: 4,
        classAccessesCount: 2,
        customPermissionsCount: 1,
        tabVisibilitiesCount: 2,
        recordTypeVisibilitiesCount: 2,
      },
      highRiskPermissions: ['ModifyAllData'],
      suggestedPermissionSets: [
        { name: 'Sales_Rep_Account_Management', description: 'Account CRUD', itemCount: 10 },
      ],
    };

    const targetFile = path.join(testOutputDir, 'audit.html');
    const result = await reporter.generateReport(
      {
        analyses: [sampleAnalysis],
        generatedAt: 'Wed, 14 Oct 2026 12:00:00 GMT',
      },
      targetFile
    );

    expect(await fs.stat(result)).toBeDefined();
    const content = await fs.readFile(result, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('Sales_Rep');
    expect(content).toContain('ModifyAllData');
    expect(content).toContain('42/100');
  });
});
