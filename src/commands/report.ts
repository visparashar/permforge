import { Command, Flags } from '@oclif/core';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ProfileAnalyzer } from '../engine/analyzer.js';
import { HtmlReporter } from '../engine/html-reporter.js';

export default class Report extends Command {
  static override description =
    'Generate a visual, interactive HTML security and parity audit report';

  static override examples = [
    '<%= config.bin %> report',
    '<%= config.bin %> report --source force-app/main/default/profiles',
    '<%= config.bin %> report --output ./audit-reports/security-audit.html',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to profiles directory or glob pattern',
      default: 'force-app/main/default/profiles',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Destination path for generated HTML report',
      default: 'permforge-report.html',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Report);

    const reader = new ProfileReader();
    const analyzer = new ProfileAnalyzer();
    const reporter = new HtmlReporter();

    const profiles = await reader.loadProfiles(flags.source);

    if (profiles.length === 0) {
      this.error(`No profile metadata files found at: ${flags.source}`);
    }

    this.log(pc.bold(pc.cyan(`\n📊 Generating Visual HTML Audit Report...`)));

    const analyses = profiles.map((p) => analyzer.analyzeProfile(p));

    const reportPath = await reporter.generateReport(
      {
        analyses,
        generatedAt: new Date().toUTCString(),
      },
      flags.output
    );

    this.log(pc.bold(pc.green(`✔ HTML Report generated successfully!`)));
    this.log(`  • Location: ${pc.cyan(reportPath)}`);
    this.log(pc.dim(`  Open this file in any web browser to review the visual dashboard.\n`));
  }
}
