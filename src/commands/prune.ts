import * as fs from 'node:fs';
import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { LeastPrivilegeEngine } from '../engine/least-privilege-engine.js';

export default class Prune extends Command {
  static override description =
    'Audit profile permissions against Salesforce Event Monitoring logs, calculate over-privilege scores, and generate least-privilege or muting permission sets';

  static override examples = [
    '<%= config.bin %> prune --profile force-app/main/default/profiles/Sales_User.profile-meta.xml --events telemetry/events.csv',
    '<%= config.bin %> prune --profile force-app/main/default/profiles/Sales_User.profile-meta.xml --events telemetry/events.csv --mode prune --output-dir force-app/main/default',
    '<%= config.bin %> prune --profile force-app/main/default/profiles/Sales_User.profile-meta.xml --events telemetry/events.csv --mode mute --output-dir force-app/main/default',
    '<%= config.bin %> prune --profile force-app/main/default/profiles/Sales_User.profile-meta.xml --events telemetry/events.csv --json',
  ];

  static override flags = {
    profile: Flags.string({
      char: 'p',
      description: 'Path to source profile XML file',
      required: true,
    }),
    events: Flags.string({
      char: 'e',
      description: 'Path to Salesforce Event Monitoring CSV/JSON telemetry file',
      required: true,
    }),
    mode: Flags.string({
      char: 'm',
      description: 'Optimization mode: audit-only, prune (generates least-privilege permset), or mute (generates muting permset)',
      options: ['audit-only', 'prune', 'mute'],
      default: 'audit-only',
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for generated permission sets',
      default: 'force-app/main/default',
    }),
    'pruned-name': Flags.string({
      description: 'Custom API name for the generated pruned Permission Set',
    }),
    'muting-name': Flags.string({
      description: 'Custom API name for the generated Muting Permission Set',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Prune);

    if (!fs.existsSync(flags.profile)) {
      this.error(pc.red(`Profile file not found at: ${flags.profile}`));
    }
    if (!fs.existsSync(flags.events)) {
      this.error(pc.red(`Event telemetry file not found at: ${flags.events}`));
    }

    const reader = new ProfileReader();
    const profile = await reader.loadProfile(flags.profile);

    const eventContent = fs.readFileSync(flags.events, 'utf-8');
    const engine = new LeastPrivilegeEngine();

    const footprint = engine.parseEvents(eventContent);
    const report = await engine.auditProfile(profile, footprint, {
      mode: flags.mode as 'audit-only' | 'prune' | 'mute',
      outputDir: flags['output-dir'],
      prunedName: flags['pruned-name'],
      mutingName: flags['muting-name'],
    });

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2));
      return;
    }

    this.log(pc.bold(pc.cyan('\n🛡️  PermForge Usage-Driven Least-Privilege Optimizer')));
    this.log(pc.bold(pc.yellow('═══════════════════════════════════════════════════════════')));
    this.log(`Profile:                ${pc.bold(pc.cyan(report.profileName))}`);
    this.log(`Telemetry Events:       ${pc.bold(String(footprint.totalEventsCount))}`);
    this.log(`Permissions Granted:    ${pc.bold(String(report.totalPermissionsGranted))}`);
    this.log(`Permissions Exercised:  ${pc.green(String(report.exercisedPermissionsCount))}`);
    this.log(`Permissions Dormant:    ${pc.red(String(report.dormantPermissionsCount))}`);
    this.log(`Utilization Rate:       ${pc.bold(this.colorizeUtilization(report.utilizationRatePercent))}`);
    this.log(`Over-Privilege Score:   ${pc.bold(this.colorizeOverPrivilege(report.overPrivilegeScore))}`);
    this.log(`Dormant Risk Level:     ${this.colorizeRisk(report.dormantRiskLevel)}\n`);

    if (report.dormantPermissions.length > 0) {
      this.log(pc.bold('⚠️  Dormant Unexercised Permissions:'));
      const table = new Table({
        head: [pc.bold('Category'), pc.bold('Permission Name'), pc.bold('Granted Access'), pc.bold('Risk'), pc.bold('Recommendation')],
        colWidths: [15, 26, 22, 12, 38],
        wordWrap: true,
      });

      const displayList = report.dormantPermissions.slice(0, 15);
      for (const item of displayList) {
        table.push([
          item.category,
          item.name,
          pc.dim(item.grantedAccess),
          this.colorizeRisk(item.riskLevel),
          item.recommendation,
        ]);
      }
      this.log(table.toString());

      if (report.dormantPermissions.length > 15) {
        this.log(pc.dim(`  ... and ${report.dormantPermissions.length - 15} more dormant permissions.\n`));
      }
    } else {
      this.log(pc.green('✔ Perfect least-privilege alignment! All granted permissions were actively exercised in telemetry.\n'));
    }

    // Remediation output
    if (flags.mode === 'prune' && report.generatedPrunedPermissionSet) {
      this.log(pc.bold(pc.green('\n✔ Generated Pruned Least-Privilege Permission Set:')));
      this.log(`  • API Name: ${pc.cyan(report.generatedPrunedPermissionSet.apiName)}`);
      this.log(`  • File:     ${report.generatedPrunedPermissionSet.fileName}`);
      this.log(`  • Retained: ${report.exercisedPermissionsCount} active permission(s)`);
      this.log(`  • Excluded: ${report.dormantPermissionsCount} dormant permission(s)\n`);
    } else if (flags.mode === 'mute' && report.generatedMutingPermissionSet) {
      this.log(pc.bold(pc.green('\n✔ Generated Targeted Muting Permission Set:')));
      this.log(`  • API Name: ${pc.cyan(report.generatedMutingPermissionSet.apiName)}`);
      this.log(`  • File:     ${report.generatedMutingPermissionSet.filePath}\n`);
    } else if (flags.mode === 'audit-only' && report.dormantPermissionsCount > 0) {
      this.log(
        pc.dim(
          '💡 Tip: Run with --mode prune to generate a stripped Permission Set, or --mode mute to generate a Muting Permission Set for Permission Set Groups.'
        )
      );
    }
  }

  private colorizeUtilization(rate: number): string {
    if (rate >= 80) return pc.green(`${rate}%`);
    if (rate >= 50) return pc.yellow(`${rate}%`);
    return pc.red(`${rate}%`);
  }

  private colorizeOverPrivilege(score: number): string {
    if (score >= 50) return pc.red(`${score}% (High Excess Privilege)`);
    if (score >= 20) return pc.yellow(`${score}% (Moderate Excess Privilege)`);
    return pc.green(`${score}% (Well Aligned)`);
  }

  private colorizeRisk(risk: string): string {
    switch (risk) {
      case 'CRITICAL':
        return pc.bgRed(pc.white(' CRITICAL '));
      case 'HIGH':
        return pc.red(pc.bold('HIGH'));
      case 'MEDIUM':
        return pc.yellow('MEDIUM');
      case 'LOW':
        return pc.green('LOW');
      default:
        return risk;
    }
  }
}
