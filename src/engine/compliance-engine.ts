import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoadedProfile } from '../parser/profile-reader.js';

export type ComplianceFramework = 'soc2' | 'hipaa' | 'iso27001' | 'all';

export interface ComplianceControlResult {
  controlId: string;
  framework: 'SOC2' | 'HIPAA' | 'ISO27001';
  title: string;
  description: string;
  status: 'COMPLIANT' | 'WARNING' | 'NON_COMPLIANT';
  findingsCount: number;
  details: string[];
}

export interface AdminPrivilegeAuditItem {
  profileName: string;
  permission: string;
  riskCategory: 'SUPERUSER' | 'DATA_EXFILTRATION' | 'SCHEMA_MODIFICATION' | 'CODE_EXECUTION';
  severity: 'CRITICAL' | 'HIGH';
  mitigationRecommendation: string;
}

export interface PhiPiiAccessItem {
  profileName: string;
  objectOrField: string;
  accessGranted: string;
  dataType: 'ePHI' | 'PII';
  severity: 'HIGH' | 'MEDIUM';
}

export interface SodViolationItem {
  profileName: string;
  conflictingPermissions: [string, string];
  conflictRationale: string;
  severity: 'CRITICAL' | 'HIGH';
}

export interface ComplianceAuditReport {
  timestamp: string;
  frameworksAudited: string[];
  totalProfilesAudited: number;
  overallStatus: 'COMPLIANT' | 'WARNING' | 'NON_COMPLIANT';
  scorePercent: number;
  controlResults: ComplianceControlResult[];
  adminPrivileges: AdminPrivilegeAuditItem[];
  phiPiiAccesses: PhiPiiAccessItem[];
  sodViolations: SodViolationItem[];
  exportedFiles?: {
    htmlReportPath?: string;
    csvMatrixPath?: string;
    markdownSummaryPath?: string;
  };
}

export interface ComplianceEngineOptions {
  framework?: ComplianceFramework;
  outputDir?: string;
  generateArtifacts?: boolean;
}

const CRITICAL_ADMIN_PERMS: Record<
  string,
  { risk: 'SUPERUSER' | 'DATA_EXFILTRATION' | 'SCHEMA_MODIFICATION' | 'CODE_EXECUTION'; sev: 'CRITICAL' | 'HIGH'; note: string }
> = {
  ModifyAllData: { risk: 'SUPERUSER', sev: 'CRITICAL', note: 'Bypasses all sharing rules and access controls across entire org' },
  ViewAllData: { risk: 'SUPERUSER', sev: 'CRITICAL', note: 'Can view every single record regardless of ownership or sharing' },
  AuthorApex: { risk: 'CODE_EXECUTION', sev: 'CRITICAL', note: 'Can execute arbitrary Apex code and bypass security filters' },
  ManageUsers: { risk: 'SUPERUSER', sev: 'CRITICAL', note: 'Can reassign permissions, reset passwords, and escalate privilege' },
  CustomizeApplication: { risk: 'SCHEMA_MODIFICATION', sev: 'HIGH', note: 'Can alter metadata, page layouts, and business logic' },
  ModifyMetadata: { risk: 'SCHEMA_MODIFICATION', sev: 'HIGH', note: 'Can deploy and modify metadata via APIs' },
  ExportReport: { risk: 'DATA_EXFILTRATION', sev: 'HIGH', note: 'Enables bulk extraction of company and customer data' },
  BulkApiHardDelete: { risk: 'DATA_EXFILTRATION', sev: 'CRITICAL', note: 'Can permanently purge records bypassing the Recycle Bin' },
  PasswordNeverExpires: { risk: 'SUPERUSER', sev: 'HIGH', note: 'Violates credential rotation policies' },
};

const PHI_PII_PATTERNS = [
  'PATIENT',
  'HEALTH',
  'MEDICAL',
  'SSN',
  'SOCIAL_SECURITY',
  'BIRTHDATE',
  'DOB',
  'SALARY',
  'CREDITCARD',
  'DIAGNOSIS',
  'PRESCRIPTION',
  'INSURANCE',
  'CONTACT.EMAIL',
  'LEAD.EMAIL',
  'ACCOUNT.ANNUALREVENUE',
];

export class ComplianceEngine {
  /**
   * Run comprehensive compliance audit across loaded profiles.
   */
  public auditCompliance(
    profiles: LoadedProfile[],
    options?: ComplianceEngineOptions
  ): ComplianceAuditReport {
    const selectedFramework = options?.framework || 'all';
    const frameworks =
      selectedFramework === 'all'
        ? ['SOC2', 'HIPAA', 'ISO27001']
        : [selectedFramework.toUpperCase()];

    const adminPrivileges: AdminPrivilegeAuditItem[] = [];
    const phiPiiAccesses: PhiPiiAccessItem[] = [];
    const sodViolations: SodViolationItem[] = [];

    // 1. Audit Administrative Privileges & Segregation of Duties
    for (const p of profiles) {
      const activeUserPerms = (p.metadata.userPermissions || []).filter((u) => u.enabled).map((u) => u.name);
      const permSet = new Set(activeUserPerms);

      for (const perm of activeUserPerms) {
        if (CRITICAL_ADMIN_PERMS[perm]) {
          const info = CRITICAL_ADMIN_PERMS[perm];
          adminPrivileges.push({
            profileName: p.name,
            permission: perm,
            riskCategory: info.risk,
            severity: info.sev,
            mitigationRecommendation: `Extract '${perm}' from Profile into an activation-required Permission Set or PSG.`,
          });
        }
      }

      // Check ModifyAllRecords / ViewAllRecords on Objects
      for (const op of (p.metadata.objectPermissions || [])) {
        if (op.modifyAllRecords) {
          adminPrivileges.push({
            profileName: p.name,
            permission: `ModifyAllRecords:${op.object}`,
            riskCategory: 'SUPERUSER',
            severity: 'CRITICAL',
            mitigationRecommendation: `Remove ModifyAllRecords on '${op.object}' to enforce sharing rules.`,
          });
        }
      }

      // Check Segregation of Duties (SoD)
      if (permSet.has('AuthorApex') && permSet.has('ModifyAllData')) {
        sodViolations.push({
          profileName: p.name,
          conflictingPermissions: ['AuthorApex', 'ModifyAllData'],
          conflictRationale: 'Developer role (AuthorApex) combined with Global Data Admin (ModifyAllData) violates SoD.',
          severity: 'CRITICAL',
        });
      }
      if (permSet.has('ManageUsers') && permSet.has('ModifyAllData')) {
        sodViolations.push({
          profileName: p.name,
          conflictingPermissions: ['ManageUsers', 'ModifyAllData'],
          conflictRationale: 'User Access Admin combined with Business Data Admin creates unsupervised escalation risk.',
          severity: 'CRITICAL',
        });
      }

      // 2. Audit PHI / PII Access
      for (const fp of (p.metadata.fieldPermissions || [])) {
        if (!fp.readable && !fp.editable) continue;
        const upperField = fp.field.toUpperCase();
        const matchesPii = PHI_PII_PATTERNS.some((pattern) => upperField.includes(pattern));
        if (matchesPii) {
          const isHealth = upperField.includes('PATIENT') || upperField.includes('HEALTH') || upperField.includes('MEDICAL') || upperField.includes('DIAGNOSIS');
          phiPiiAccesses.push({
            profileName: p.name,
            objectOrField: fp.field,
            accessGranted: fp.editable ? 'Read/Write' : 'Read-Only',
            dataType: isHealth ? 'ePHI' : 'PII',
            severity: fp.editable ? 'HIGH' : 'MEDIUM',
          });
        }
      }
    }

    // 3. Evaluate Framework Controls
    const controlResults: ComplianceControlResult[] = [];

    // SOC 2 CC6.1 & CC6.2: Logical Access & Least Privilege
    const superusers = adminPrivileges.filter((a) => a.riskCategory === 'SUPERUSER');
    controlResults.push({
      controlId: 'SOC2-CC6.1',
      framework: 'SOC2',
      title: 'Logical Access Controls & Least Privilege Enforcement',
      description: 'Superuser access (ModifyAllData, ViewAllData, ManageUsers) must be restricted and isolated to authorized roles.',
      status: superusers.length === 0 ? 'COMPLIANT' : superusers.some((s) => s.severity === 'CRITICAL') ? 'NON_COMPLIANT' : 'WARNING',
      findingsCount: superusers.length,
      details: superusers.map((s) => `Profile '${s.profileName}' grants superuser permission '${s.permission}'.`),
    });

    // SOC 2 CC6.3: Segregation of Duties
    controlResults.push({
      controlId: 'SOC2-CC6.3',
      framework: 'SOC2',
      title: 'Segregation of Incompatible Administrative Duties',
      description: 'Prevent dangerous combinations of development, user administration, and production data modification.',
      status: sodViolations.length === 0 ? 'COMPLIANT' : 'NON_COMPLIANT',
      findingsCount: sodViolations.length,
      details: sodViolations.map((v) => `Profile '${v.profileName}' SoD Conflict: ${v.conflictingPermissions.join(' + ')} - ${v.conflictRationale}`),
    });

    // HIPAA 164.312(a)(1): Access Control & ePHI Isolation
    const ephiAccesses = phiPiiAccesses.filter((p) => p.dataType === 'ePHI');
    controlResults.push({
      controlId: 'HIPAA-164.312(a)(1)',
      framework: 'HIPAA',
      title: 'Technical Safeguards - Access Control for ePHI Data',
      description: 'Access to Electronic Protected Health Information (ePHI) must be granted only to authorized workforce members.',
      status: ephiAccesses.length === 0 ? 'COMPLIANT' : ephiAccesses.length > 5 ? 'NON_COMPLIANT' : 'WARNING',
      findingsCount: ephiAccesses.length,
      details: ephiAccesses.map((e) => `Profile '${e.profileName}' has ${e.accessGranted} access to ePHI '${e.objectOrField}'.`),
    });

    // HIPAA 164.312(b): Audit Controls & Data Exfiltration Prevention
    const exfilPerms = adminPrivileges.filter((a) => a.riskCategory === 'DATA_EXFILTRATION');
    controlResults.push({
      controlId: 'HIPAA-164.312(b)',
      framework: 'HIPAA',
      title: 'Technical Safeguards - Audit Controls & Exfiltration Guards',
      description: 'Mechanisms to examine and record activity and prevent mass unauthorized exfiltration of health data.',
      status: exfilPerms.length === 0 ? 'COMPLIANT' : 'WARNING',
      findingsCount: exfilPerms.length,
      details: exfilPerms.map((e) => `Profile '${e.profileName}' grants bulk export/delete capability '${e.permission}'.`),
    });

    // ISO 27001 A.9.2: User Access Management & Credential Policy
    const credRisks = adminPrivileges.filter((a) => a.permission === 'PasswordNeverExpires');
    controlResults.push({
      controlId: 'ISO27001-A.9.2',
      framework: 'ISO27001',
      title: 'User Access Provisioning and Credential Management',
      description: 'Enforce rigorous password expiration and credential rotation for all accounts.',
      status: credRisks.length === 0 ? 'COMPLIANT' : 'NON_COMPLIANT',
      findingsCount: credRisks.length,
      details: credRisks.map((c) => `Profile '${c.profileName}' sets PasswordNeverExpires=true.`),
    });

    // Calculate score
    const compliantCount = controlResults.filter((c) => c.status === 'COMPLIANT').length;
    const warningCount = controlResults.filter((c) => c.status === 'WARNING').length;
    const scorePercent = Math.round(((compliantCount + warningCount * 0.5) / controlResults.length) * 100);

    let overallStatus: 'COMPLIANT' | 'WARNING' | 'NON_COMPLIANT' = 'COMPLIANT';
    if (controlResults.some((c) => c.status === 'NON_COMPLIANT')) overallStatus = 'NON_COMPLIANT';
    else if (controlResults.some((c) => c.status === 'WARNING')) overallStatus = 'WARNING';

    const report: ComplianceAuditReport = {
      timestamp: new Date().toISOString(),
      frameworksAudited: frameworks,
      totalProfilesAudited: profiles.length,
      overallStatus,
      scorePercent,
      controlResults,
      adminPrivileges,
      phiPiiAccesses,
      sodViolations,
    };

    // 4. Generate Export Package Files if requested
    if (options?.generateArtifacts) {
      const outDir = options.outputDir || path.join(process.cwd(), 'reports/compliance');
      fs.mkdirSync(outDir, { recursive: true });

      const htmlPath = path.join(outDir, 'compliance_audit_report.html');
      fs.writeFileSync(htmlPath, this.generateHtmlReport(report), 'utf-8');

      const csvPath = path.join(outDir, 'compliance_access_matrix.csv');
      fs.writeFileSync(csvPath, this.generateCsvMatrix(report), 'utf-8');

      const mdPath = path.join(outDir, 'compliance_summary.md');
      fs.writeFileSync(mdPath, this.generateMarkdownSummary(report), 'utf-8');

      report.exportedFiles = {
        htmlReportPath: htmlPath,
        csvMatrixPath: csvPath,
        markdownSummaryPath: mdPath,
      };
    }

    return report;
  }

  private generateHtmlReport(report: ComplianceAuditReport): string {
    const statusColor =
      report.overallStatus === 'COMPLIANT' ? '#10b981' : report.overallStatus === 'WARNING' ? '#f59e0b' : '#ef4444';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PermForge Security & Compliance Audit Package</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 30px; margin: 0; }
    .container { max-width: 1100px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155; }
    h1 { margin-top: 0; color: #38bdf8; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-weight: bold; color: white; background: ${statusColor}; }
    .metrics { display: flex; gap: 20px; margin: 24px 0; }
    .card { flex: 1; background: #0f172a; padding: 18px; border-radius: 8px; border: 1px solid #334155; }
    .card-num { font-size: 28px; font-weight: bold; color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 28px; }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #334155; }
    th { background: #0f172a; color: #94a3b8; font-weight: 600; }
    .status-COMPLIANT { color: #10b981; font-weight: bold; }
    .status-WARNING { color: #f59e0b; font-weight: bold; }
    .status-NON_COMPLIANT { color: #ef4444; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🛡️ PermForge SOC 2 & HIPAA Compliance Audit Package</h1>
    <p>Generated: <strong>${report.timestamp}</strong> | Frameworks: <strong>${report.frameworksAudited.join(', ')}</strong></p>
    <div class="metrics">
      <div class="card"><div>Overall Status</div><div class="badge">${report.overallStatus}</div></div>
      <div class="card"><div>Compliance Score</div><div class="card-num">${report.scorePercent}%</div></div>
      <div class="card"><div>Profiles Audited</div><div class="card-num">${report.totalProfilesAudited}</div></div>
      <div class="card"><div>Admin Superusers</div><div class="card-num">${report.adminPrivileges.length}</div></div>
      <div class="card"><div>SoD Violations</div><div class="card-num">${report.sodViolations.length}</div></div>
    </div>

    <h2>Audit Controls Evaluation</h2>
    <table>
      <thead>
        <tr><th>Control ID</th><th>Framework</th><th>Title</th><th>Status</th><th>Findings</th></tr>
      </thead>
      <tbody>
        ${report.controlResults
          .map(
            (c) => `<tr>
          <td><strong>${c.controlId}</strong></td>
          <td>${c.framework}</td>
          <td>${c.title}</td>
          <td class="status-${c.status}">${c.status}</td>
          <td>${c.findingsCount}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>

    <h2>Administrative Superuser Privileges</h2>
    <table>
      <thead>
        <tr><th>Profile</th><th>Permission</th><th>Risk Category</th><th>Severity</th><th>Mitigation</th></tr>
      </thead>
      <tbody>
        ${
          report.adminPrivileges.length === 0
            ? '<tr><td colspan="5" style="text-align:center;color:#10b981;">No superuser permissions granted directly on profiles.</td></tr>'
            : report.adminPrivileges
                .map(
                  (a) => `<tr>
          <td><strong>${a.profileName}</strong></td>
          <td><code>${a.permission}</code></td>
          <td>${a.riskCategory}</td>
          <td class="${a.severity === 'CRITICAL' ? 'status-NON_COMPLIANT' : 'status-WARNING'}">${a.severity}</td>
          <td>${a.mitigationRecommendation}</td>
        </tr>`
                )
                .join('')
        }
      </tbody>
    </table>
  </div>
</body>
</html>`;
  }

  private generateCsvMatrix(report: ComplianceAuditReport): string {
    const headers = ['Profile', 'Category', 'Item_Name', 'Severity', 'Detail_or_Access'];
    const rows: string[] = [headers.join(',')];

    for (const a of report.adminPrivileges) {
      rows.push(`"${a.profileName}","Admin_Privilege","${a.permission}","${a.severity}","${a.riskCategory}"`);
    }
    for (const p of report.phiPiiAccesses) {
      rows.push(`"${p.profileName}","Data_Safeguard","${p.objectOrField}","${p.severity}","${p.dataType} (${p.accessGranted})"`);
    }
    for (const v of report.sodViolations) {
      rows.push(`"${v.profileName}","SoD_Conflict","${v.conflictingPermissions.join('+')}","${v.severity}","${v.conflictRationale}"`);
    }

    return rows.join('\n');
  }

  private generateMarkdownSummary(report: ComplianceAuditReport): string {
    return `# 🛡️ PermForge Security & Compliance Audit Report

- **Audit Date:** ${report.timestamp}
- **Frameworks:** ${report.frameworksAudited.join(', ')}
- **Overall Compliance Score:** **${report.scorePercent}%** (${report.overallStatus})
- **Profiles Audited:** ${report.totalProfilesAudited}
- **Administrative Superuser Grants:** ${report.adminPrivileges.length}
- **Segregation of Duties Conflicts:** ${report.sodViolations.length}

## Controls Summary
| Control | Framework | Title | Status | Findings |
| :--- | :--- | :--- | :--- | :--- |
${report.controlResults.map((c) => `| **${c.controlId}** | ${c.framework} | ${c.title} | **${c.status}** | ${c.findingsCount} |`).join('\n')}

## Recommended Remediation
1. **Strip Superuser Profile Grants:** Decouple \`ModifyAllData\` and \`ViewAllData\` into Permission Sets with session-based activation or Muting Sets.
2. **Resolve Segregation of Duties:** Ensure developer permissions (\`AuthorApex\`) and production data modification are not granted to the same personas.
`;
  }
}
