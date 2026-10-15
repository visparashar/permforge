import { Command, Flags } from '@oclif/core';
import Table from 'cli-table3';
import pc from 'picocolors';
import { ProfileReader } from '../parser/profile-reader.js';
import { ComplianceEngine, ComplianceFramework } from '../engine/compliance-engine.js';

export default class Compliance extends Command {
  static override description =
    'Audit profiles for SOC 2, HIPAA, and ISO 27001 compliance and generate auditable evidence packages (HTML/CSV/Markdown)';

  static override examples = [
    '<%= config.bin %> compliance --source force-app/main/default/profiles',
    '<%= config.bin %> compliance --framework soc2 --output-dir reports/soc2-audit',
    '<%= config.bin %> compliance --framework hipaa --fail-on-violation',
    '<%= config.bin %> compliance --json',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to profile file, directory, or glob pattern',
      default: 'force-app/main/default/profiles',
    }),
    framework: Flags.string({
      char: 'f',
      description: 'Compliance framework to audit against',
      options: ['soc2', 'hipaa', 'iso27001', 'all'],
      default: 'all',
    }),
    'output-dir': Flags.string({
      char: 'd',
      description: 'Destination directory for generated compliance package evidence files',
      default: 'reports/compliance',
    }),
    export: Flags.boolean({
      description: 'Generate full auditor evidence package (HTML, CSV matrix, Markdown)',
      default: true,
      allowNo: true,
    }),
    'fail-on-violation': Flags.boolean({
      description: 'Exit with non-zero exit code if non-compliant violations are discovered',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Compliance);

    const reader = new ProfileReader();
    const engine = new ComplianceEngine();

    const profiles = await reader.loadProfiles(flags.source);
    if (profiles.length === 0) {
      this.error(pc.red(`No profile metadata found at path: ${flags.source}`));
    }

    const report = engine.auditCompliance(profiles, {
      framework: flags.framework as ComplianceFramework,
      outputDir: flags['output-dir'],
      generateArtifacts: flags.export,
    });

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2));
      if (flags['fail-on-violation'] && report.overallStatus === 'NON_COMPLIANT') {
        this.exit(1);
      }
      return;
    }

    this.log(pc.bold(pc.cyan('\n🛡️  PermForge Security & Compliance Audit Package')));
    this.log(pc.bold(pc.yellow('═══════════════════════════════════════════════════════════')));
    this.log(`Frameworks:         ${pc.bold(report.frameworksAudited.join(', '))}`);
    this.log(`Profiles Audited:   ${pc.bold(String(report.totalProfilesAudited))}`);
    this.log(`Compliance Score:   ${pc.bold(this.colorizeScore(report.scorePercent))}`);
    this.log(`Overall Status:     ${this.colorizeStatus(report.overallStatus)}`);
    this.log(`Admin Superusers:   ${report.adminPrivileges.length > 0 ? pc.red(String(report.adminPrivileges.length)) : pc.green('0')}`);
    this.log(`SoD Violations:     ${report.sodViolations.length > 0 ? pc.red(String(report.sodViolations.length)) : pc.green('0')}\n`);

    // Controls Table
    this.log(pc.bold('📋 Regulatory Controls Scorecard:'));
    const controlsTable = new Table({
      head: [pc.bold('Control ID'), pc.bold('Framework'), pc.bold('Title'), pc.bold('Status'), pc.bold('Findings')],
      colWidths: [22, 12, 34, 16, 10],
      wordWrap: true,
    });

    for (const ctrl of report.controlResults) {
      controlsTable.push([
        ctrl.controlId,
        ctrl.framework,
        ctrl.title,
        this.colorizeStatus(ctrl.status),
        ctrl.findingsCount > 0 ? pc.red(String(ctrl.findingsCount)) : pc.green('0'),
      ]);
    }
    this.log(controlsTable.toString());

    // Superuser Table
    if (report.adminPrivileges.length > 0) {
      this.log(pc.bold('\n⚠️  High-Risk Administrative Superuser Grants:'));
      const adminTable = new Table({
        head: [pc.bold('Profile'), pc.bold('Permission'), pc.bold('Category'), pc.bold('Severity'), pc.bold('Mitigation Recommendation')],
        colWidths: [18, 20, 20, 12, 34],
        wordWrap: true,
      });

      for (const a of report.adminPrivileges.slice(0, 10)) {
        adminTable.push([
          a.profileName,
          pc.bold(a.permission),
          a.riskCategory,
          a.severity === 'CRITICAL' ? pc.bgRed(pc.white(' CRITICAL ')) : pc.red('HIGH'),
          a.mitigationRecommendation,
        ]);
      }
      this.log(adminTable.toString());
      if (report.adminPrivileges.length > 10) {
        this.log(pc.dim(`  ... and ${report.adminPrivileges.length - 10} more admin grant(s).`));
      }
    }

    // Exported artifacts info
    if (report.exportedFiles) {
      this.log(pc.bold(pc.green('\n✔ Generated Compliance Evidence Package:')));
      if (report.exportedFiles.htmlReportPath) {
        this.log(`  • HTML Auditor Report:  ${pc.cyan(report.exportedFiles.htmlReportPath)}`);
      }
      if (report.exportedFiles.csvMatrixPath) {
        this.log(`  • CSV Access Matrix:    ${pc.cyan(report.exportedFiles.csvMatrixPath)}`);
      }
      if (report.exportedFiles.markdownSummaryPath) {
        this.log(`  • Executive Summary:    ${pc.cyan(report.exportedFiles.markdownSummaryPath)}`);
      }
      this.log('');
    }

    if (flags['fail-on-violation'] && report.overallStatus === 'NON_COMPLIANT') {
      this.error(pc.red('❌ Compliance check failed: Critical non-compliant violations discovered.'));
    }
  }

  private colorizeScore(score: number): string {
    if (score >= 90) return pc.green(`${score}%`);
    if (score >= 70) return pc.yellow(`${score}%`);
    return pc.red(`${score}%`);
  }

  private colorizeStatus(status: string): string {
    switch (status) {
      case 'COMPLIANT':
        return pc.green('✔ COMPLIANT');
      case 'WARNING':
        return pc.yellow('⚠ WARNING');
      case 'NON_COMPLIANT':
        return pc.bgRed(pc.white(' NON-COMPLIANT '));
      default:
        return status;
    }
  }
}
