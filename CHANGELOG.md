# Changelog

All notable changes to **PermForge** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
