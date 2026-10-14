import { Command, Flags } from '@oclif/core';
import pc from 'picocolors';
import { MuteBuilder, MuteObjectOptions } from '../engine/mute-builder.js';

export default class Mute extends Command {
  static override description =
    'Generate a Muting Permission Set to selectively restrict permissions inside a Permission Set Group';

  static override examples = [
    '<%= config.bin %> mute --name Sales_Junior_Mute --mute-delete Account,Opportunity',
    '<%= config.bin %> mute --name Contractor_Mute --mute-delete Case --mute-perms ExportReport',
  ];

  static override flags = {
    name: Flags.string({
      char: 'n',
      description: 'API Name for the generated Muting Permission Set',
      required: true,
    }),
    'mute-delete': Flags.string({
      description: 'Comma-separated list of SObjects where Delete access will be muted',
    }),
    'mute-perms': Flags.string({
      description: 'Comma-separated list of User Permissions to mute',
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for metadata',
      default: 'force-app/main/default',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Mute);

    const builder = new MuteBuilder();

    const mutedObjects: MuteObjectOptions[] = [];
    if (flags['mute-delete']) {
      const objs = flags['mute-delete'].split(',').map((s) => s.trim());
      for (const obj of objs) {
        if (obj) {
          mutedObjects.push({
            object: obj,
            muteDelete: true,
          });
        }
      }
    }

    const mutedUserPerms = flags['mute-perms']
      ? flags['mute-perms']
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const result = await builder.generateMutingPermissionSet({
      name: flags.name,
      mutedObjects: mutedObjects.length > 0 ? mutedObjects : undefined,
      mutedUserPerms,
      outputDir: flags['output-dir'],
    });

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    this.log(pc.bold(pc.cyan(`\n🔇 Muting Permission Set Generated: ${result.apiName}`)));
    this.log(`  • File Created: ${pc.green(result.filePath)}`);
    if (mutedObjects.length > 0) {
      this.log(`  • Muted Delete on: ${pc.yellow(mutedObjects.map((o) => o.object).join(', '))}`);
    }
    if (mutedUserPerms && mutedUserPerms.length > 0) {
      this.log(`  • Muted Permissions: ${pc.yellow(mutedUserPerms.join(', '))}`);
    }
    this.log(
      pc.dim(
        'Assign this Muting Permission Set inside your Permission Set Group to apply the restrictions.\n'
      )
    );
  }
}
