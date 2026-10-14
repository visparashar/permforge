# 🛡️ PermForge for Visual Studio Code

**Visual Migration Studio for Salesforce Profiles to Modular Permission Sets & Permission Set Groups.**

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Extension-blue.svg)](https://marketplace.visualstudio.com)
[![Parity Proof](https://img.shields.io/badge/Parity-100%25%20Guaranteed-brightgreen.svg)](https://visparashar.github.io/permforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Overview

The **PermForge VS Code Extension** brings the complete power of the PermForge migration engine directly inside your Visual Studio Code editor. 

With Salesforce officially retiring permissions on legacy Profiles, PermForge provides a visual, interactive workflow to audit, cluster, decompose, and verify your metadata with **100% mathematical access parity guarantee**.

---

## 🚀 Key Features

### 1. 🗂️ Salesforce Profiles Sidebar Explorer
- Automatically scans your workspace for `.profile-meta.xml` and `.profile` files.
- Live badges showing **Technical Debt Complexity Score (0–100)** and risk levels (`🟢 Low`, `🟡 Med`, `🔴 High`).
- Expandable nodes displaying SObject counts, FLS grants, System User Permissions, and **High-Risk Permissions** (`AuthorApex`, `ModifyAllData`, etc.).

### 2. 🎛️ PermForge Migration Studio (Interactive Webview Panel)
- **Overview Dashboard**: High-level metrics on discovered profiles, average tech debt, and total permissions.
- **📊 Interactive Parity Matrix & Access Heatmap**: Color-coded side-by-side CRUDVM (Create, Read, Edit, Delete, View All, Modify All) and FLS matrix with instant search and filter controls.
- **☁️ Live Salesforce Org Migration**: Connect directly to your authorized org via `sf`/`sfdx` auth cache, list remote profiles, retrieve metadata to workspace, or deploy decomposed Permission Sets & PSGs directly to the cloud!
- **⚡ Enterprise Multi-Stage Pipeline**: 1-click execution coordinating Audit, Jaccard Clustering, Domain Decomposition, Parity Verification, UAP Generation, and HTML Audit Reporting with a live animated progress stepper.
- **Visual Decomposer**: Select any profile to preview its split into domain Permission Sets and persona PSGs, and click **Execute Modular Decomposition** to write XML files directly to your repo.
- **Cross-Profile Clustering**: Adjust the Jaccard similarity threshold slider to preview and generate a shared `Standard_Employee_Baseline` across multiple profiles.
- **Profile Sanitizer (Strip)**: Clean migratable permissions from profiles while keeping layout assignments, login IP ranges, and login hours 100% safe.

### 3. ⚡ File Explorer & Editor Context Menus
- Right-click any `.profile-meta.xml` or `.profile` file in the VS Code File Explorer:
  - **PermForge: Open Migration Studio**
  - **PermForge: View Parity Matrix & Access Heatmap**
  - **PermForge: Analyze Profile Complexity & Risks**
  - **PermForge: Decompose into Permission Sets & PSG**
  - **PermForge: Sanitize & Strip Permissions**

---

## 🛠️ Commands (Command Palette: `Ctrl+Shift+P` / `Cmd+Shift+P`)

| Command | Description |
|---|---|
| `PermForge: Open Migration Studio` | Opens the full visual webview studio. |
| `PermForge: View Parity Matrix & Access Heatmap` | Opens side-by-side CRUDVM & FLS parity matrix. |
| `PermForge: Retrieve Profiles from Salesforce Org` | Downloads profiles directly from live authorized org. |
| `PermForge: Run End-to-End Enterprise Migration Pipeline` | Executes complete multi-stage automated pipeline. |
| `PermForge: Refresh Profiles` | Re-scans workspace for profiles and permission sets. |
| `PermForge: Analyze Profile Complexity & Risks` | Audits selected profile and outputs security metrics. |
| `PermForge: Decompose into Permission Sets & PSG` | Slices profile into domain permission sets and PSG. |
| `PermForge: Verify Access Parity` | Mathematically audits 100% parity against target PSG. |
| `PermForge: Sanitize & Strip Profile Permissions` | Cleans profile in-place while keeping layouts and credentials. |
| `PermForge: Cluster & Deduplicate Profiles` | Analyzes all profiles to extract a shared baseline. |
| `PermForge: Generate Visual HTML Audit Report` | Creates an interactive HTML security report. |

---

## ⚙️ Configuration Settings

| Setting | Default | Description |
|---|---|---|
| `permforge.profilesDirectory` | `force-app/main/default/profiles` | Directory or glob pattern for profile metadata files. |
| `permforge.outputDirectory` | `force-app/main/default` | Destination directory for generated Permission Sets and PSGs. |
| `permforge.clusteringThreshold` | `0.75` | Sharing frequency threshold for baseline inclusion (0.1 to 1.0). |

---

## 📦 Packaging & Installation

To package as a `.vsix` extension for local installation or distribution:

```bash
# Package the extension
npx @vscode/vsce package --no-dependencies

# Install in VS Code
code --install-extension vscode-permforge-1.0.0.vsix
```

---

## 📄 License

Distributed under the **MIT License**. Created by [Vishal Parashar](https://github.com/visparashar).
Part of the open-source [PermForge](https://github.com/visparashar/permforge) platform.
