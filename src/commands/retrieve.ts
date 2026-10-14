import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { SalesforceOrgService } from '../services/salesforce-org.js';

export default class Retrieve extends Command {
  static override description =
    'Retrieve profile metadata directly from an authenticated live Salesforce org';

  static override examples = [
    '<%= config.bin %> retrieve --list',
    '<%= config.bin %> retrieve --target-org my-sandbox --list',
    '<%= config.bin %> retrieve --target-org my-sandbox --profiles "Custom_Admin,Sales_User"',
    '<%= config.bin %> retrieve --all-custom --output-dir force-app/main/default/profiles',
  ];

  static override flags = {
    'target-org': Flags.string({
      char: 'o',
      description: 'Salesforce org username or alias (defaults to default SFDX/SF org)',
    }),
    profiles: Flags.string({
      char: 'p',
      description: 'Comma-separated list of profile names to retrieve',
    }),
    'all-custom': Flags.boolean({
      description: 'Retrieve all custom profiles found in the org',
      default: false,
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for retrieved .profile-meta.xml files',
      default: 'force-app/main/default/profiles',
    }),
    list: Flags.boolean({
      description: 'List all profiles available in the live org without retrieving',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Retrieve);
    const orgService = new SalesforceOrgService();

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
      this.log(pc.bold(pc.cyan('\n☁️ PermForge Live Salesforce Org Connection')));
      this.log(`  • Org User: ${pc.green(auth.username)}`);
      this.log(`  • Instance: ${pc.cyan(auth.instanceUrl)}\n`);
    }

    // 1. If --list: query and display profiles
    if (flags.list || (!flags.profiles && !flags['all-custom'])) {
      const profiles = await orgService.listProfiles(flags['target-org']);

      if (flags.json) {
        this.log(JSON.stringify(profiles, null, 2));
        return;
      }

      this.log(pc.bold(`Discovered ${profiles.length} profiles in org:`));
      const table = new Table({
        head: [pc.bold('Name'), pc.bold('User Type'), pc.bold('Custom?'), pc.bold('Id')],
        colWidths: [35, 22, 12, 22],
      });

      for (const p of profiles) {
        table.push([
          p.name,
          p.userType,
          p.custom ? pc.green('Yes') : pc.dim('No'),
          p.id,
        ]);
      }

      this.log(table.toString());
      this.log(pc.dim('\nTo retrieve specific profiles, run:'));
      this.log(pc.cyan(`  permforge retrieve -o ${auth.username} --profiles "${profiles.slice(0, 2).map((p) => p.name).join(',')}"\n`));
      return;
    }

    // 2. Retrieve profiles
    let targetNames: string[] = [];
    if (flags.profiles) {
      targetNames = flags.profiles.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (flags['all-custom']) {
      const allProfiles = await orgService.listProfiles(flags['target-org'], { customOnly: true });
      targetNames = allProfiles.filter((p) => p.custom).map((p) => p.name);
    }

    if (targetNames.length === 0) {
      this.log(pc.yellow('No matching profiles found to retrieve.'));
      return;
    }

    if (!flags.json) {
      this.log(pc.bold(`📥 Retrieving ${targetNames.length} profile(s) via Metadata API...`));
    }

    const retrieved = await orgService.retrieveProfiles(targetNames, flags['target-org'], {
      saveToDir: flags['output-dir'],
    });

    if (flags.json) {
      this.log(JSON.stringify(retrieved, null, 2));
      return;
    }

    const resultTable = new Table({
      head: [pc.bold('Profile Name'), pc.bold('Objects'), pc.bold('FLS Fields'), pc.bold('System Perms'), pc.bold('File Saved')],
      colWidths: [26, 12, 14, 16, 36],
    });

    for (const p of retrieved) {
      resultTable.push([
        p.name,
        p.metadata.objectPermissions?.length || 0,
        p.metadata.fieldPermissions?.length || 0,
        p.metadata.userPermissions?.length || 0,
        pc.green(p.filePath),
      ]);
    }

    this.log(resultTable.toString());
    this.log(pc.green(`\n✔ Successfully retrieved and saved ${retrieved.length} profile(s) to ${pc.bold(flags['output-dir'])}!`));
    this.log(pc.cyan(`\nNext step: Run the migration pipeline:`));
    this.log(`  ${pc.bold(`permforge pipeline --run --source ${flags['output-dir']} --cluster`)}\n`);
  }
}
