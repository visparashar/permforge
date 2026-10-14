import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ClusterEngine } from '../engine/cluster-engine.js';
import { ParityEngine } from '../engine/parity-engine.js';

export default class Cluster extends Command {
  static override description =
    'Analyze all profiles together to extract a shared Standard Baseline Permission Set and isolate role-specific deltas';

  static override examples = [
    '<%= config.bin %> cluster',
    '<%= config.bin %> cluster --source force-app/main/default/profiles',
    '<%= config.bin %> cluster --threshold 0.6 --base-name "Global_Core_Access"',
    '<%= config.bin %> cluster --output-dir force-app/main/default',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to profiles directory or glob pattern',
      default: 'force-app/main/default/profiles',
    }),
    threshold: Flags.string({
      char: 't',
      description: 'Frequency threshold for baseline inclusion (0.1 to 1.0)',
      default: '0.75',
    }),
    'base-name': Flags.string({
      description: 'API Name for the generated shared baseline Permission Set',
      default: 'Standard_Employee_Baseline',
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for generated permission sets and groups',
      default: 'force-app/main/default',
    }),
    'no-groups': Flags.boolean({
      description: 'Do not generate Permission Set Groups',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Cluster);

    const thresholdNum = parseFloat(flags.threshold);
    if (isNaN(thresholdNum) || thresholdNum <= 0 || thresholdNum > 1.0) {
      this.error('Threshold must be a decimal between 0.1 and 1.0 (e.g. 0.75 for 75%).');
    }

    const reader = new ProfileReader();
    const clusterEngine = new ClusterEngine();
    const parityEngine = new ParityEngine();

    const profiles = await reader.loadProfiles(flags.source);

    if (profiles.length < 2) {
      this.warn(
        `Clustering requires at least 2 profiles to identify commonalities. Found ${profiles.length} profile(s).`
      );
      if (profiles.length === 0) return;
    }

    this.log(pc.bold(pc.cyan(`\n🧩 Cross-Profile Clustering & Deduplication Engine`)));
    this.log(
      pc.dim(
        `Analyzing ${profiles.length} profiles with ${(thresholdNum * 100).toFixed(0)}% sharing threshold...\n`
      )
    );

    const result = await clusterEngine.clusterProfiles(profiles, {
      threshold: thresholdNum,
      baselineName: flags['base-name'],
      outputDir: flags['output-dir'],
      createGroups: !flags['no-groups'],
    });

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    // 1. Display Baseline
    this.log(
      pc.bold(pc.green(`✔ Shared Baseline Created: ${result.baselinePermissionSet.apiName}`))
    );
    this.log(
      `  • Objects: ${result.stats.baselineObjectsCount} | Fields: ${result.stats.baselineFieldsCount} | User Perms: ${result.stats.baselineUserPermsCount}\n`
    );

    // 2. Display Profile Deltas
    const table = new Table({
      head: [
        pc.bold('Profile Name'),
        pc.bold('Delta Perm Sets Created'),
        pc.bold('Assigned PSG'),
        pc.bold('Access Parity'),
      ],
      style: { head: [], border: [] },
    });

    for (const delta of result.profileDeltas) {
      const origProfile = profiles.find((p) => p.name === delta.profileName)!;
      const allPermSets = [
        result.baselinePermissionSet.metadata,
        ...delta.deltaPermissionSets.map((d) => d.metadata),
      ];

      const parity = parityEngine.verifyParity(
        origProfile,
        allPermSets,
        delta.permissionSetGroup?.apiName
      );

      const parityStatus = parity.is100PercentMatch
        ? pc.green('✔ 100% Parity')
        : pc.yellow(`${parity.parityScore}%`);

      table.push([
        pc.bold(delta.profileName),
        String(delta.deltaPermissionSets.length),
        delta.permissionSetGroup ? pc.magenta(delta.permissionSetGroup.apiName) : pc.dim('None'),
        parityStatus,
      ]);
    }

    this.log(table.toString());
    this.log(
      pc.bold(
        pc.green(
          `\n🎉 Successfully clustered ${result.totalProfilesAnalyzed} profiles into 1 baseline + ${result.stats.totalDeltasCreated} modular deltas!`
        )
      )
    );
    this.log(pc.dim(`All artifacts written to ${flags['output-dir']}\n`));
  }
}
