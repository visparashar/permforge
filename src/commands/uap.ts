import { Command, Flags } from '@oclif/core';
import pc from 'picocolors';
import { UapBuilder, UapPredicate } from '../engine/uap-builder.js';

export default class Uap extends Command {
  static override description =
    'Generate native Salesforce User Access Policy (UAP) metadata to automate zero-touch user provisioning';

  static override examples = [
    '<%= config.bin %> uap --name Sales_User_Assign --group Sales_User_PSG --criteria "Department=Sales"',
    '<%= config.bin %> uap --name Support_Assign --group Support_PSG --criteria "Department=Support,Profile.Name=Minimum Access - Salesforce"',
  ];

  static override flags = {
    name: Flags.string({
      char: 'n',
      description: 'DeveloperName for the User Access Policy',
      required: true,
    }),
    group: Flags.string({
      char: 'g',
      description: 'Target Permission Set Group to grant',
      required: true,
    }),
    criteria: Flags.string({
      char: 'c',
      description:
        'Comma-separated Field=Value criteria pairs (e.g. "Department=Sales,UserType=Standard")',
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
    const { flags } = await this.parse(Uap);

    const builder = new UapBuilder();

    const predicates: UapPredicate[] = [];
    if (flags.criteria) {
      const pairs = flags.criteria.split(',');
      for (const pair of pairs) {
        const [field, value] = pair.split('=').map((s) => s.trim());
        if (field && value) {
          predicates.push({
            field,
            operator: 'Equals',
            value,
          });
        }
      }
    }

    const result = await builder.generateUap({
      name: flags.name,
      psgName: flags.group,
      predicates: predicates.length > 0 ? predicates : undefined,
      outputDir: flags['output-dir'],
    });

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    this.log(pc.bold(pc.cyan(`\n🤖 User Access Policy Generated: ${result.developerName}`)));
    this.log(`  • Target Group: ${pc.magenta(result.targetGroup)}`);
    this.log(`  • File Created: ${pc.green(result.filePath)}`);
    this.log(
      pc.dim(
        `Deploy this metadata with 'sf project deploy start --metadata UserAccessPolicy:${result.developerName}' for automatic user assignment.\n`
      )
    );
  }
}
