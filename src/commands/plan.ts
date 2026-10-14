import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { RolloutPlanner } from '../engine/rollout-planner.js';

export default class Plan extends Command {
  static override description =
    'Generate user assignment rollout plans, CSV import templates, and rollback scripts';

  static override examples = [
    '<%= config.bin %> plan --profile Sales_User --group Sales_User_PSG',
    '<%= config.bin %> plan --profile Sales_User --group Sales_User_PSG --target-base "Minimum Access - Salesforce"',
  ];

  static override flags = {
    profile: Flags.string({
      char: 'p',
      description: 'Name of the legacy profile',
      required: true,
    }),
    group: Flags.string({
      char: 'g',
      description: 'Name of the target Permission Set Group',
      required: true,
    }),
    'target-base': Flags.string({
      char: 'b',
      description: 'Target base profile to assign users to',
      default: 'Minimum Access - Salesforce',
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Directory to write rollout scripts and templates',
      default: 'migration-plans',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Plan);

    const planner = new RolloutPlanner();

    this.log(pc.bold(pc.cyan(`\n📋 Generating Rollout & Migration Plan for ${flags.profile}...\n`)));

    const result = await planner.generatePlan({
      profileName: flags.profile,
      psgName: flags.group,
      targetBaseProfile: flags['target-base'],
      outputDir: flags['output-dir'],
    });

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    const table = new Table({
      head: [pc.bold('Artifact Type'), pc.bold('File Path')],
      style: { head: [], border: [] },
    });

    table.push(
      ['Migration Guide & Checklist', pc.green(result.planFilePath)],
      ['User Assignment CSV Template', pc.cyan(result.csvTemplatePath)],
      ['Automated Migration Script', pc.yellow(result.scriptPath)],
      ['Emergency Rollback Script', pc.red(result.rollbackScriptPath)]
    );

    this.log(table.toString());
    this.log(pc.bold(pc.green('\n✔ Rollout package created successfully!')));
    this.log(pc.dim('Review the generated markdown guide before applying changes to sandbox or production.\n'));
  }
}
