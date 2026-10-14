import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ProfileLinter } from '../engine/profile-linter.js';

export default class Lint extends Command {
  static override description =
    'Lint profiles in CI/CD to enforce the zero-profile-permissions standard and prevent tech debt regressions';

  static override examples = [
    '<%= config.bin %> lint',
    '<%= config.bin %> lint --source force-app/main/default/profiles',
    '<%= config.bin %> lint --github-actions',
    '<%= config.bin %> lint --warn-only',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to profiles directory or glob pattern',
      default: 'force-app/main/default/profiles',
    }),
    'warn-only': Flags.boolean({
      description: 'Emit warnings without exiting with error code 1',
      default: false,
    }),
    'github-actions': Flags.boolean({
      description: 'Format output as GitHub Actions annotations',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Lint);

    const reader = new ProfileReader();
    const linter = new ProfileLinter();

    const profiles = await reader.loadProfiles(flags.source);

    if (profiles.length === 0) {
      this.warn(`No profile metadata files found at: ${flags.source}`);
      return;
    }

    const report = linter.lintProfiles(profiles);

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2));
      if (!flags['warn-only'] && report.totalViolations > 0) {
        this.exit(1);
      }
      return;
    }

    if (flags['github-actions']) {
      for (const v of report.violations) {
        this.log(`::error file=${v.filePath},title=Profile Permissions Deprecated::${v.message}`);
      }
    }

    this.log(pc.bold(pc.cyan('\n🔍 PermForge Profile CI/CD Linting Check\n')));

    if (report.totalViolations === 0) {
      this.log(
        pc.bold(
          pc.green(
            `✔ All ${report.totalProfilesScanned} profiles are 100% compliant with the zero-profile-permissions standard!`
          )
        )
      );
      this.log(pc.dim('No deprecated permissions found in profile metadata.\n'));
      return;
    }

    this.log(
      pc.bold(
        pc.red(
          `✖ Found ${report.totalViolations} permission violation(s) across ${report.violatingProfilesCount} profile(s):\n`
        )
      )
    );

    const table = new Table({
      head: [pc.bold('Profile'), pc.bold('Violation Type'), pc.bold('Identifier')],
      style: { head: [], border: [] },
    });

    for (const v of report.violations.slice(0, 20)) {
      table.push([pc.bold(v.profileName), pc.yellow(v.type), pc.red(v.identifier)]);
    }

    this.log(table.toString());
    if (report.violations.length > 20) {
      this.log(pc.dim(`  ... and ${report.violations.length - 20} more violations.`));
    }

    this.log(
      pc.dim(
        `\nTip: Run 'permforge decompose' to move these permissions into Permission Sets, then 'permforge strip' to sanitize the profiles.`
      )
    );

    if (!flags['warn-only']) {
      this.error(
        `CI check failed: ${report.totalViolations} deprecated permissions detected in profile files.`
      );
    }
  }
}
