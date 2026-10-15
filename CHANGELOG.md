# Changelog

All notable changes to **PermForge** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-10-15

### Added

- **Cross-Environment Drift Guard (`permforge drift`)**:
  - Compares permissions between environments (e.g. Local Git Repo vs. Target Org, Sandbox vs. Production, or two Git branches).
  - Detects added, removed, and modified SObject CRUD, Field FLS, Apex classes, User Permissions, and Custom Permissions.
  - Automatically assesses severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `NONE`) and flags dangerous escalations (`ModifyAllData`, `ModifyAllRecords`).
  - **Auto-Reconciliation Generator**: Generates `<Profile>_Drift_Reconciliation.permissionset-meta.xml` to immediately synchronize drift.
  - Direct live org comparison via Metadata API (`--target-org`).
- **SOC 2, HIPAA & ISO 27001 Compliance Evidence Packages (`permforge compliance`)**:
  - **SOC 2 Type II (CC6.1/CC6.2/CC6.3)**: Audits administrative superuser permissions and flags **Segregation of Duties (SoD)** violations (e.g. `AuthorApex` + `ModifyAllData`).
  - **HIPAA Technical Safeguards (§ 164.312)**: Audits ePHI / PII data safeguards across patient, diagnosis, medical, and contact fields, and detects mass data exfiltration capabilities (`ExportReport`, `BulkApiHardDelete`).
  - **ISO 27001 (A.9.2)**: Flags password expiration policy violations (`PasswordNeverExpires`).
  - **1-Click Auditor Evidence Generator**: Exports standalone interactive HTML report (`compliance_audit_report.html`), complete CSV access matrix (`compliance_access_matrix.csv`), and executive Markdown summary (`compliance_summary.md`).
- **Automated GitHub Actions PR Bot (`permforge pr-bot` / `pr-review`)**:
  - Scans PR-modified profile metadata and performs automated security, parity, and drift analysis against base branches.
  - Posts or updates rich GitHub-flavored Markdown review comments with status badges, complexity metrics, callout alerts (`> [!CAUTION]`), and drift tables directly on pull requests.
  - Connects to GitHub REST API via `--post` with `GITHUB_TOKEN` and `GITHUB_REPOSITORY`.
- **Usage-Driven Least-Privilege Optimization (`permforge prune`)**:
  - Ingests and parses Salesforce Event Monitoring telemetry (CSV/JSON from `UriEvent`, `RestApiEvent`, `ApexExecution`, `ApiEvent`).
  - Computes activity footprint vs. granted permissions to calculate **Utilization Rate %** and **Over-Privilege Score %**.
  - Generates pruned least-privilege Permission Sets (`<Profile>_LeastPrivilege.permissionset-meta.xml`) and targeted Muting Permission Sets (`<Profile>_Mute_Dormant.mutingpermissionset-meta.xml`).
- **Automated User Reassignment & Rollback Engine (`permforge assign`)**:
  - Discovers profile users and plans live reassignment to generated Permission Set Groups or Permission Sets.
  - Simulates assignments with dry-run mode (`--dry-run`) displaying planned assignments and skipping active assignments.
  - Generates 1-click rollback manifest JSON files with instant rollback capability (`--rollback`).
- **Record Type Decoupling & Dynamic Forms Advisor (`permforge advise`)**:
  - Audits profiles for Salesforce 2026 Dynamic Forms readiness.
  - Decouples non-default visible Record Types into standalone Permission Sets while keeping default Record Types on Profiles as required by Salesforce.
- **19 Native Model Context Protocol (MCP) Tools**:
  - Added `permforge_least_privilege_audit`, `permforge_detect_drift`, `permforge_compliance_audit`, `permforge_pr_review`, `permforge_assign_users`, `permforge_rollback_assignment`, and `permforge_advise_modernization`.
- **Comprehensive Test Suite**:
  - Expanded to **75 automated unit and CLI integration tests across 23 test suites** with 100% pass rate.

---

## [1.3.0] - 2026-10-14

### Added

- **Direct Live Org Connectivity (`--target-org`)**: Connects directly to authenticated Salesforce orgs via `sf`/`sfdx` CLI auth cache or environment variables (`SF_ACCESS_TOKEN`, `SF_INSTANCE_URL`), chunks Metadata API calls (&le; 10) to comply with Salesforce API limits, and supports live deployment back to the org.
- **`permforge retrieve` CLI Command**: Discovers remote profiles via SOQL and downloads Metadata API XMLs directly into your local project workspace (`--list`, `--all-custom`, `-p/--profiles`).
- **In-Cloud Pipeline & Direct Deploy**: `permforge pipeline` and `permforge analyze` now support `--target-org <alias>` and `--deploy` for zero-friction cloud migrations.
- **Visual Studio Code Extension (`vscode-permforge`)**:
  - **Interactive Parity Matrix & Access Heatmap**: Color-coded side-by-side CRUDVM pill badges (`C`, `R`, `E`, `D`, `V`, `M`) and FLS field comparison with real-time search, filters, and mathematical parity proof.
  - **Live Org Cloud Migration Tab**: Select an authenticated org from the status bar or dropdown, inspect remote profiles, retrieve to workspace with 1 click, or decompose and deploy directly back to the live org.
  - **Enterprise Pipeline Runner**: Visual 6-stage stepper (Audit &rarr; Clustering &rarr; Decomposition &rarr; Parity Proof &rarr; UAP &rarr; Report) with live streaming console logs.
  - **Sidebar Profile Explorer**: Visual tree view of discovered profiles with complexity debt gauges (`🟢 Low`, `🟡 Med`, `🔴 High`), object counts, and high-risk grant alerts.
- **Official GitHub Action & CI/CD Gate Bot (`action.yml`)**:
  - Automatically runs on pull requests (`uses: visparashar/permforge@main`) to enforce Salesforce's 2026 Profile Permissions retirement policy.
  - **Permission Creep Detection**: Inspects git diffs and fails PRs that attempt to add new permissions to legacy profiles.
  - **100% Parity Gate**: Blocks PRs if mathematical access parity drifts below 100.0%.
  - **Rich Step Summary & PR Comments**: Posts interactive audit tables with complexity scores and high-risk security alerts directly onto GitHub PRs.
- **12 Native Model Context Protocol (MCP) Tools**: Added `permforge_list_org_profiles` and `permforge_retrieve_profiles` tools to Claude Desktop, Cursor, Antigravity, and Cline.
- **Universal Node Compatibility**: Locked `undici` to 6.x via npm overrides for full backwards compatibility across Node 18.x, 20.x, 22.x, and 24.x.
- **Expanded Test Suite**: 35 automated tests across 17 test suites with 100% pass rate.

---

## [1.2.0] - 2026-10-14

### Added

- **First-Class Model Context Protocol (MCP) Server**: Added native MCP server support via `@modelcontextprotocol/sdk` enabling autonomous AI agents (Claude Desktop, Cursor IDE, Antigravity, VS Code, Cline, Roo Code) to run PermForge tools directly.
- **`permforge mcp` CLI command**: Launches the MCP server over standard I/O (`stdio`).
- **9 Exposed MCP Tools**:
  - `permforge_analyze`: Profile audit, complexity scoring, and risk detector.
  - `permforge_decompose`: Monolithic profile decomposition into domain Permission Sets & PSGs.
  - `permforge_cluster`: Multi-profile clustering and baseline extraction.
  - `permforge_verify`: Mathematical parity diff engine.
  - `permforge_strip`: Deprecated permission sanitizer for profiles.
  - `permforge_lint`: Zero-profile-permissions standard compliance checker.
  - `permforge_uap`: Native User Access Policy generator.
  - `permforge_mute`: Muting Permission Set generator.
  - `permforge_graph`: Permission architecture hierarchy visualizer.
- Expanded test suite to 23 automated tests with 100% pass rate.

---

## [1.1.0] - 2026-10-14

### Added

- **`permforge strip` / `clean` command**: Sanitizes profiles by stripping deprecated permissions while safely preserving layout assignments, default record types, login hours, and credentials.
- **`permforge uap` command**: Generates native Salesforce User Access Policy (UAP) metadata (`.userAccessPolicy-meta.xml`) for zero-touch user provisioning.
- **`permforge mute` command**: Generates Muting Permission Sets (`.mutingpermissionset-meta.xml`) targeting Permission Set Groups to selectively restrict actions (e.g. Delete).
- **`permforge lint` command**: CI/CD pre-commit and Pull Request scanner with GitHub Actions annotations to enforce the zero-profile-permissions standard.
- **`permforge graph` command**: Interactive dependency graph generator (Mermaid diagram and ASCII tree) visualizing PSG -> Permission Sets -> SObjects.
- **`permforge cluster` command**: Cross-profile clustering engine extracting a shared `Standard_Employee_Baseline` across multiple profiles.
- **`permforge report` command**: Interactive self-contained HTML audit dashboard with security heatmaps and access parity matrix.
- **`permforge wizard` command**: Guided terminal wizard with interactive prompts for all migration workflows.
- Expanded test suite to 19 unit tests with 100% pass rate.

---

## [1.0.0] - 2026-10-14

### Added

- **`permforge analyze` command**: Scans local profile metadata, inventories all permissions (Objects, FLS, User Perms, Apex, Tabs, Record Types), scores complexity (0-100), and flags high-risk permissions (`ModifyAllData`, `AuthorApex`, etc.).
- **`permforge decompose` command**: Intelligently decomposes legacy profiles into domain-aligned Permission Sets and Persona-based Permission Set Groups.
- **Multiple Decomposition Strategies**:
  - `by-domain`: Automatically clusters related standard and custom objects into functional capability sets (e.g. `Account_Management`, `Sales_Opportunity`, `Service_Case`).
  - `by-object`: Generates atomic per-object permission sets.
  - `consolidated`: Converts a Profile into a single, clean modern Permission Set.
- **`permforge verify` command**: Mathematical diff engine verifying 100% security parity between source Profiles and target Permission Set Groups.
- **`permforge plan` command**: Generates user assignment CSV templates, step-by-step migration checklists, automated shell scripts, and rollback procedures.
- **Fast XML Engine**: Custom parser and serializer maintaining canonical Salesforce alphabetical sorting and XML schema compatibility.
- **Full Library API**: Exported TypeScript modules for programmatic use in CI/CD pipelines.
- **Automated Test Suite**: 10 unit tests with 100% pass rate using Vitest.
- **GitHub Actions CI**: Automated multi-node version testing (Node 18, 20, 22).
