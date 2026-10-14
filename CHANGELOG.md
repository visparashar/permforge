# Changelog

All notable changes to **PermForge** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
