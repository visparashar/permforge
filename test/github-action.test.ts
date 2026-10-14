import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PermForgeGateRunner, GateOptions } from '../action/src/gate-runner.js';

describe('PermForgeGateRunner (GitHub Action)', () => {
  let runner: PermForgeGateRunner;
  const fixturesDir = path.resolve(__dirname, 'fixtures/profiles');

  beforeEach(() => {
    runner = new PermForgeGateRunner();
    vi.clearAllMocks();
  });

  it('runs gate audit on profiles and passes when within thresholds', async () => {
    const options: GateOptions = {
      profilesDir: fixturesDir,
      outputDir: path.resolve(__dirname, 'fixtures'),
      strictParity: false,
      blockProfilePermissions: false,
      maxComplexityScore: 90,
      failOnRisk: false,
      postPrComment: false,
    };

    const result = await runner.runGate(options);

    expect(result.passed).toBe(true);
    expect(result.totalProfilesScanned).toBeGreaterThan(0);
    expect(result.averageComplexityDebt).toBeGreaterThan(0);
    expect(result.summaryMarkdown).toContain('PermForge Security & Parity Gate');
    expect(result.summaryMarkdown).toContain('PASSED');
  });

  it('fails gate when failOnRisk is enabled and profiles grant ModifyAllData / AuthorApex', async () => {
    const options: GateOptions = {
      profilesDir: fixturesDir,
      outputDir: path.resolve(__dirname, 'fixtures'),
      strictParity: false,
      blockProfilePermissions: false,
      maxComplexityScore: 90,
      failOnRisk: true, // Should fail on Custom_Admin high risk grants
      postPrComment: false,
    };

    const result = await runner.runGate(options);

    expect(result.passed).toBe(false);
    expect(result.totalHighRiskGrants).toBeGreaterThan(0);
    expect(result.summaryMarkdown).toContain('FAILED');
  });

  it('detects permission creep in simulated git diff additions', () => {
    const diffWithCreep = `
diff --git a/force-app/main/default/profiles/Sales.profile-meta.xml b/force-app/main/default/profiles/Sales.profile-meta.xml
--- a/force-app/main/default/profiles/Sales.profile-meta.xml
+++ b/force-app/main/default/profiles/Sales.profile-meta.xml
@@ -10,0 +11,4 @@
+    <objectPermissions>
+        <allowCreate>true</allowCreate>
+        <object>Opportunity</object>
+    </objectPermissions>
@@ -40,0 +45,3 @@
+    <fieldPermissions>
+        <editable>true</editable>
+        <field>Account.CustomRevenue__c</field>
+    </fieldPermissions>
`;

    const findings = runner.parseDiffOutput(diffWithCreep);

    expect(findings.length).toBe(4);
    expect(findings.some((f) => f.type.includes('CRUD'))).toBe(true);
    expect(findings.some((f) => f.type.includes('FLS'))).toBe(true);
    expect(findings[0].file).toBe('force-app/main/default/profiles/Sales.profile-meta.xml');
  });

  it('generates rich markdown summary with correct tables and shields', async () => {
    const options: GateOptions = {
      profilesDir: fixturesDir,
      outputDir: path.resolve(__dirname, 'fixtures'),
      strictParity: false,
      blockProfilePermissions: false,
      maxComplexityScore: 100,
      failOnRisk: false,
      postPrComment: false,
    };

    const result = await runner.runGate(options);

    expect(result.summaryMarkdown).toContain('## 🛡️ PermForge Security & Parity Gate');
    expect(result.summaryMarkdown).toContain('| Audited Profiles | Avg Tech Debt |');
    expect(result.summaryMarkdown).toContain('### 📋 Profile Audit Breakdown');
    expect(result.summaryMarkdown).toContain('Custom_Admin');
  });
});
