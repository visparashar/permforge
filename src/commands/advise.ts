import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ModernizationAdvisor } from '../engine/modernization-advisor.js';

export default class Advise extends Command {
  static override description =
    'Audit profiles for Dynamic Forms readiness and decouple non-default Record Types into Permission Sets (Salesforce 2026 Advisor)';

  static override examples = [
    '<%= config.bin %> advise --source force-app/main/default/profiles/Sales_User.profile-meta.xml',
    '<%= config.bin %> advise --decouple-record-types --output-dir force-app/main/default',
    '<%= config.bin %> advise --decouple-record-types --separate-by-object',
    '<%= config.bin %> advise --json',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to a profile file, directory, or glob pattern',
      default: 'force-app/main/default/profiles',
    }),
    'decouple-record-types': Flags.boolean({
      description: 'Generate decoupled Permission Sets for non-default Record Types',
      default: false,
    }),
    'separate-by-object': Flags.boolean({
      description: 'Separate decoupled record types into per-object Permission Sets',
      default: false,
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for decoupled Permission Sets',
      default: 'force-app/main/default',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Advise);
    const reader = new ProfileReader();
    const advisor = new ModernizationAdvisor();

    const profiles = await reader.loadProfiles(flags.source);
    if (profiles.length === 0) {
      if (flags.json) {
        this.log(JSON.stringify({ error: `No profiles found at: ${flags.source}` }, null, 2));
      } else {
        this.error(pc.red(`No profile metadata found at path: ${flags.source}`));
      }
      return;
    }

    const advisories = profiles.map((p) =>
      advisor.analyzeDynamicFormsReadiness(p, {
        outputDir: flags['decouple-record-types'] ? flags['output-dir'] : undefined,
      })
    );

    if (flags.json) {
      this.log(JSON.stringify(advisories, null, 2));
      return;
    }

    this.log(pc.bold(pc.cyan('\n📋 PermForge Salesforce 2026 Modernization Advisor')));
    this.log(`Scanned ${pc.bold(String(profiles.length))} profile(s) for Dynamic Forms & Record Type decoupling.\n`);

    for (const adv of advisories) {
      this.log(pc.bold(pc.yellow(`═══════════════════════════════════════════════════════════`)));
      this.log(pc.bold(`Profile: ${pc.cyan(adv.profileName)}`));
      this.log(`Dynamic Forms Modernization Score: ${pc.bold(this.colorizeScore(adv.overallReadinessScore))}`);

      // 1. Record Type Decoupling Table
      const rtDecoupling = adv.decouplingSummary;
      if (rtDecoupling.totalRecordTypes > 0) {
        this.log(pc.bold('\n🏷️  Record Types Architecture:'));
        const rtTable = new Table({
          head: [pc.bold('Record Type'), pc.bold('Default on Profile?'), pc.bold('2026 Target Location')],
          colWidths: [30, 22, 35],
        });

        for (const rt of rtDecoupling.defaultsKeptOnProfile) {
          rtTable.push([rt.recordType, pc.green('Yes (Default)'), pc.white('Retain on Profile (Fallback Default)')]);
        }
        for (const rt of rtDecoupling.decoupledRecordTypes) {
          rtTable.push([rt.recordType, pc.dim('No'), pc.magenta('Decouple to Permission Set')]);
        }
        this.log(rtTable.toString());

        if (flags['decouple-record-types'] && rtDecoupling.generatedPermissionSets.length > 0) {
          this.log(pc.green(`  ✔ Generated ${rtDecoupling.generatedPermissionSets.length} decoupled Permission Set(s):`));
          for (const ps of rtDecoupling.generatedPermissionSets) {
            this.log(`    • ${pc.cyan(ps.apiName)} (${ps.fileName})`);
          }
        } else if (rtDecoupling.decoupledRecordTypes.length > 0) {
          this.log(pc.dim(`  Tip: Run with --decouple-record-types to generate decoupled Permission Sets.`));
        }
      }

      // 2. Dynamic Forms Object Readiness Table
      if (adv.analyzedObjects.length > 0) {
        this.log(pc.bold('\n⚡ Dynamic Forms Object Readiness:'));
        const objTable = new Table({
          head: [pc.bold('SObject'), pc.bold('Total Fields'), pc.bold('Read-Only (UI Rule)'), pc.bold('Readiness')],
          colWidths: [20, 16, 22, 22],
        });

        for (const obj of adv.analyzedObjects) {
          objTable.push([
            obj.objectName,
            String(obj.totalFields),
            String(obj.readOnlyFieldsCount),
            this.colorizeScore(obj.readinessScore) + ` (${obj.status})`,
          ]);
        }
        this.log(objTable.toString());
      }

      // 3. Key Recommendations
      if (adv.keyRecommendations.length > 0) {
        this.log(pc.bold('\n💡 Modernization Recommendations:'));
        for (const rec of adv.keyRecommendations) {
          this.log(`  • ${pc.white(rec)}`);
        }
      }
      this.log('');
    }
  }

  private colorizeScore(score: number): string {
    if (score >= 85) return pc.green(`${score}%`);
    if (score >= 65) return pc.yellow(`${score}%`);
    return pc.red(`${score}%`);
  }
}
