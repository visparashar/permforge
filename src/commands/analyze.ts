import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ProfileAnalyzer } from '../engine/analyzer.js';

export default class Analyze extends Command {
  static override description =
    'Analyze Salesforce profiles to inventory permissions, detect high-risk access, and score complexity';

  static override examples = [
    '<%= config.bin %> analyze',
    '<%= config.bin %> analyze --source force-app/main/default/profiles',
    '<%= config.bin %> analyze --source path/to/Sales_User.profile-meta.xml',
    '<%= config.bin %> analyze --json',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to a profile file, directory, or glob pattern',
      default: 'force-app/main/default/profiles',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Analyze);

    const reader = new ProfileReader();
    const analyzer = new ProfileAnalyzer();

    const profiles = await reader.loadProfiles(flags.source);

    if (profiles.length === 0) {
      this.warn(`No profile metadata files found at: ${flags.source}`);
      return;
    }

    const analyses = profiles.map((p) => analyzer.analyzeProfile(p));

    if (flags.json) {
      this.log(JSON.stringify(analyses, null, 2));
      return;
    }

    this.log(pc.bold(pc.cyan('\n🔍 PermForge Profile Security & Complexity Analysis\n')));

    const table = new Table({
      head: [
        pc.bold('Profile Name'),
        pc.bold('Type'),
        pc.bold('Objects'),
        pc.bold('Fields'),
        pc.bold('User Perms'),
        pc.bold('Apex Classes'),
        pc.bold('High Risk'),
        pc.bold('Complexity'),
      ],
      style: { head: [], border: [] },
    });

    for (const a of analyses) {
      const complexityColor =
        a.complexityScore > 60
          ? pc.red(`${a.complexityScore}/100 (High)`)
          : a.complexityScore > 30
          ? pc.yellow(`${a.complexityScore}/100 (Med)`)
          : pc.green(`${a.complexityScore}/100 (Low)`);

      const highRiskDisplay =
        a.highRiskPermissions.length > 0
          ? pc.red(String(a.highRiskPermissions.length))
          : pc.green('0');

      table.push([
        pc.bold(a.name),
        a.custom ? 'Custom' : 'Standard',
        String(a.metrics.objectPermissionsCount),
        String(a.metrics.fieldPermissionsCount),
        String(a.metrics.userPermissionsCount),
        String(a.metrics.classAccessesCount),
        highRiskDisplay,
        complexityColor,
      ]);
    }

    this.log(table.toString());

    // Highlight any high-risk profiles
    const profilesWithHighRisk = analyses.filter((a) => a.highRiskPermissions.length > 0);
    if (profilesWithHighRisk.length > 0) {
      this.log(pc.bold(pc.yellow('\n⚠️  High-Risk Permissions Detected:')));
      for (const a of profilesWithHighRisk) {
        this.log(
          `  • ${pc.bold(a.name)}: ${pc.red(a.highRiskPermissions.slice(0, 5).join(', '))}${
            a.highRiskPermissions.length > 5 ? ` (+${a.highRiskPermissions.length - 5} more)` : ''
          }`
        );
      }
    }

    this.log(
      pc.dim(
        `\nTip: Run '${this.config.bin} decompose --source <path>' to break these into modular Permission Sets.`
      )
    );
  }
}
