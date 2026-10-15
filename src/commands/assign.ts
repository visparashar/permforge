import * as path from 'node:path';
import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { SalesforceOrgService } from '../services/salesforce-org.js';

export default class Assign extends Command {
  static override description =
    'Assign Salesforce users from legacy profiles to generated Permission Set Groups or Permission Sets with 1-click rollback';

  static override examples = [
    '<%= config.bin %> assign --profile "Custom Admin" --psg "Custom_Admin_PSG"',
    '<%= config.bin %> assign --profile "Sales User" --psg "Sales_PSG" --dry-run',
    '<%= config.bin %> assign --profile "Standard User" --permset "Baseline_Employee_PS" --target-org my-sandbox',
    '<%= config.bin %> assign --rollback output/rollbacks/assignment-rollback-2026-10-15.json',
  ];

  static override flags = {
    profile: Flags.string({
      char: 'p',
      description: 'Source Profile name to query users from (e.g. "Custom Admin")',
    }),
    psg: Flags.string({
      char: 'g',
      description: 'Destination Permission Set Group API name or DeveloperName (e.g. "Custom_Admin_PSG")',
    }),
    permset: Flags.string({
      char: 's',
      description: 'Destination Permission Set API name (if assigning a single Permission Set rather than a PSG)',
    }),
    'target-org': Flags.string({
      char: 'o',
      description: 'Salesforce org username or alias (defaults to default SFDX/SF org)',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Simulate assignment without touching the org; preview affected users and skip statistics',
      default: false,
    }),
    'all-users': Flags.boolean({
      description: 'Include inactive users (default: active users only)',
      default: false,
    }),
    'user-filter': Flags.string({
      description: 'Optional comma-separated list of specific usernames or User IDs to assign',
    }),
    rollback: Flags.string({
      char: 'r',
      description: 'Path to a rollback JSON manifest file to delete previously created assignments',
    }),
    'output-dir': Flags.string({
      description: 'Directory to store generated assignment rollback manifests',
      default: 'output/rollbacks',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Assign);
    const orgService = new SalesforceOrgService();

    // 1. Handle Rollback mode
    if (flags.rollback) {
      return this.handleRollback(orgService, flags.rollback, flags['target-org'], flags.json);
    }

    // 2. Validate input requirements
    if (!flags.profile) {
      this.error(pc.red('Error: Missing required flag --profile. Specify the source profile name, or use --rollback.'));
    }

    const targetName = flags.psg || flags.permset;
    if (!targetName) {
      this.error(pc.red('Error: Missing target destination. Specify either --psg <name> or --permset <name>.'));
    }

    let auth;
    try {
      auth = orgService.resolveAuth(flags['target-org']);
    } catch (err: any) {
      if (flags.json) {
        this.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        this.error(pc.red(`Authentication failed: ${err.message}`));
      }
      return;
    }

    if (!flags.json) {
      this.log(pc.bold(pc.cyan('\n👥 PermForge Automated User Reassignment')));
      this.log(`  • Target Org:   ${pc.green(auth.username)} (${pc.dim(auth.instanceUrl)})`);
      this.log(`  • Source Profile: ${pc.yellow(flags.profile)}`);
      this.log(`  • Target Access:  ${pc.magenta(targetName)}\n`);
    }

    const userFilter = flags['user-filter']
      ? flags['user-filter'].split(',').map((u) => u.trim()).filter(Boolean)
      : undefined;

    // 3. Generate Assignment Plan
    let plan;
    try {
      plan = await orgService.planUserAssignments(flags.profile, targetName, flags['target-org'], {
        activeOnly: !flags['all-users'],
        userFilter,
      });
    } catch (err: any) {
      if (flags.json) {
        this.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        this.error(pc.red(`Failed to plan user assignments: ${err.message}`));
      }
      return;
    }

    // 4. If Dry-Run: output preview and exit
    if (flags['dry-run']) {
      if (flags.json) {
        this.log(JSON.stringify({ dryRun: true, plan }, null, 2));
        return;
      }

      this.log(pc.bold(pc.yellow('🔍 Dry-Run Preview (No org modifications made)')));
      const summaryTable = new Table({
        head: [pc.bold('Metric'), pc.bold('Count')],
        colWidths: [35, 15],
      });

      summaryTable.push(
        ['Total Users on Profile', String(plan.totalUsersFound)],
        ['Active Users', pc.green(String(plan.activeUsersCount))],
        ['Inactive Users', pc.dim(String(plan.inactiveUsersCount))],
        ['Already Assigned (Skipped)', pc.cyan(String(plan.alreadyAssignedCount))],
        ['Pending Assignments', pc.bold(pc.yellow(String(plan.usersToAssign.length)))]
      );
      this.log(summaryTable.toString());

      if (plan.usersToAssign.length > 0) {
        this.log(pc.bold('\n👤 Users to be assigned:'));
        const userTable = new Table({
          head: [pc.bold('Name'), pc.bold('Username'), pc.bold('User ID')],
          colWidths: [25, 35, 22],
        });

        for (const u of plan.usersToAssign.slice(0, 20)) {
          userTable.push([u.name, u.username, pc.dim(u.id)]);
        }
        this.log(userTable.toString());
        if (plan.usersToAssign.length > 20) {
          this.log(pc.dim(`  ... and ${plan.usersToAssign.length - 20} more users.`));
        }
        this.log(
          pc.cyan(
            `\nTo apply these assignments, re-run without --dry-run:\n  permforge assign -p "${flags.profile}" --psg "${targetName}"\n`
          )
        );
      } else {
        this.log(pc.green('\n✅ All eligible users are already assigned to this target! Nothing to do.\n'));
      }
      return;
    }

    // 5. Execute Assignments
    if (!flags.json) {
      this.log(pc.cyan(`⚡ Executing assignments for ${plan.usersToAssign.length} user(s)...`));
    }

    let result;
    try {
      result = await orgService.executeUserAssignments(plan, flags['target-org'], {
        rollbackDir: flags['output-dir'],
      });
    } catch (err: any) {
      if (flags.json) {
        this.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        this.error(pc.red(`Execution failed: ${err.message}`));
      }
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    // 6. Display Results
    if (result.success) {
      this.log(pc.bold(pc.green(`\n🎉 Successfully assigned ${result.assignedCount} user(s)!`)));
    } else {
      this.log(pc.bold(pc.yellow(`\n⚠️ Partial execution: ${result.assignedCount} assigned, ${result.failedCount} failed.`)));
    }

    if (result.rollbackFile) {
      this.log(pc.bold(pc.cyan('\n🛡️ 1-Click Rollback Manifest Saved:')));
      this.log(`  ${pc.white(path.resolve(result.rollbackFile))}`);
      this.log(pc.dim(`  To revert these assignments at any time, run:`));
      this.log(pc.yellow(`  permforge assign --rollback "${result.rollbackFile}"\n`));
    }
  }

  private async handleRollback(
    orgService: SalesforceOrgService,
    rollbackPath: string,
    targetOrg?: string,
    isJson?: boolean
  ): Promise<void> {
    if (!isJson) {
      this.log(pc.bold(pc.yellow('\n🔄 PermForge User Assignment Rollback')));
      this.log(`  • Manifest File: ${pc.white(rollbackPath)}\n`);
    }

    try {
      const rollbackResult = await orgService.rollbackUserAssignments(rollbackPath, targetOrg);
      if (isJson) {
        this.log(JSON.stringify(rollbackResult, null, 2));
        return;
      }

      if (rollbackResult.success) {
        this.log(pc.bold(pc.green(`\n✅ Rollback Complete: Successfully removed ${rollbackResult.deletedCount} assignment(s)!`)));
      } else {
        this.log(
          pc.bold(
            pc.yellow(
              `\n⚠️ Rollback finished with warnings: ${rollbackResult.deletedCount} removed, ${rollbackResult.failedCount} failed.`
            )
          )
        );
        for (const err of rollbackResult.errors) {
          this.log(pc.red(`  • ${err}`));
        }
      }
      this.log('');
    } catch (err: any) {
      if (isJson) {
        this.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        this.error(pc.red(`Rollback failed: ${err.message}`));
      }
    }
  }
}
