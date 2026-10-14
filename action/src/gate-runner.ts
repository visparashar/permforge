import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  ProfileReader,
  LoadedProfile,
  ProfileAnalyzer,
  ProfileAnalysis,
  ParityEngine,
  ParityReport,
  XmlEngine,
  ProfileLinter,
  LintViolation,
} from '../../src/index.js';

export interface GateOptions {
  profilesDir: string;
  outputDir: string;
  strictParity: boolean;
  blockProfilePermissions: boolean;
  maxComplexityScore: number;
  failOnRisk: boolean;
  postPrComment: boolean;
  githubToken?: string;
}

export interface PermissionCreepFinding {
  file: string;
  line: number;
  content: string;
  type: string;
}

export interface GateProfileAudit {
  name: string;
  filePath: string;
  analysis: ProfileAnalysis;
  parityReport?: ParityReport;
  lintViolations: LintViolation[];
  permissionCreep: PermissionCreepFinding[];
}

export interface GateRunResult {
  passed: boolean;
  totalProfilesScanned: number;
  totalPermissionCreep: number;
  totalHighRiskGrants: number;
  averageComplexityDebt: number;
  parityFailureCount: number;
  audits: GateProfileAudit[];
  summaryMarkdown: string;
}

export class PermForgeGateRunner {
  private reader = new ProfileReader();
  private analyzer = new ProfileAnalyzer();
  private parityEngine = new ParityEngine();
  private xmlEngine = new XmlEngine();
  private linter = new ProfileLinter();

  public async runGate(options: GateOptions): Promise<GateRunResult> {
    const cwd = process.cwd();
    const searchTarget = path.isAbsolute(options.profilesDir)
      ? options.profilesDir
      : path.join(cwd, options.profilesDir);

    let profiles: LoadedProfile[] = [];
    try {
      profiles = await this.reader.loadProfiles(searchTarget);
    } catch {
      // dir might not exist or empty
    }

    if (profiles.length === 0) {
      try {
        profiles = await this.reader.loadProfiles(cwd);
      } catch {
        // ignore
      }
    }

    // 1. Detect Permission Creep in Git Diff (PR context)
    const creepFindings = this.detectPermissionCreep(options.profilesDir);

    // 2. Audit each profile
    const audits: GateProfileAudit[] = [];
    let totalDebt = 0;
    let totalRisks = 0;
    let parityFailures = 0;
    let passed = true;

    for (const profile of profiles) {
      const analysis = this.analyzer.analyzeProfile(profile);
      totalDebt += analysis.complexityScore;
      totalRisks += analysis.highRiskPermissions.length;

      // Lint violations
      const lintReport = this.linter.lintProfiles([profile]);

      // Parity check against generated PSG if present
      let parityReport: ParityReport | undefined;
      const psgPath = path.join(
        options.outputDir,
        'permissionsetgroups',
        `${profile.name}_PSG.permissionsetgroup-meta.xml`
      );

      if (fs.existsSync(psgPath)) {
        try {
          const psgContent = fs.readFileSync(psgPath, 'utf-8');
          const psg = this.xmlEngine.parsePermissionSetGroup(psgContent);
          const psDir = path.join(options.outputDir, 'permissionsets');
          const permSets: any[] = [];
          for (const psName of psg.permissionSets) {
            const psFile = path.join(psDir, `${psName}.permissionset-meta.xml`);
            if (fs.existsSync(psFile)) {
              permSets.push(this.xmlEngine.parsePermissionSet(fs.readFileSync(psFile, 'utf-8')));
            }
          }
          if (permSets.length > 0) {
            parityReport = this.parityEngine.verifyParity(profile, permSets);
            if (!parityReport.is100PercentMatch) {
              parityFailures++;
              if (options.strictParity) {
                passed = false;
                core.error(
                  `Parity Gate Failure: Profile '${profile.name}' does not have 100% parity against target PSG (${parityReport.parityScore}% match). ${parityReport.mismatches.length} mismatches.`,
                  { file: profile.filePath }
                );
              }
            }
          }
        } catch {
          // ignore psg parse errors
        }
      }

      // Check complexity threshold
      if (analysis.complexityScore > options.maxComplexityScore) {
        core.warning(
          `Profile Complexity Warning: '${profile.name}' has a debt score of ${analysis.complexityScore}/100 (Threshold: ${options.maxComplexityScore}). Consider modularizing with 'permforge decompose'.`,
          { file: profile.filePath }
        );
      }

      // Check high risk grants
      if (options.failOnRisk && analysis.highRiskPermissions.length > 0) {
        passed = false;
        core.error(
          `High-Risk Grant Failure: Profile '${profile.name}' contains critical security permissions: ${analysis.highRiskPermissions.join(', ')}.`,
          { file: profile.filePath }
        );
      } else if (analysis.highRiskPermissions.length > 0) {
        core.warning(
          `Security Alert: Profile '${profile.name}' grants high-risk permissions: ${analysis.highRiskPermissions.join(', ')}.`,
          { file: profile.filePath }
        );
      }

      // Filter creep findings for this profile
      const profileCreep = creepFindings.filter(
        (c) => path.resolve(c.file) === path.resolve(profile.filePath)
      );

      audits.push({
        name: profile.name,
        filePath: profile.filePath,
        analysis,
        parityReport,
        lintViolations: lintReport.violations,
        permissionCreep: profileCreep,
      });
    }

    // Check permission creep gate
    if (options.blockProfilePermissions && creepFindings.length > 0) {
      passed = false;
      for (const finding of creepFindings) {
        core.error(
          `Salesforce 2026 Policy Violation: Permission creep detected in '${finding.file}'. New ${finding.type} must NOT be added to Profiles; create a Permission Set instead.`,
          { file: finding.file, startLine: finding.line }
        );
      }
    }

    const avgDebt = profiles.length > 0 ? Math.round(totalDebt / profiles.length) : 0;
    const totalCreep = creepFindings.length;

    // Generate Markdown Step Summary
    const summaryMarkdown = this.buildSummaryMarkdown(
      passed,
      profiles.length,
      avgDebt,
      totalRisks,
      totalCreep,
      parityFailures,
      audits,
      options
    );

    // Write to $GITHUB_STEP_SUMMARY
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown);
      } catch (err: any) {
        core.warning(`Could not write to GITHUB_STEP_SUMMARY: ${err.message}`);
      }
    }

    // Post or update PR comment if in pull request and token provided
    if (options.postPrComment && options.githubToken) {
      await this.postPullRequestComment(summaryMarkdown, options.githubToken);
    }

    return {
      passed,
      totalProfilesScanned: profiles.length,
      totalPermissionCreep: totalCreep,
      totalHighRiskGrants: totalRisks,
      averageComplexityDebt: avgDebt,
      parityFailureCount: parityFailures,
      audits,
      summaryMarkdown,
    };
  }

  /**
   * Inspect git diff for newly added permissions to profile metadata files in a PR.
   */
  public detectPermissionCreep(profilesDir: string): PermissionCreepFinding[] {
    const findings: PermissionCreepFinding[] = [];

    // Check if we are inside a git repository
    let isGit = false;
    try {
      execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
      isGit = true;
    } catch {
      return [];
    }

    if (!isGit) return [];

    let diffOutput = '';
    try {
      // Determine git diff target
      const baseRef = process.env.GITHUB_BASE_REF;
      if (baseRef) {
        // In GitHub Actions PR
        diffOutput = execSync(`git diff origin/${baseRef}...HEAD -U0 -- "${profilesDir}"`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } else {
        // Fallback: check uncommitted/HEAD~1 changes
        diffOutput = execSync(`git diff HEAD~1 -U0 -- "${profilesDir}"`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      }
    } catch {
      // If base ref not found or git command failed, try staged/unstaged diff
      try {
        diffOutput = execSync(`git diff -U0 -- "${profilesDir}"`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        return [];
      }
    }

    if (!diffOutput) return [];
    return this.parseDiffOutput(diffOutput);
  }

  /**
   * Parse git diff output for newly added permissions to profile metadata files.
   */
  public parseDiffOutput(diffOutput: string): PermissionCreepFinding[] {
    const findings: PermissionCreepFinding[] = [];
    const lines = diffOutput.split('\n');
    let currentFile = '';
    let currentLine = 1;

    for (const line of lines) {
      if (line.startsWith('+++ b/')) {
        currentFile = line.substring(6).trim();
      } else if (line.startsWith('@@ ')) {
        // Extract line number: @@ -1,1 +10,5 @@
        const match = line.match(/\+(\d+)/);
        if (match) {
          currentLine = parseInt(match[1], 10);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        const trimmed = line.substring(1).trim();

        if (
          trimmed.includes('<objectPermissions>') ||
          trimmed.includes('<allowCreate>true</allowCreate>') ||
          trimmed.includes('<allowEdit>true</allowEdit>') ||
          trimmed.includes('<allowDelete>true</allowDelete>') ||
          trimmed.includes('<modifyAllRecords>true</modifyAllRecords>')
        ) {
          findings.push({
            file: currentFile,
            line: currentLine,
            content: trimmed,
            type: 'Object Permissions (CRUD)',
          });
        } else if (
          trimmed.includes('<fieldPermissions>') ||
          trimmed.includes('<editable>true</editable>')
        ) {
          findings.push({
            file: currentFile,
            line: currentLine,
            content: trimmed,
            type: 'Field-Level Security (FLS)',
          });
        } else if (
          trimmed.includes('<userPermissions>') &&
          trimmed.includes('<enabled>true</enabled>')
        ) {
          findings.push({
            file: currentFile,
            line: currentLine,
            content: trimmed,
            type: 'System User Permission',
          });
        }
        currentLine++;
      }
    }

    return findings;
  }

  private buildSummaryMarkdown(
    passed: boolean,
    profilesCount: number,
    avgDebt: number,
    totalRisks: number,
    totalCreep: number,
    parityFailures: number,
    audits: GateProfileAudit[],
    options: GateOptions
  ): string {
    const statusBadge = passed
      ? '![Gate: Passed](https://img.shields.io/badge/PermForge%20Gate-PASSED-brightgreen.svg)'
      : '![Gate: Failed](https://img.shields.io/badge/PermForge%20Gate-FAILED-red.svg)';

    let md = `## 🛡️ PermForge Security & Parity Gate\n\n`;
    md += `${statusBadge} &nbsp;&nbsp; `;
    md += passed
      ? `**All Salesforce Profile migration & security policies satisfied.**\n\n`
      : `**Policy violations detected. Review the details below.**\n\n`;

    // Metrics strip
    md += `| Audited Profiles | Avg Tech Debt | High-Risk Grants | Permission Creep | Parity Failures |\n`;
    md += `|:---:|:---:|:---:|:---:|:---:|\n`;
    md += `| **${profilesCount}** | **${avgDebt}/100** | **${totalRisks}** | **${totalCreep}** | **${parityFailures}** |\n\n`;

    // Permission creep section
    if (totalCreep > 0) {
      md += `### 🚫 Salesforce 2026 Policy Violation: Permission Creep Detected\n\n`;
      md += `> [!CAUTION]\n`;
      md += `> Salesforce is officially deprecating permissions on legacy Profiles. New object, field, and user permissions **must be granted via Permission Sets and Permission Set Groups**, not Profiles.\n\n`;
      md += `| File | Line | Permission Type | Added Code |\n`;
      md += `|---|---|---|---|\n`;
      for (const audit of audits) {
        for (const creep of audit.permissionCreep) {
          md += `| \`${creep.file}\` | L${creep.line} | **${creep.type}** | \`${creep.content}\` |\n`;
        }
      }
      md += `\n`;
    }

    // Profiles audit table
    md += `### 📋 Profile Audit Breakdown\n\n`;
    md += `| Profile Name | Complexity Debt | Objects | FLS Fields | User Grants | High-Risk | Parity Status |\n`;
    md += `|---|:---:|:---:|:---:|:---:|:---:|:---:|\n`;

    for (const audit of audits) {
      const debtScore = audit.analysis.complexityScore;
      const debtPill =
        debtScore >= 70
          ? `🔴 ${debtScore}/100`
          : debtScore >= 40
            ? `🟡 ${debtScore}/100`
            : `🟢 ${debtScore}/100`;

      let parityCell = '*(No PSG)*';
      if (audit.parityReport) {
        parityCell = audit.parityReport.is100PercentMatch
          ? `🟢 100.0% Proof`
          : `🔴 ${audit.parityReport.parityScore}% Divergent`;
      }

      const riskCell =
        audit.analysis.highRiskPermissions.length > 0
          ? `⚠️ ${audit.analysis.highRiskPermissions.length}`
          : `0`;

      md += `| **${audit.name}** | ${debtPill} | ${audit.analysis.metrics.objectPermissionsCount} | ${audit.analysis.metrics.fieldPermissionsCount} | ${audit.analysis.metrics.userPermissionsCount} | ${riskCell} | ${parityCell} |\n`;
    }

    md += `\n---\n`;
    md += `*Generated automatically by [PermForge](https://visparashar.github.io/permforge) • Open-Source Salesforce Profile to Permission Set Migration Engine*\n`;

    return md;
  }

  private async postPullRequestComment(summaryMarkdown: string, token: string): Promise<void> {
    try {
      const context = github.context;
      if (!context.payload.pull_request) {
        return; // Not running in a pull request
      }

      const octokit = github.getOctokit(token);
      const prNumber = context.payload.pull_request.number;
      const owner = context.repo.owner;
      const repo = context.repo.repo;

      const commentMarker = '<!-- permforge-security-gate-marker -->';
      const commentBody = `${commentMarker}\n${summaryMarkdown}`;

      // Find existing comment
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
      });

      const existing = comments.find((c) => c.body?.includes(commentMarker));

      if (existing) {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existing.id,
          body: commentBody,
        });
        core.info(`Updated existing PermForge gate comment on PR #${prNumber}`);
      } else {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: commentBody,
        });
        core.info(`Created new PermForge gate comment on PR #${prNumber}`);
      }
    } catch (err: any) {
      core.warning(`Failed to post PR comment: ${err.message}`);
    }
  }
}
