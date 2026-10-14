import { Command } from '@oclif/core';
import { select, input, confirm } from '@inquirer/prompts';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ProfileAnalyzer } from '../engine/analyzer.js';
import { ProfileDecomposer } from '../engine/decomposer.js';
import { ClusterEngine } from '../engine/cluster-engine.js';
import { HtmlReporter } from '../engine/html-reporter.js';
import { RolloutPlanner } from '../engine/rollout-planner.js';
import { DecompositionStrategy } from '../types/decomposition.js';

export default class Wizard extends Command {
  static override description =
    'Interactive guided step-by-step wizard for Salesforce profile migration and modularization';

  static override examples = ['<%= config.bin %> wizard'];

  public async run(): Promise<void> {
    this.log(pc.bold(pc.cyan('\n🧙‍♂️ Welcome to the PermForge Migration Wizard!\n')));
    this.log(
      pc.dim(
        'This interactive guide will walk you through auditing, decomposing, and planning your profile migration.\n'
      )
    );

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        {
          name: '🔍 Audit Profiles & Generate Visual HTML Dashboard',
          value: 'audit',
          description:
            'Inventory all permissions, detect security risks, and create an HTML report',
        },
        {
          name: '🔨 Decompose a Profile into Modular Permission Sets',
          value: 'decompose',
          description: 'Split a legacy profile into domain-based Permission Sets and a PSG',
        },
        {
          name: '🧩 Cluster Multiple Profiles (Extract Shared Baseline)',
          value: 'cluster',
          description: 'Analyze all profiles together to extract a shared Standard Baseline',
        },
        {
          name: '📋 Generate User Migration & Rollout Plan',
          value: 'plan',
          description: 'Create user assignment CSVs, rollback scripts, and rollout checklists',
        },
      ],
    });

    const reader = new ProfileReader();

    if (action === 'audit') {
      const source = await input({
        message: 'Enter profiles directory or glob path:',
        default: 'force-app/main/default/profiles',
      });
      const output = await input({
        message: 'Enter output HTML file path:',
        default: 'permforge-audit.html',
      });

      const profiles = await reader.loadProfiles(source);
      if (profiles.length === 0) {
        this.error(`No profiles found at: ${source}`);
      }

      const analyzer = new ProfileAnalyzer();
      const analyses = profiles.map((p) => analyzer.analyzeProfile(p));
      const reporter = new HtmlReporter();
      const reportPath = await reporter.generateReport(
        { analyses, generatedAt: new Date().toUTCString() },
        output
      );

      this.log(pc.bold(pc.green(`\n✔ HTML Audit Report generated at: ${reportPath}\n`)));
    } else if (action === 'decompose') {
      const source = await input({
        message: 'Enter profile path or directory:',
        default: 'force-app/main/default/profiles',
      });

      const profiles = await reader.loadProfiles(source);
      if (profiles.length === 0) {
        this.error(`No profiles found at: ${source}`);
      }

      const selectedProfileName = await select({
        message: 'Select a profile to decompose:',
        choices: profiles.map((p) => ({ name: p.name, value: p.name })),
      });

      const profileToDecompose = profiles.find((p) => p.name === selectedProfileName)!;

      const strategy = await select<DecompositionStrategy>({
        message: 'Choose decomposition strategy:',
        choices: [
          { name: 'Domain-based (Recommended: groups related SObjects & FLS)', value: 'by-domain' },
          { name: 'Per-Object (One Permission Set per SObject)', value: 'by-object' },
          { name: 'Consolidated (Single modern Permission Set)', value: 'consolidated' },
        ],
      });

      const outputDir = await input({
        message: 'Enter destination directory:',
        default: 'force-app/main/default',
      });

      const createGroup = await confirm({
        message: 'Generate a Persona Permission Set Group (PSG)?',
        default: true,
      });

      const decomposer = new ProfileDecomposer();
      const result = await decomposer.decompose(profileToDecompose, {
        strategy,
        outputDir,
        createGroup,
      });

      this.log(
        pc.bold(
          pc.green(
            `\n✔ Created ${result.permissionSets.length} Permission Sets and PSG: ${result.permissionSetGroup?.apiName || 'None'}\n`
          )
        )
      );
    } else if (action === 'cluster') {
      const source = await input({
        message: 'Enter directory of profiles to cluster:',
        default: 'force-app/main/default/profiles',
      });

      const thresholdStr = await input({
        message: 'Enter sharing threshold for baseline inclusion (0.1 to 1.0):',
        default: '0.75',
      });

      const baseName = await input({
        message: 'Enter API name for baseline Permission Set:',
        default: 'Standard_Employee_Baseline',
      });

      const outputDir = await input({
        message: 'Enter destination directory:',
        default: 'force-app/main/default',
      });

      const profiles = await reader.loadProfiles(source);
      if (profiles.length < 2) {
        this.error(`Clustering requires at least 2 profiles. Found ${profiles.length}.`);
      }

      const clusterEngine = new ClusterEngine();
      const result = await clusterEngine.clusterProfiles(profiles, {
        threshold: parseFloat(thresholdStr),
        baselineName: baseName,
        outputDir,
        createGroups: true,
      });

      this.log(
        pc.bold(
          pc.green(
            `\n✔ Clustered ${result.totalProfilesAnalyzed} profiles into baseline '${result.baselinePermissionSet.apiName}' + ${result.stats.totalDeltasCreated} deltas!\n`
          )
        )
      );
    } else if (action === 'plan') {
      const profileName = await input({
        message: 'Enter legacy Profile name to migrate:',
      });

      const psgName = await input({
        message: 'Enter target Permission Set Group name:',
        default: `${profileName}_PSG`,
      });

      const targetBase = await input({
        message: 'Enter target base profile (e.g. Minimum Access - Salesforce):',
        default: 'Minimum Access - Salesforce',
      });

      const outputDir = await input({
        message: 'Enter directory for rollout scripts:',
        default: 'migration-plans',
      });

      const planner = new RolloutPlanner();
      const result = await planner.generatePlan({
        profileName,
        psgName,
        targetBaseProfile: targetBase,
        outputDir,
      });

      this.log(pc.bold(pc.green(`\n✔ Migration plan and scripts created in: ${outputDir}\n`)));
      this.log(`  • Plan document: ${result.planFilePath}`);
      this.log(`  • User CSV template: ${result.csvTemplatePath}`);
      this.log(`  • Migration script: ${result.scriptPath}`);
      this.log(`  • Rollback script: ${result.rollbackScriptPath}\n`);
    }
  }
}
