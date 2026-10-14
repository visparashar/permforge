import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ProfileStripper } from '../engine/profile-stripper.js';

export default class Strip extends Command {
  static override description =
    'Sanitize & strip deprecated permissions from profiles, retaining layout assignments, credentials, and settings';

  static override aliases = ['clean'];

  static override examples = [
    '<%= config.bin %> strip --source path/to/Sales_User.profile-meta.xml',
    '<%= config.bin %> strip --source force-app/main/default/profiles --output-dir force-app/main/default/clean-profiles',
    '<%= config.bin %> strip --source force-app/main/default/profiles --in-place --backup',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to profile file, directory, or glob pattern',
      required: true,
    }),
    'output-dir': Flags.string({
      char: 'd',
      description:
        'Destination directory for stripped profiles (defaults to writing in place if --in-place)',
    }),
    'in-place': Flags.boolean({
      description: 'Overwrite original profile files in-place',
      default: false,
    }),
    backup: Flags.boolean({
      description: 'Create a .bak copy before modifying files',
      default: true,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Strip);

    const reader = new ProfileReader();
    const stripper = new ProfileStripper();

    const profiles = await reader.loadProfiles(flags.source);

    if (profiles.length === 0) {
      this.error(`No profile metadata files found at: ${flags.source}`);
    }

    if (!flags['in-place'] && !flags['output-dir']) {
      this.error(
        'Please specify either --output-dir <path> or --in-place to execute profile stripping.'
      );
    }

    this.log(
      pc.bold(
        pc.cyan(`\n🧹 Sanitizing & Stripping Permissions from ${profiles.length} Profile(s)...\n`)
      )
    );

    const results = [];

    for (const profile of profiles) {
      const res = await stripper.stripProfile(profile, {
        outputDir: flags['output-dir'],
        inPlace: flags['in-place'],
        createBackup: flags.backup,
      });
      results.push(res);
    }

    if (flags.json) {
      this.log(JSON.stringify(results, null, 2));
      return;
    }

    const table = new Table({
      head: [
        pc.bold('Profile'),
        pc.bold('Objects Stripped'),
        pc.bold('Fields Stripped'),
        pc.bold('User Perms Stripped'),
        pc.bold('Output File'),
      ],
      style: { head: [], border: [] },
    });

    for (const r of results) {
      table.push([
        pc.bold(r.profileName),
        pc.red(String(r.strippedStats.objectPermissionsRemoved)),
        pc.red(String(r.strippedStats.fieldPermissionsRemoved)),
        pc.red(String(r.strippedStats.userPermissionsRemoved)),
        pc.green(r.outputPath),
      ]);
    }

    this.log(table.toString());
    this.log(
      pc.bold(
        pc.green(
          `\n✔ Successfully sanitized ${results.length} profile(s)! All layout assignments and defaults are preserved.`
        )
      )
    );
    this.log(
      pc.dim(
        'The stripped profiles are now compliant with Salesforce Profile Permissions Retirement.\n'
      )
    );
  }
}
