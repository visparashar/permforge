import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoadedProfile } from '../parser/profile-reader.js';
import { ProfileAnalyzer } from './analyzer.js';
import { ProfileLinter } from './profile-linter.js';
import { DriftEngine, ProfileDriftReport } from './drift-engine.js';

export interface PrReviewOptions {
  repo?: string;
  prNumber?: number;
  commitSha?: string;
  baseProfiles?: LoadedProfile[];
  outputFile?: string;
}

export interface PrReviewResult {
  hasCriticalRisks: boolean;
  totalViolations: number;
  impactedProfiles: string[];
  markdownComment: string;
  driftReports?: ProfileDriftReport[];
}

export class PrBotEngine {
  private analyzer: ProfileAnalyzer;
  private linter: ProfileLinter;
  private driftEngine: DriftEngine;

  constructor(analyzer?: ProfileAnalyzer, linter?: ProfileLinter, driftEngine?: DriftEngine) {
    this.analyzer = analyzer || new ProfileAnalyzer();
    this.linter = linter || new ProfileLinter();
    this.driftEngine = driftEngine || new DriftEngine();
  }

  /**
   * Analyze impacted profiles and build an automated GitHub PR review comment.
   */
  public generatePrReview(
    profiles: LoadedProfile[],
    options?: PrReviewOptions
  ): PrReviewResult {
    const lintReport = this.linter.lintProfiles(profiles);
    const analyses = profiles.map((p) => this.analyzer.analyzeProfile(p));

    let hasCriticalRisks = false;
    const criticalRisks: string[] = [];

    for (const a of analyses) {
      if (a.highRiskPermissions.length > 0) {
        hasCriticalRisks = true;
        for (const hr of a.highRiskPermissions) {
          criticalRisks.push(`**${a.name}**: \`${hr}\``);
        }
      }
    }

    // Optional drift comparison against base profiles
    const driftReports: ProfileDriftReport[] = [];
    if (options?.baseProfiles && options.baseProfiles.length > 0) {
      const baseMap = new Map(options.baseProfiles.map((p) => [p.name, p]));
      for (const target of profiles) {
        const base = baseMap.get(target.name);
        if (base) {
          const report = this.driftEngine.compareProfiles(base, target, {
            baseLabel: 'Base Branch',
            targetLabel: 'PR Branch',
          });
          if (report.hasDrift) {
            driftReports.push(report);
            if (report.overallSeverity === 'CRITICAL') {
              hasCriticalRisks = true;
            }
          }
        }
      }
    }

    // Build GitHub Markdown Comment
    const md = this.buildMarkdownComment({
      profiles,
      analyses,
      lintReport,
      driftReports,
      hasCriticalRisks,
      criticalRisks,
      options,
    });

    if (options?.outputFile) {
      fs.mkdirSync(path.dirname(path.resolve(options.outputFile)), { recursive: true });
      fs.writeFileSync(options.outputFile, md, 'utf-8');
    }

    return {
      hasCriticalRisks,
      totalViolations: lintReport.totalViolations,
      impactedProfiles: profiles.map((p) => p.name),
      markdownComment: md,
      driftReports,
    };
  }

  /**
   * Post or update PR comment via GitHub REST API.
   */
  public async postCommentToGitHub(
    token: string,
    repo: string,
    prNumber: number,
    commentBody: string
  ): Promise<{ id: number; html_url: string }> {
    const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'permforge-pr-bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: commentBody }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to post comment to GitHub (${response.status}): ${text}`);
    }

    return (await response.json()) as { id: number; html_url: string };
  }

  private buildMarkdownComment(data: {
    profiles: LoadedProfile[];
    analyses: any[];
    lintReport: any;
    driftReports: ProfileDriftReport[];
    hasCriticalRisks: boolean;
    criticalRisks: string[];
    options?: PrReviewOptions;
  }): string {
    const { profiles, analyses, lintReport, driftReports, hasCriticalRisks, criticalRisks } = data;

    const statusBadge = hasCriticalRisks
      ? '🔴 **SECURITY ALERT: Critical Privileges Detected**'
      : lintReport.totalViolations > 0
        ? '🟡 **WARNING: Linter Violations Found**'
        : '🟢 **PASSED: Permissions Clean & Aligned**';

    let content = `## 🛡️ PermForge Automated PR Security & Parity Review\n\n${statusBadge}\n\n`;

    content += `| Metric | Count |\n| :--- | :--- |\n`;
    content += `| **Impacted Profiles** | ${profiles.length} |\n`;
    content += `| **Security Violations** | ${lintReport.totalViolations} |\n`;
    content += `| **High-Risk Grants** | ${criticalRisks.length} |\n`;
    content += `| **Active Drift Items** | ${driftReports.reduce((acc, d) => acc + d.totalDrifts, 0)} |\n\n`;

    // Impacted Profiles Summary
    content += `### 📋 Impacted Profiles Overview\n\n`;
    content += `| Profile Name | Complexity | Objects | Fields | Apex Classes | High-Risk Grants |\n`;
    content += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    for (const a of analyses) {
      const hrText =
        a.highRiskPermissions.length > 0
          ? `⚠️ **${a.highRiskPermissions.length}** (${a.highRiskPermissions.join(', ')})`
          : `✅ 0`;
      content += `| \`${a.name}\` | **${a.complexityScore}/100** | ${a.metrics.objectPermissionsCount} | ${a.metrics.fieldPermissionsCount} | ${a.metrics.classAccessesCount} | ${hrText} |\n`;
    }
    content += `\n`;

    // Critical Security Alert
    if (criticalRisks.length > 0) {
      content += `> [!CAUTION]\n> **Critical Superuser Grants Detected**\n`;
      content += `> The following profiles grant administrative privileges that violate least-privilege standards:\n`;
      for (const r of criticalRisks) {
        content += `> - ${r}\n`;
      }
      content += `> *Recommendation:* Decouple these grants into Permission Sets or Muting Sets with \`permforge decompose\` or \`permforge prune\`.\n\n`;
    }

    // Drift Details if available
    if (driftReports.length > 0) {
      content += `### 🔍 Environment & Branch Drift Analysis\n\n`;
      for (const d of driftReports) {
        content += `#### Profile: \`${d.profileName}\` (${d.totalDrifts} drift item(s) - Severity: **${d.overallSeverity}**)\n\n`;
        content += `| Category | Item Name | Drift Type | Base Branch | PR Branch | Details |\n`;
        content += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
        for (const item of d.drifts.slice(0, 10)) {
          content += `| ${item.category} | \`${item.name}\` | **${item.type}** | ${item.baseState} | ${item.targetState} | ${item.details} |\n`;
        }
        if (d.drifts.length > 10) {
          content += `\n*... and ${d.drifts.length - 10} more drift items.*\n`;
        }
        content += `\n`;
      }
    }

    // Linter Findings
    if (lintReport.violations.length > 0) {
      content += `### ⚠️ Permission Architecture Linter Findings\n\n`;
      content += `| Type | Profile | Target Item | Message |\n`;
      content += `| :--- | :--- | :--- | :--- |\n`;
      for (const v of lintReport.violations.slice(0, 10)) {
        content += `| \`${v.type}\` | \`${v.profileName}\` | \`${v.identifier}\` | ${v.message} |\n`;
      }
      if (lintReport.violations.length > 10) {
        content += `\n*... and ${lintReport.violations.length - 10} more linter findings.*\n`;
      }
      content += `\n`;
    }

    content += `---\n*Automated review generated by [PermForge](https://github.com/visparashar/permforge) • Salesforce 2026 Ready* 🚀`;

    return content;
  }
}
