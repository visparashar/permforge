import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProfileAnalysis, ParityReport } from '../types/decomposition.js';

export interface ReportData {
  analyses: ProfileAnalysis[];
  parityReports?: ParityReport[];
  generatedAt: string;
}

export class HtmlReporter {
  /**
   * Generate a self-contained, interactive HTML security and parity report.
   */
  public async generateReport(data: ReportData, outputPath: string): Promise<string> {
    const resolvedPath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    const html = this.buildHtml(data);
    await fs.writeFile(resolvedPath, html, 'utf-8');
    return resolvedPath;
  }

  private buildHtml(data: ReportData): string {
    const totalProfiles = data.analyses.length;
    const avgComplexity = Math.round(
      data.analyses.reduce((acc, a) => acc + a.complexityScore, 0) / (totalProfiles || 1)
    );
    const totalHighRisk = data.analyses.reduce((acc, a) => acc + a.highRiskPermissions.length, 0);

    const profileRows = data.analyses
      .map((a) => {
        const riskBadges =
          a.highRiskPermissions.length > 0
            ? a.highRiskPermissions
                .map((r) => `<span class="badge badge-risk">${this.escapeHtml(r)}</span>`)
                .join(' ')
            : `<span class="badge badge-safe">None</span>`;

        const complexityColor =
          a.complexityScore > 60 ? 'risk' : a.complexityScore > 30 ? 'warning' : 'safe';

        const suggestedList = a.suggestedPermissionSets
          .map((s) => `<li><strong>${this.escapeHtml(s.name)}</strong> (${s.itemCount} perms)</li>`)
          .join('');

        return `
          <tr>
            <td class="bold">${this.escapeHtml(a.name)}</td>
            <td><span class="badge badge-outline">${a.custom ? 'Custom' : 'Standard'}</span></td>
            <td>${a.metrics.objectPermissionsCount}</td>
            <td>${a.metrics.fieldPermissionsCount}</td>
            <td>${a.metrics.userPermissionsCount}</td>
            <td>${a.metrics.classAccessesCount}</td>
            <td><span class="score-badge score-${complexityColor}">${a.complexityScore}/100</span></td>
            <td>${riskBadges}</td>
          </tr>
          <tr class="details-row">
            <td colspan="8">
              <div class="suggested-box">
                <span class="suggested-title">📦 Suggested Modular Permission Sets:</span>
                <ul>${suggestedList}</ul>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    const paritySection =
      data.parityReports && data.parityReports.length > 0
        ? `
        <div class="card">
          <h2>🛡️ Access Parity Verification</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Target PSG</th>
                <th>Score</th>
                <th>Status</th>
                <th>Objects Match</th>
                <th>FLS Match</th>
                <th>User Perms Match</th>
              </tr>
            </thead>
            <tbody>
              ${data.parityReports
                .map(
                  (p) => `
                <tr>
                  <td class="bold">${this.escapeHtml(p.profileName)}</td>
                  <td><code>${this.escapeHtml(p.targetGroupName || 'N/A')}</code></td>
                  <td><span class="score-badge score-${p.is100PercentMatch ? 'safe' : 'warning'}">${p.parityScore}%</span></td>
                  <td>${p.is100PercentMatch ? '<span class="badge badge-safe">✔ 100% PARITY</span>' : '<span class="badge badge-risk">MISMATCH</span>'}</td>
                  <td>${p.summary.objectsMatch ? '✔' : '✖'}</td>
                  <td>${p.summary.fieldsMatch ? '✔' : '✖'}</td>
                  <td>${p.summary.userPermissionsMatch ? '✔' : '✖'}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PermForge - Salesforce Profile Security & Parity Audit</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font);
      padding: 2rem;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    .header h1 {
      font-size: 1.875rem;
      font-weight: 700;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .header .timestamp {
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      text-align: center;
    }
    .stat-card .val {
      font-size: 2.25rem;
      font-weight: 800;
      color: var(--primary);
    }
    .stat-card .lbl {
      color: var(--text-muted);
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 0.25rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 2rem;
      overflow-x: auto;
    }
    .card h2 {
      font-size: 1.25rem;
      margin-bottom: 1rem;
      color: var(--text);
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    .data-table th, .data-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    .data-table th {
      background: rgba(15, 23, 42, 0.6);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.8125rem;
      text-transform: uppercase;
    }
    .bold { font-weight: 600; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-safe { background: rgba(34, 197, 94, 0.2); color: var(--success); }
    .badge-risk { background: rgba(239, 68, 68, 0.2); color: var(--danger); margin: 0.1rem; }
    .badge-outline { border: 1px solid var(--border); color: var(--text-muted); }
    .score-badge {
      display: inline-block;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 0.8125rem;
    }
    .score-safe { background: rgba(34, 197, 94, 0.2); color: var(--success); }
    .score-warning { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .score-risk { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .details-row td {
      background: rgba(15, 23, 42, 0.3);
      padding: 0.5rem 1rem 1rem 1rem;
    }
    .suggested-box {
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    .suggested-title {
      font-weight: 600;
      color: var(--primary);
      display: block;
      margin-bottom: 0.25rem;
    }
    .suggested-box ul {
      list-style-type: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.25rem;
    }
    .suggested-box li {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
    }
    footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.8125rem;
      margin-top: 3rem;
    }
    footer a { color: var(--primary); text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🛡️ PermForge Audit & Parity Report</h1>
      <p style="color: var(--text-muted); font-size: 0.875rem;">Salesforce Profile Permissions Retirement & Modularization Dashboard</p>
    </div>
    <div class="timestamp">Generated: ${data.generatedAt}</div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="val">${totalProfiles}</div>
      <div class="lbl">Profiles Analyzed</div>
    </div>
    <div class="stat-card">
      <div class="val">${avgComplexity}/100</div>
      <div class="lbl">Avg Complexity Score</div>
    </div>
    <div class="stat-card">
      <div class="val" style="color: ${totalHighRisk > 0 ? 'var(--danger)' : 'var(--success)'};">${totalHighRisk}</div>
      <div class="lbl">High-Risk Permissions</div>
    </div>
    <div class="stat-card">
      <div class="val" style="color: var(--success);">100%</div>
      <div class="lbl">Target Parity</div>
    </div>
  </div>

  <div class="card">
    <h2>📋 Profile Security & Complexity Inventory</h2>
    <table class="data-table">
      <thead>
        <tr>
          <th>Profile Name</th>
          <th>Type</th>
          <th>Objects</th>
          <th>Fields</th>
          <th>User Perms</th>
          <th>Apex Classes</th>
          <th>Complexity</th>
          <th>High-Risk Grants</th>
        </tr>
      </thead>
      <tbody>
        ${profileRows}
      </tbody>
    </table>
  </div>

  ${paritySection}

  <footer>
    <p>Powered by <a href="https://github.com/visparashar/permforge" target="_blank">PermForge</a> • Open Source Salesforce Profile to Permission Set Migration Engine</p>
  </footer>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
