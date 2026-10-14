import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  ProfileReader,
  ProfileAnalyzer,
  ClusterEngine,
  ParityEngine,
  ProfileStripper,
  ProfileLinter,
  UapBuilder,
  MuteBuilder,
  GraphBuilder,
  HtmlReporter,
} from '../src/index.js';

describe('PermForge Full End-to-End Migration Lifecycle', () => {
  const e2eDir = path.join(process.cwd(), 'tmp-e2e-suite');
  const fixturesDir = path.join(process.cwd(), 'test/fixtures/profiles');

  beforeEach(async () => {
    await fs.mkdir(e2eDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(e2eDir, { recursive: true, force: true });
  });

  it('should successfully execute the complete 6-stage migration lifecycle', async () => {
    // -------------------------------------------------------------------------
    // Stage 1: Discovery & Analysis
    // -------------------------------------------------------------------------
    const reader = new ProfileReader();
    const profiles = await reader.loadProfiles(fixturesDir);
    expect(profiles.length).toBe(3); // Sales_User, Support_Agent, Custom_Admin

    const analyzer = new ProfileAnalyzer();
    const analyses = profiles.map((p) => analyzer.analyzeProfile(p));

    const adminAnalysis = analyses.find((a) => a.name === 'Custom_Admin')!;
    expect(adminAnalysis.highRiskPermissions).toContain('ModifyAllData');
    expect(adminAnalysis.complexityScore).toBeGreaterThan(30);

    const reporter = new HtmlReporter();
    const htmlPath = await reporter.generateReport(
      { analyses, generatedAt: new Date().toUTCString() },
      path.join(e2eDir, 'dashboard.html')
    );
    expect(await fs.stat(htmlPath)).toBeDefined();

    // -------------------------------------------------------------------------
    // Stage 2: Cross-Profile Clustering & Decomposition
    // -------------------------------------------------------------------------
    const clusterEngine = new ClusterEngine();
    const clusterResult = await clusterEngine.clusterProfiles(profiles, {
      threshold: 0.6, // >= 60% of profiles share permission
      baselineName: 'Global_Standard_Baseline',
      outputDir: e2eDir,
      createGroups: true,
    });

    expect(clusterResult.baselinePermissionSet.apiName).toBe('Global_Standard_Baseline');
    expect(clusterResult.profileDeltas).toHaveLength(3);

    // -------------------------------------------------------------------------
    // Stage 3: Access Parity Verification (100% Parity Guarantee)
    // -------------------------------------------------------------------------
    const parityEngine = new ParityEngine();

    for (const delta of clusterResult.profileDeltas) {
      const origProfile = profiles.find((p) => p.name === delta.profileName)!;
      const combinedPermSets = [
        clusterResult.baselinePermissionSet.metadata,
        ...delta.deltaPermissionSets.map((d) => d.metadata),
      ];

      const parity = parityEngine.verifyParity(
        origProfile,
        combinedPermSets,
        delta.permissionSetGroup?.apiName
      );

      // Verify that every single profile has 100.0% access parity with no missing permissions
      expect(parity.is100PercentMatch).toBe(true);
      expect(parity.parityScore).toBe(100);
      expect(parity.mismatches.filter((m) => m.severity === 'missing')).toHaveLength(0);
    }

    // -------------------------------------------------------------------------
    // Stage 4: Profile Sanitization & Stripping
    // -------------------------------------------------------------------------
    const stripper = new ProfileStripper();
    const cleanProfilesDir = path.join(e2eDir, 'clean-profiles');
    await fs.mkdir(cleanProfilesDir, { recursive: true });

    for (const p of profiles) {
      const stripResult = await stripper.stripProfile(p, {
        outputDir: cleanProfilesDir,
      });

      expect(stripResult.strippedStats.objectPermissionsRemoved).toBeGreaterThanOrEqual(2);
      const cleanContent = await fs.readFile(stripResult.outputPath, 'utf-8');
      expect(cleanContent).not.toContain('<objectPermissions>');
      expect(cleanContent).not.toContain('<fieldPermissions>');
      expect(cleanContent).not.toContain('<userPermissions>');
    }

    // -------------------------------------------------------------------------
    // Stage 5: CI/CD Enforcement & Linting
    // -------------------------------------------------------------------------
    const linter = new ProfileLinter();

    // Original profiles MUST be flagged as non-compliant
    const dirtyLint = linter.lintProfiles(profiles);
    expect(dirtyLint.totalViolations).toBeGreaterThan(0);
    expect(dirtyLint.violatingProfilesCount).toBe(3);

    // Sanitized profiles MUST be 100% compliant
    const cleanLoadedProfiles = await reader.loadProfiles(cleanProfilesDir);
    const cleanLint = linter.lintProfiles(cleanLoadedProfiles);
    expect(cleanLint.totalViolations).toBe(0);
    expect(cleanLint.cleanProfilesCount).toBe(3);

    // -------------------------------------------------------------------------
    // Stage 6: Automation & Governance (UAP, Muting, Dependency Graph)
    // -------------------------------------------------------------------------
    // 6a: Generate User Access Policy
    const uapBuilder = new UapBuilder();
    const uapResult = await uapBuilder.generateUap({
      name: 'Sales_Auto_Assign_Policy',
      psgName: 'Sales_User_PSG',
      predicates: [{ field: 'Department', operator: 'Equals', value: 'Sales' }],
      outputDir: e2eDir,
    });
    expect(await fs.stat(uapResult.filePath)).toBeDefined();

    // 6b: Generate Muting Permission Set
    const muteBuilder = new MuteBuilder();
    const muteResult = await muteBuilder.generateMutingPermissionSet({
      name: 'Sales_Junior_Muting',
      mutedObjects: [{ object: 'Account', muteDelete: true }],
      outputDir: e2eDir,
    });
    expect(await fs.stat(muteResult.filePath)).toBeDefined();

    // 6c: Generate Architecture Graph
    const graphBuilder = new GraphBuilder();
    const graphData = await graphBuilder.loadGraphData(e2eDir);
    expect(graphData.groups.length).toBeGreaterThan(0);
    expect(graphData.permSets.length).toBeGreaterThan(0);

    const mermaid = graphBuilder.generateMermaid(graphData);
    expect(mermaid).toContain('flowchart TD');
    expect(mermaid).toContain('Sales_User_PSG');

    const asciiTree = graphBuilder.generateAsciiTree(graphData);
    expect(asciiTree).toContain('📦 [PSG]');
  });
});
