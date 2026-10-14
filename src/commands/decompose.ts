import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ProfileDecomposer } from '../engine/decomposer.js';
import { ParityEngine } from '../engine/parity-engine.js';
import { DecompositionStrategy } from '../types/decomposition.js';

export default class Decompose extends Command {
  static override description =
    'Decompose legacy Profiles into modular, capability-based Permission Sets and Permission Set Groups';

  static override examples = [
    '<%= config.bin %> decompose --source path/to/Sales_User.profile-meta.xml',
    '<%= config.bin %> decompose --source force-app/main/default/profiles --output-dir force-app/main/default',
    '<%= config.bin %> decompose --source path/to/Profile.profile-meta.xml --strategy by-object',
    '<%= config.bin %> decompose --source path/to/Profile.profile-meta.xml --strategy consolidated',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to a profile file, directory, or glob pattern',
      required: true,
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for generated permission sets and groups',
      default: 'force-app/main/default',
    }),
    strategy: Flags.string({
      description: 'Decomposition strategy',
      options: ['by-domain', 'by-object', 'consolidated'],
      default: 'by-domain',
    }),
    prefix: Flags.string({
      description: 'Custom prefix for generated permission sets (defaults to profile name)',
    }),
    'no-group': Flags.boolean({
      description: 'Do not generate a Permission Set Group',
      default: false,
    }),
    'include-license': Flags.boolean({
      description: 'Include the original userLicense on generated permission sets',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Decompose);

    const reader = new ProfileReader();
    const decomposer = new ProfileDecomposer();
    const parityEngine = new ParityEngine();

    const profiles = await reader.loadProfiles(flags.source);

    if (profiles.length === 0) {
      this.error(`No profile metadata files found at: ${flags.source}`);
    }

    const allResults = [];

    for (const profile of profiles) {
      this.log(pc.bold(pc.cyan(`\n🔨 Decomposing profile: ${profile.name}...`)));

      const result = await decomposer.decompose(profile, {
        strategy: flags.strategy as DecompositionStrategy,
        outputDir: flags['output-dir'],
        prefix: flags.prefix,
        createGroup: !flags['no-group'],
        includeLicense: flags['include-license'],
      });

      // Run automatic parity check
      const targetPermSets = result.permissionSets.map((ps) => ps.metadata);
      const parity = parityEngine.verifyParity(
        profile,
        targetPermSets,
        result.permissionSetGroup?.apiName
      );

      allResults.push({
        ...result,
        parityScore: parity.parityScore,
        is100PercentMatch: parity.is100PercentMatch,
      });

      if (!flags.json) {
        const table = new Table({
          head: [pc.bold('Category'), pc.bold('Permission Set API Name'), pc.bold('File Created')],
          style: { head: [], border: [] },
        });

        for (const ps of result.permissionSets) {
          table.push([ps.category.toUpperCase(), pc.green(ps.apiName), ps.fileName]);
        }

        if (result.permissionSetGroup) {
          table.push([
            pc.magenta('GROUP (PSG)'),
            pc.bold(pc.magenta(result.permissionSetGroup.apiName)),
            result.permissionSetGroup.fileName,
          ]);
        }

        this.log(table.toString());

        const parityBadge = parity.is100PercentMatch
          ? pc.bold(pc.green(`✔ Access Parity: 100% Guaranteed`))
          : pc.bold(pc.yellow(`⚠️ Access Parity: ${parity.parityScore}%`));

        this.log(`\n  ${parityBadge}`);
        this.log(
          pc.dim(
            `  • SObjects Covered: ${result.stats.totalObjectsCovered} | Fields: ${result.stats.totalFieldsCovered} | System Perms: ${result.stats.totalUserPermissionsCovered}`
          )
        );
        this.log(pc.dim(`  • Output directory: ${flags['output-dir']}\n`));
      }
    }

    if (flags.json) {
      this.log(JSON.stringify(allResults, null, 2));
    } else {
      this.log(pc.bold(pc.green(`🎉 Successfully decomposed ${profiles.length} profile(s)!`)));
      this.log(
        pc.dim(
          `Run '${this.config.bin} plan --profile <name> --group <groupName>' to generate user assignment rollout scripts.`
        )
      );
    }
  }
}
