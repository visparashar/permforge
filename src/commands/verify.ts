import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { XmlEngine } from '../parser/xml-engine.js';
import { ParityEngine } from '../engine/parity-engine.js';
import { PermissionSetMetadata } from '../types/metadata.js';

export default class Verify extends Command {
  static override description =
    'Verify security & access parity between a source Profile and target Permission Sets / Permission Set Groups';

  static override examples = [
    '<%= config.bin %> verify --profile path/to/Sales_User.profile-meta.xml --group path/to/Sales_User_PSG.permissionsetgroup-meta.xml',
    '<%= config.bin %> verify --profile path/to/Sales_User.profile-meta.xml --permsets-dir force-app/main/default/permissionsets',
  ];

  static override flags = {
    profile: Flags.string({
      char: 'p',
      description: 'Path to source profile (.profile-meta.xml)',
      required: true,
    }),
    group: Flags.string({
      char: 'g',
      description: 'Path to target Permission Set Group (.permissionsetgroup-meta.xml)',
    }),
    'permsets-dir': Flags.string({
      char: 'd',
      description: 'Directory where target permission sets reside',
      default: 'force-app/main/default/permissionsets',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Verify);

    const reader = new ProfileReader();
    const xmlEngine = new XmlEngine();
    const parityEngine = new ParityEngine();

    const loadedProfile = await reader.loadProfile(flags.profile);

    const permSetsToVerify: PermissionSetMetadata[] = [];
    let groupName: string | undefined;

    if (flags.group) {
      const groupContent = await fs.readFile(path.resolve(flags.group), 'utf-8');
      const groupMeta = xmlEngine.parsePermissionSetGroup(groupContent);
      groupName = path.basename(flags.group).replace(/\.permissionsetgroup(-meta\.xml)?$/, '');

      for (const psName of groupMeta.permissionSets) {
        const psPath = path.join(flags['permsets-dir'], `${psName}.permissionset-meta.xml`);
        try {
          const psContent = await fs.readFile(psPath, 'utf-8');
          permSetsToVerify.push(xmlEngine.parsePermissionSet(psContent));
        } catch {
          this.warn(`Could not locate permission set file: ${psPath}`);
        }
      }
    } else {
      // Load all permission sets in target dir
      const dirEntries = await fs.readdir(path.resolve(flags['permsets-dir']));
      for (const entry of dirEntries) {
        if (entry.endsWith('.permissionset-meta.xml')) {
          const psContent = await fs.readFile(path.join(flags['permsets-dir'], entry), 'utf-8');
          permSetsToVerify.push(xmlEngine.parsePermissionSet(psContent));
        }
      }
    }

    if (permSetsToVerify.length === 0) {
      this.error(`No permission set files found to verify against.`);
    }

    const report = parityEngine.verifyParity(loadedProfile, permSetsToVerify, groupName);

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2));
      return;
    }

    this.log(pc.bold(pc.cyan(`\n🛡️  Access Parity Report: ${loadedProfile.name}\n`)));

    const summaryTable = new Table({
      head: [pc.bold('Category'), pc.bold('Status'), pc.bold('Coverage')],
      style: { head: [], border: [] },
    });

    summaryTable.push(
      [
        'Object CRUD & Admin',
        report.summary.objectsMatch ? pc.green('✔ MATCH') : pc.red('✖ MISMATCH'),
        '',
      ],
      [
        'Field-Level Security (FLS)',
        report.summary.fieldsMatch ? pc.green('✔ MATCH') : pc.red('✖ MISMATCH'),
        '',
      ],
      [
        'System User Permissions',
        report.summary.userPermissionsMatch ? pc.green('✔ MATCH') : pc.red('✖ MISMATCH'),
        '',
      ],
      [
        'Apex & VF Access',
        report.summary.apexMatch ? pc.green('✔ MATCH') : pc.red('✖ MISMATCH'),
        '',
      ],
      [
        pc.bold('Overall Parity'),
        report.is100PercentMatch
          ? pc.bold(pc.green('100.0%'))
          : pc.bold(pc.yellow(`${report.parityScore}%`)),
        `${report.totalTargetPermissions}/${report.totalOriginalPermissions} permissions verified`,
      ]
    );

    this.log(summaryTable.toString());

    if (report.mismatches.length > 0) {
      this.log(pc.bold(pc.red('\n✖ Mismatches Found:')));
      const mismatchTable = new Table({
        head: [pc.bold('Type'), pc.bold('Target'), pc.bold('Details')],
        style: { head: [], border: [] },
      });

      for (const m of report.mismatches.slice(0, 15)) {
        mismatchTable.push([m.type, m.identifier, pc.yellow(m.detail)]);
      }

      this.log(mismatchTable.toString());
      if (report.mismatches.length > 15) {
        this.log(pc.dim(`  ... and ${report.mismatches.length - 15} more mismatches.`));
      }
    } else {
      this.log(
        pc.bold(
          pc.green('\n✔ PERFECT MATCH: All permissions from original profile are fully preserved.')
        )
      );
    }
  }
}
