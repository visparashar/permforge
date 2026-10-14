import { Command, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import pc from 'picocolors';
import Table from 'cli-table3';
import { PipelineRunner, PipelineConfig } from '../engine/pipeline-runner.js';

export default class Pipeline extends Command {
  static override description =
    'Execute or configure the complete multi-stage Salesforce Profile Migration Pipeline';

  static override examples = [
    '<%= config.bin %> pipeline --run',
    '<%= config.bin %> pipeline --run --source force-app/main/default/profiles --cluster',
    '<%= config.bin %> pipeline --run --strict --dry-run',
    '<%= config.bin %> pipeline --init',
  ];

  static override flags = {
    run: Flags.boolean({
      description: 'Execute the complete multi-stage profile migration pipeline',
      default: false,
    }),
    init: Flags.boolean({
      description: 'Scaffold a starter permforge.pipeline.json and GitHub Actions CI workflow',
      default: false,
    }),
    source: Flags.string({
      char: 's',
      description: 'Path to profiles directory or glob pattern',
      default: 'force-app/main/default/profiles',
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for generated permission sets and groups',
      default: 'force-app/main/default',
    }),
    cluster: Flags.boolean({
      description: 'Enable cross-profile clustering to extract shared Standard Employee Baseline',
      default: false,
    }),
    strip: Flags.boolean({
      description: 'Sanitize source profiles by stripping migratable permissions',
      default: false,
    }),
    uap: Flags.boolean({
      description: 'Generate native Salesforce User Access Policies (.userAccessPolicy-meta.xml)',
      default: true,
    }),
    plan: Flags.boolean({
      description: 'Generate user assignment CSVs, rollback scripts, and deploy sequences',
      default: true,
    }),
    strict: Flags.boolean({
      description: 'Strict mode: fail pipeline and exit with error if parity < 100% or any stage fails',
      default: false,
    }),
    'target-org': Flags.string({
      char: 'o',
      description: 'Connect directly to a live Salesforce org (alias or username)',
    }),
    deploy: Flags.boolean({
      description: 'Deploy generated Permission Sets and PSGs to the target org upon completion',
      default: false,
    }),
    profiles: Flags.string({
      char: 'p',
      description: 'Comma-separated profile names to process when targeting a live org',
    }),
    'dry-run': Flags.boolean({
      description: 'Simulate pipeline without writing files to disk',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Pipeline);

    if (flags.init) {
      await this.handleInit();
      return;
    }

    if (!flags.run) {
      this.log(pc.yellow('Please specify an action:'));
      this.log(`  ${pc.cyan('permforge pipeline --run')}   Execute the full migration pipeline`);
      this.log(`  ${pc.cyan('permforge pipeline --init')}  Generate pipeline config & GitHub Actions CI template`);
      this.log(`\nRun ${pc.bold('permforge pipeline --help')} for full usage details.`);
      return;
    }

    const runner = new PipelineRunner();

    const config: PipelineConfig = {
      sourceDir: flags.source,
      outputDir: flags['output-dir'],
      strict: flags.strict,
      dryRun: flags['dry-run'],
      targetOrg: flags['target-org'],
      deploy: flags.deploy,
      profiles: flags.profiles ? flags.profiles.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      stages: {
        audit: { enabled: true },
        cluster: { enabled: flags.cluster, threshold: 0.75, baselineName: 'Standard_Employee_Baseline' },
        decompose: { enabled: true, strategy: 'by-domain' },
        verify: { enabled: true, minParityPercent: 100 },
        strip: { enabled: flags.strip, inPlace: false },
        uap: { enabled: flags.uap },
        plan: { enabled: flags.plan },
        report: { enabled: true },
      },
    };

    if (!flags.json) {
      this.log(pc.bold(pc.cyan('\n🚀 PermForge Enterprise Migration Pipeline\n')));
      if (flags['dry-run']) {
        this.log(pc.yellow('⚡ SIMULATION MODE (--dry-run): No files will be modified on disk.\n'));
      }
    }

    const result = await runner.runPipeline(config);

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      if (flags.strict && !result.success) {
        this.error('Pipeline failed in strict mode.', { exit: 1 });
      }
      return;
    }

    // Display Stage Progress Table
    const table = new Table({
      head: [pc.bold('Stage'), pc.bold('Status'), pc.bold('Duration'), pc.bold('Details')],
      colWidths: [16, 12, 12, 50],
      wordWrap: true,
    });

    for (const stage of result.stages) {
      let statusLabel = pc.green('✔ SUCCESS');
      if (stage.status === 'WARNING') statusLabel = pc.yellow('⚠ WARNING');
      else if (stage.status === 'FAILED') statusLabel = pc.red('✖ FAILED');
      else if (stage.status === 'SKIPPED') statusLabel = pc.dim('⊘ SKIPPED');

      table.push([
        pc.bold(stage.stage.toUpperCase()),
        statusLabel,
        `${stage.durationMs}ms`,
        stage.message,
      ]);
    }

    this.log(table.toString());

    this.log(pc.bold('\n📊 Pipeline Summary:'));
    this.log(`  • Profiles Processed: ${pc.cyan(result.profilesProcessed.toString())}`);
    this.log(`  • Permission Sets Created: ${pc.green(result.summary.totalPermissionSetsCreated.toString())}`);
    this.log(`  • Permission Set Groups: ${pc.green(result.summary.totalGroupsCreated.toString())}`);
    this.log(`  • Average Access Parity: ${result.summary.averageParityScore === 100 ? pc.green('100% (Bit-for-bit match)') : pc.yellow(`${result.summary.averageParityScore}%`)}`);
    this.log(`  • Total Execution Time: ${pc.cyan(`${result.totalDurationMs}ms`)}`);
    if (result.summary.reportGenerated) {
      this.log(`  • Executive HTML Report: ${pc.cyan(result.summary.reportGenerated)}`);
    }

    if (!result.success) {
      this.log(pc.red('\n✖ Pipeline completed with failures or parity discrepancies.'));
      if (flags.strict) {
        this.error('Pipeline failed in strict mode.', { exit: 1 });
      }
    } else {
      this.log(pc.green('\n🎉 Migration Pipeline completed successfully! Zero access disruption guaranteed.'));
    }
  }

  private async handleInit(): Promise<void> {
    this.log(pc.bold(pc.cyan('\n⚙️ Initializing PermForge CI/CD Pipeline & Config...\n')));

    const pipelineConfig = {
      $schema: 'https://visparashar.github.io/permforge/schema/pipeline.json',
      sourceDir: 'force-app/main/default/profiles',
      outputDir: 'force-app/main/default',
      strict: true,
      stages: {
        audit: { enabled: true },
        cluster: { enabled: true, threshold: 0.75, baselineName: 'Standard_Employee_Baseline' },
        decompose: { enabled: true, strategy: 'by-domain' },
        verify: { enabled: true, minParityPercent: 100 },
        strip: { enabled: false },
        uap: { enabled: true },
        plan: { enabled: true },
        report: { enabled: true, reportPath: 'permforge-migration-report.html' },
      },
    };

    const configPath = path.resolve('permforge.pipeline.json');
    await fs.writeFile(configPath, JSON.stringify(pipelineConfig, null, 2), 'utf-8');
    this.log(pc.green(`✔ Created pipeline configuration: ${pc.bold('permforge.pipeline.json')}`));

    // Scaffold GitHub Actions Workflow
    const workflowDir = path.resolve('.github/workflows');
    await fs.mkdir(workflowDir, { recursive: true });

    const workflowContent = `name: Salesforce Profile Governance & Parity Gate

on:
  pull_request:
    paths:
      - '**/*.profile-meta.xml'
      - '**/*.profile'
      - '**/*.permissionset-meta.xml'
      - '**/*.permissionsetgroup-meta.xml'
  workflow_dispatch:

jobs:
  permforge-audit-gate:
    name: PermForge Parity & Security Gate
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20.x

      - name: Run PermForge CI Linter
        run: npx --yes permforge lint --source force-app/main/default/profiles --strict

      - name: Execute Full Migration Pipeline Simulation
        run: npx --yes permforge pipeline --run --source force-app/main/default/profiles --strict --dry-run
`;

    const workflowPath = path.join(workflowDir, 'salesforce-permforge-gate.yml');
    await fs.writeFile(workflowPath, workflowContent, 'utf-8');
    this.log(pc.green(`✔ Created GitHub Actions quality gate: ${pc.bold('.github/workflows/salesforce-permforge-gate.yml')}`));
    this.log(pc.cyan('\nCommit these files to your repository to enforce zero-profile-tech-debt in every Pull Request!'));
  }
}
