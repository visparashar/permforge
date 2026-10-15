import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader, LoadedProfile } from '../parser/profile-reader.js';
import { DriftEngine } from '../engine/drift-engine.js';
import { SalesforceOrgService } from '../services/salesforce-org.js';

export default class Drift extends Command {
  static override description =
    'Detect permission drift between environments (e.g. Local Repo vs. Target Org, Sandbox vs. Production, or two profile branches)';

  static override examples = [
    '<%= config.bin %> drift --base force-app/main/default/profiles/Sales_User.profile-meta.xml --target staging/Sales_User.profile-meta.xml',
    '<%= config.bin %> drift --base force-app/main/default/profiles --target staging/profiles',
    '<%= config.bin %> drift --base force-app/main/default/profiles/Sales_User.profile-meta.xml --target-org my-sandbox',
    '<%= config.bin %> drift --base force-app/main/default/profiles --target staging/profiles --reconcile --output-dir force-app/main/default',
    '<%= config.bin %> drift --base force-app/main/default/profiles --target staging/profiles --fail-on-drift',
    '<%= config.bin %> drift --base force-app/main/default/profiles --target staging/profiles --json',
  ];

  static override flags = {
    base: Flags.string({
      char: 'b',
      description: 'Path to base profile XML file or profiles directory',
      required: true,
    }),
    target: Flags.string({
      char: 't',
      description: 'Path to target profile XML file or profiles directory',
    }),
    'target-org': Flags.string({
      description: 'Salesforce org username or alias to retrieve target profile(s) from for live drift comparison',
    }),
    reconcile: Flags.boolean({
      char: 'r',
      description: 'Generate reconciliation Permission Set(s) containing drifted permissions',
      default: false,
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for generated reconciliation Permission Sets',
      default: 'force-app/main/default',
    }),
    'fail-on-drift': Flags.boolean({
      description: 'Exit with non-zero exit code if permission drift is detected (CI drift guard)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Drift);

    if (!flags.target && !flags['target-org']) {
      this.error(pc.red('Either --target (file/directory) or --target-org (Salesforce org alias) must be specified.'));
    }

    const reader = new ProfileReader();
    const driftEngine = new DriftEngine();

    // 1. Load Base Profiles
    if (!fs.existsSync(flags.base)) {
      this.error(pc.red(`Base path not found: ${flags.base}`));
    }
    const baseProfiles = await reader.loadProfiles(flags.base);
    if (baseProfiles.length === 0) {
      this.error(pc.red(`No valid profile metadata found at base path: ${flags.base}`));
    }

    // 2. Load Target Profiles
    let targetProfiles: LoadedProfile[] = [];
    let targetLabel = flags.target || flags['target-org'] || 'Target';

    if (flags['target-org']) {
      this.log(pc.dim(`Retrieving profiles from live org '${flags['target-org']}' for drift comparison...`));
      const orgService = new SalesforceOrgService();
      const profileNames = baseProfiles.map((p) => p.name);
      targetProfiles = await orgService.retrieveProfiles(profileNames, flags['target-org']);
    } else if (flags.target) {
      if (!fs.existsSync(flags.target)) {
        this.error(pc.red(`Target path not found: ${flags.target}`));
      }
      targetProfiles = await reader.loadProfiles(flags.target);
    }

    if (targetProfiles.length === 0) {
      this.error(pc.red(`No target profiles found to compare against.`));
    }

    // 3. Execute Comparison
    const multiReport = driftEngine.compareProfileCollections(baseProfiles, targetProfiles, {
      baseLabel: flags.base,
      targetLabel,
      generateReconciliation: flags.reconcile,
      reconciliationOutputDir: flags['output-dir'],
    });

    if (flags.json) {
      this.log(JSON.stringify(multiReport, null, 2));
      if (flags['fail-on-drift'] && multiReport.profilesWithDrift > 0) {
        this.exit(1);
      }
      return;
    }

    // 4. Human-Readable CLI Output
    this.log(pc.bold(pc.cyan('\n🔍 PermForge Cross-Environment Drift Guard')));
    this.log(pc.bold(pc.yellow('═══════════════════════════════════════════════════════════')));
    this.log(`Base Source:        ${pc.bold(multiReport.baseSource)}`);
    this.log(`Target Source:      ${pc.bold(multiReport.targetSource)}`);
    this.log(`Profiles Compared:  ${pc.bold(String(multiReport.totalProfilesCompared))}`);
    this.log(
      `Profiles w/ Drift:  ${multiReport.profilesWithDrift > 0 ? pc.red(String(multiReport.profilesWithDrift)) : pc.green('0')}`
    );
    this.log(`Total Drifts Found: ${multiReport.totalDriftsFound > 0 ? pc.red(String(multiReport.totalDriftsFound)) : pc.green('0')}`);
    this.log(`Highest Severity:   ${this.colorizeSeverity(multiReport.highestSeverity)}\n`);

    if (multiReport.totalDriftsFound === 0) {
      this.log(pc.green('✔ Environments are 100% synchronized! Zero permission drift detected.\n'));
      return;
    }

    for (const report of multiReport.reports) {
      if (!report.hasDrift) continue;

      this.log(pc.bold(`\n📋 Profile: ${pc.cyan(report.profileName)}`));
      this.log(`Drifts: ${pc.yellow(String(report.totalDrifts))} | Severity: ${this.colorizeSeverity(report.overallSeverity)}`);

      const table = new Table({
        head: [pc.bold('Category'), pc.bold('Item Name'), pc.bold('Drift Type'), pc.bold('Base'), pc.bold('Target'), pc.bold('Severity'), pc.bold('Details')],
        colWidths: [14, 22, 12, 14, 14, 12, 32],
        wordWrap: true,
      });

      for (const d of report.drifts.slice(0, 15)) {
        table.push([
          d.category,
          d.name,
          this.colorizeType(d.type),
          pc.dim(d.baseState),
          d.targetState,
          this.colorizeSeverity(d.severity),
          d.details,
        ]);
      }
      this.log(table.toString());

      if (report.drifts.length > 15) {
        this.log(pc.dim(`  ... and ${report.drifts.length - 15} more drift item(s).`));
      }

      if (flags.reconcile && report.reconciliationPermissionSet) {
        this.log(pc.green(`  ✔ Created Reconciliation Permission Set: ${pc.cyan(report.reconciliationPermissionSet.fileName)}`));
      }
    }

    if (!flags.reconcile && multiReport.totalDriftsFound > 0) {
      this.log(pc.dim('\n💡 Tip: Run with --reconcile to automatically generate Permission Sets reconciling the drifted permissions.'));
    }

    if (flags['fail-on-drift'] && multiReport.profilesWithDrift > 0) {
      this.error(pc.red(`\n❌ Drift Guard check failed: ${multiReport.totalDriftsFound} drift(s) detected across ${multiReport.profilesWithDrift} profile(s).`));
    }
  }

  private colorizeType(type: string): string {
    switch (type) {
      case 'ADDED':
        return pc.green('+ ADDED');
      case 'REMOVED':
        return pc.red('- REMOVED');
      case 'MODIFIED':
        return pc.yellow('~ MODIFIED');
      default:
        return type;
    }
  }

  private colorizeSeverity(sev: string): string {
    switch (sev) {
      case 'CRITICAL':
        return pc.bgRed(pc.white(' CRITICAL '));
      case 'HIGH':
        return pc.red(pc.bold('HIGH'));
      case 'MEDIUM':
        return pc.yellow('MEDIUM');
      case 'LOW':
        return pc.green('LOW');
      case 'NONE':
        return pc.green('NONE');
      default:
        return sev;
    }
  }
}
