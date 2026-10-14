# 🛡️ PermForge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://img.shields.io/badge/Node.js-18%2B-blue.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Salesforce DX](https://img.shields.io/badge/Salesforce-DX-00A1E0.svg)](https://developer.salesforce.com/)

> **Intelligent Salesforce Profile to Permission Set & Permission Set Group migration engine with 100% access parity guarantee.**

---

## ⚡ The Problem: The Salesforce Profile Sunset

Salesforce has officially announced the retirement of permissions on Profiles (User Permissions, Object Permissions, Field-Level Security, Apex Class Access, Visualforce Access, and Custom Permissions). Moving forward, Profiles are restricted purely to authentication and session defaults (Login Hours, IP Ranges, Default Page Layouts).

### Why Traditional Migration Fails

1. **The 1:1 Monolithic Trap:** Naively converting a Profile into a single giant Permission Set copies all technical debt into a new folder.
2. **Untangling Spaghetti:** Manually splitting hundreds of objects, thousands of fields, and dozens of administrative permissions takes weeks of clicking in the Setup UI.
3. **Fear of Regressions:** A single missing Field-Level Security (FLS) or Object permission breaks mission-critical business processes or API integrations.

---

## 🚀 The Solution: PermForge

**PermForge** is an open-source CLI and Node.js library that:

- 🔍 **Audits Profiles:** Scans local SFDX metadata to inventory permissions, scores complexity, and flags high-risk capabilities (`ModifyAllData`, `AuthorApex`, etc.).
- 🔨 **Intelligently Decomposes:** Automatically refactors monolithic profiles into clean, modular, domain-aligned Permission Sets (e.g. `Account_Management`, `Sales_Opportunity`, `System_Permissions`, `Apex_Access`).
- 📦 **Generates Permission Set Groups (PSGs):** Bundles the modular Permission Sets into a Persona-based Permission Set Group that mirrors the original role.
- 🛡️ **Guarantees 100% Parity:** Includes a mathematical diff engine that verifies zero access loss before you deploy to production.
- 📋 **Rollout Automation:** Emits user assignment CSV templates, deployment guides, and automated shell scripts with instant rollback capability.

---

## 📦 Installation

### Global CLI

```bash
npm install -g permforge
```

### Run via `npx` (No installation needed)

```bash
npx permforge --help
```

### Install as Library

```bash
npm install permforge
```

---

## 🛠️ CLI Commands & Usage

### 1. `permforge analyze`

Scans your repository for profile metadata, inventories all permissions, flags high-risk access, and calculates a complexity score (0-100).

```bash
# Scan default SFDX profile directory
permforge analyze

# Scan specific directory or profile
permforge analyze --source force-app/main/default/profiles
permforge analyze --source path/to/Custom_Admin.profile-meta.xml

# Output as JSON for CI/CD pipelines
permforge analyze --json
```

**Example Output:**

```text
🔍 PermForge Profile Security & Complexity Analysis

┌──────────────┬────────┬─────────┬────────┬────────────┬──────────────┬───────────┬──────────────┐
│ Profile Name │ Type   │ Objects │ Fields │ User Perms │ Apex Classes │ High Risk │ Complexity   │
├──────────────┼────────┼─────────┼────────┼────────────┼──────────────┼───────────┼──────────────┤
│ Sales_User   │ Custom │ 3       │ 5      │ 3          │ 2            │ 0         │ 19/100 (Low) │
├──────────────┼────────┼─────────┼────────┼────────────┼──────────────┼───────────┼──────────────┤
│ Custom_Admin │ Custom │ 2       │ 0      │ 4          │ 0            │ 8         │ 56/100 (Med) │
└──────────────┴────────┴─────────┴────────┴────────────┴──────────────┴───────────┴──────────────┘

⚠️ High-Risk Permissions Detected:
  • Custom_Admin: ModifyAllData, ViewAllData, ManageUsers, AuthorApex, ModifyAllRecords:Account
```

---

### 2. `permforge decompose`

Decomposes a profile into modular Permission Sets and bundles them into a Persona-based Permission Set Group (`.permissionsetgroup-meta.xml`). Automatically runs a parity check upon completion.

```bash
# Decompose a single profile
permforge decompose --source force-app/main/default/profiles/Sales_User.profile-meta.xml

# Decompose all profiles into your project
permforge decompose --source force-app/main/default/profiles --output-dir force-app/main/default

# Choose a strategy: by-domain (default), by-object, or consolidated
permforge decompose --source path/to/Profile.profile-meta.xml --strategy by-domain
```

**What gets generated:**

- `permissionsets/<Profile>_<Domain>.permissionset-meta.xml`: Cohesive SObject CRUD + Field FLS + Tabs + Record Types.
- `permissionsets/<Profile>_System_Permissions.permissionset-meta.xml`: Administrative and user permissions.
- `permissionsets/<Profile>_Apex_Access.permissionset-meta.xml`: Apex classes and Visualforce pages.
- `permissionsets/<Profile>_Custom_Permissions.permissionset-meta.xml`: Custom permissions.
- `permissionsetgroups/<Profile>_PSG.permissionsetgroup-meta.xml`: Ready-to-assign Permission Set Group.

---

### 3. `permforge verify`

Mathematically compares the original Profile against the generated Permission Sets / PSG. Verifies whether any object, field, user, or class permissions were omitted or altered.

```bash
# Verify against a Permission Set Group
permforge verify \
  --profile force-app/main/default/profiles/Sales_User.profile-meta.xml \
  --group force-app/main/default/permissionsetgroups/Sales_User_PSG.permissionsetgroup-meta.xml

# Verify against a directory of permission sets
permforge verify \
  --profile force-app/main/default/profiles/Sales_User.profile-meta.xml \
  --permsets-dir force-app/main/default/permissionsets
```

**Example Output:**

```text
🛡️ Access Parity Report: Sales_User

┌────────────────────────────┬─────────┬────────────────────────────┐
│ Category                   │ Status  │ Coverage                   │
├────────────────────────────┼─────────┼────────────────────────────┤
│ Object CRUD & Admin        │ ✔ MATCH │                            │
├────────────────────────────┼─────────┼────────────────────────────┤
│ Field-Level Security (FLS) │ ✔ MATCH │                            │
├────────────────────────────┼─────────┼────────────────────────────┤
│ System User Permissions    │ ✔ MATCH │                            │
├────────────────────────────┼─────────┼────────────────────────────┤
│ Apex & VF Access           │ ✔ MATCH │                            │
├────────────────────────────┼─────────┼────────────────────────────┤
│ Overall Parity             │ 100.0%  │ 24/24 permissions verified │
└────────────────────────────┴─────────┴────────────────────────────┘

✔ PERFECT MATCH: All permissions from original profile are fully preserved.
```

---

### 4. `permforge plan`

Generates a complete, battle-tested migration package:

- Step-by-step rollout guide (`<Profile>_migration_plan.md`)
- User assignment CSV import template (`<Profile>_user_assignments.csv`)
- Automated CLI execution script (`migrate_<Profile>.sh`)
- Emergency rollback script (`rollback_<Profile>.sh`)

```bash
permforge plan \
  --profile Sales_User \
  --group Sales_User_PSG \
  --target-base "Minimum Access - Salesforce" \
  --output-dir migration-plans
```

---

### 5. `permforge cluster`

Analyzes multiple profiles simultaneously to extract a shared **`Standard_Employee_Baseline`** Permission Set for permissions common across your organization (e.g. granted by $\ge 75\%$ of profiles). Generates modular delta permission sets for role-specific access, adhering to Salesforce Well-Architected standards.

```bash
# Cluster all profiles in the project with default 75% threshold
permforge cluster

# Custom threshold (e.g. 60% of profiles) and custom baseline name
permforge cluster --source force-app/main/default/profiles --threshold 0.6 --base-name "Global_Core_Access"
```

---

### 6. `permforge report`

Generates a standalone, interactive HTML security dashboard with complexity meters, high-risk security alerts, and access parity matrices. Zero external dependencies—works completely offline.

```bash
# Generate report for local profiles
permforge report

# Custom output destination
permforge report --source force-app/main/default/profiles --output ./audit-reports/security-audit.html
```

---

### 7. `permforge wizard`

Interactive, guided terminal wizard that prompts you step-by-step through profile auditing, decomposition, clustering, and migration planning with intuitive arrow-key menus.

```bash
permforge wizard
```

---

### 8. `permforge strip` (or `clean`)

Sanitizes legacy profiles by removing all deprecated permissions (Object, Field FLS, User Perms, Apex classes) while preserving necessary layout assignments, default record types, and login settings.

```bash
# Strip permissions in-place with automatic .bak backup
permforge strip --source force-app/main/default/profiles --in-place

# Output sanitized profiles to a separate directory
permforge strip --source force-app/main/default/profiles --output-dir force-app/main/default/clean-profiles
```

---

### 9. `permforge uap`

Generates native Salesforce **User Access Policy (UAP)** metadata (`.userAccessPolicy-meta.xml`) to automate continuous, zero-touch user provisioning when users are created or updated.

```bash
# Auto-assign PSG when User.Department is Sales
permforge uap \
  --name Sales_User_Auto_Assign \
  --group Sales_User_PSG \
  --criteria "Department=Sales,UserType=Standard"
```

---

### 10. `permforge mute`

Generates a **Muting Permission Set** (`.mutingpermissionset-meta.xml`) targeting a Permission Set Group to selectively restrict sensitive actions (e.g. Delete) for junior or contractor roles without cloning permission set groups.

```bash
# Mute Delete on Account and Opportunity in a PSG
permforge mute --name Sales_Junior_Mute --mute-delete Account,Opportunity
```

---

### 11. `permforge lint`

CI/CD pre-commit and Pull Request scanner that verifies zero deprecated permissions remain in `.profile-meta.xml` files. Emits GitHub Actions annotations and fails builds on violations.

```bash
# Lint profiles in CI pipeline
permforge lint

# Enable GitHub Actions workflow annotations
permforge lint --github-actions
```

---

### 12. `permforge graph`

Visualizes your permission architecture hierarchy and dependencies (PSG -> Permission Sets -> SObjects) as an ASCII terminal tree or exportable Mermaid diagram.

```bash
# Print ASCII dependency tree to terminal
permforge graph

# Export Mermaid diagram for documentation
permforge graph --format markdown --output PERMISSION_GRAPH.md
```

---

## 💻 Programmatic API Usage

PermForge can be embedded directly in your custom TypeScript / JavaScript scripts, CI/CD pipelines, or GitHub Actions:

```typescript
import { ProfileReader, ProfileAnalyzer, ProfileDecomposer, ParityEngine } from 'permforge';

// 1. Read profile
const reader = new ProfileReader();
const profile = await reader.loadProfile(
  'force-app/main/default/profiles/Sales_User.profile-meta.xml'
);

// 2. Analyze
const analyzer = new ProfileAnalyzer();
const analysis = analyzer.analyzeProfile(profile);
console.log(`Complexity score: ${analysis.complexityScore}/100`);

// 3. Decompose
const decomposer = new ProfileDecomposer();
const result = await decomposer.decompose(profile, {
  outputDir: 'force-app/main/default',
  strategy: 'by-domain',
  createGroup: true,
});

// 4. Verify Parity
const parityEngine = new ParityEngine();
const parity = parityEngine.verifyParity(
  profile,
  result.permissionSets.map((ps) => ps.metadata)
);

console.log(`Parity match: ${parity.is100PercentMatch} (${parity.parityScore}%)`);
```

---

## 🧪 Testing

PermForge maintains a 100% passing test suite:

```bash
# Run unit tests with Vitest
npm test

# Run type check
npm run lint

# Clean and build
npm run build
```

---

## 🤝 Contributing

Contributions from the Salesforce community are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](file:///Users/vishalparashar/Documents/antigravity/friendly-bohr/LICENSE) for details.
