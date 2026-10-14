import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  ProfileReader,
  LoadedProfile,
  ProfileAnalyzer,
  ProfileAnalysis,
  ProfileDecomposer,
  ParityEngine,
  ParityReport,
  ClusterEngine,
  ProfileStripper,
  XmlEngine,
} from 'permforge';

export class MigrationStudioPanel {
  public static currentPanel: MigrationStudioPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private reader = new ProfileReader();
  private analyzer = new ProfileAnalyzer();
  private decomposer = new ProfileDecomposer();
  private parityEngine = new ParityEngine();
  private clusterEngine = new ClusterEngine();
  private stripper = new ProfileStripper();
  private xmlEngine = new XmlEngine();

  public static createOrShow(extensionUri: vscode.Uri, initialProfilePath?: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (MigrationStudioPanel.currentPanel) {
      MigrationStudioPanel.currentPanel._panel.reveal(column);
      if (initialProfilePath) {
        MigrationStudioPanel.currentPanel.selectProfile(initialProfilePath);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'permforgeStudio',
      'PermForge Migration Studio',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    MigrationStudioPanel.currentPanel = new MigrationStudioPanel(panel, extensionUri, initialProfilePath);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, initialProfilePath?: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'scanWorkspace':
            await this.handleScanWorkspace();
            return;
          case 'decomposeProfile':
            await this.handleDecomposeProfile(message.profilePath, message.outputDir);
            return;
          case 'verifyParity':
            await this.handleVerifyParity(message.profilePath, message.psgPath);
            return;
          case 'clusterProfiles':
            await this.handleClusterProfiles(message.threshold, message.baseName);
            return;
          case 'stripProfile':
            await this.handleStripProfile(message.profilePath, message.inPlace);
            return;
        }
      },
      null,
      this._disposables
    );

    // Initial scan after webview renders
    setTimeout(() => {
      this.handleScanWorkspace();
      if (initialProfilePath) {
        this.selectProfile(initialProfilePath);
      }
    }, 500);
  }

  public selectProfile(profilePath: string) {
    this._panel.webview.postMessage({
      type: 'setSelectedProfile',
      profilePath,
    });
  }

  private async handleScanWorkspace() {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      this._panel.webview.postMessage({ type: 'scanResults', profiles: [] });
      return;
    }

    const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('permforge');
    const customDir = config.get<string>('profilesDirectory', 'force-app/main/default/profiles');
    const searchTarget = path.isAbsolute(customDir) ? customDir : path.join(rootPath, customDir);

    let profiles = await this.reader.loadProfiles(searchTarget);
    if (profiles.length === 0) {
      profiles = await this.reader.loadProfiles(rootPath);
    }

    const results = profiles.map((p) => {
      const analysis = this.analyzer.analyzeProfile(p);
      return {
        name: p.name,
        filePath: p.filePath,
        complexityScore: analysis.complexityScore,
        objectCount: analysis.metrics.objectPermissionsCount,
        fieldCount: analysis.metrics.fieldPermissionsCount,
        userPermissionCount: analysis.metrics.userPermissionsCount,
        apexClassCount: analysis.metrics.classAccessesCount,
        highRiskFlags: analysis.highRiskPermissions,
      };
    });

    this._panel.webview.postMessage({
      type: 'scanResults',
      profiles: results,
      workspaceRoot: rootPath,
    });
  }

  private async handleDecomposeProfile(profilePath: string, customOutputDir?: string) {
    try {
      const rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
      const profile = await this.reader.loadProfile(profilePath);
      const outputDir = customOutputDir || path.join(rootPath, 'force-app/main/default');

      const result = await this.decomposer.decompose(profile, { outputDir });

      vscode.window.showInformationMessage(
        `✔ PermForge: Successfully decomposed ${profile.name} into ${result.permissionSets.length} Permission Sets and PSG!`
      );

      vscode.commands.executeCommand('permforge.refreshProfiles');

      this._panel.webview.postMessage({
        type: 'decomposeSuccess',
        profileName: profile.name,
        result: {
          psgName: result.permissionSetGroup?.apiName || `${profile.name}_PSG`,
          permSets: result.permissionSets.map((ps) => ps.apiName),
          objectsCount: profile.metadata.objectPermissions?.length || 0,
          fieldsCount: profile.metadata.fieldPermissions?.length || 0,
        },
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Decomposition failed: ${err.message}`);
    }
  }

  private async handleVerifyParity(profilePath: string, psgPath: string) {
    try {
      const profile = await this.reader.loadProfile(profilePath);
      const psgContent = await fs.readFile(psgPath, 'utf-8');
      const psg = this.xmlEngine.parsePermissionSetGroup(psgContent);

      const permSetsDir = path.join(path.dirname(psgPath), '..', 'permissionsets');

      // Load all permission sets
      const permSets: any[] = [];
      for (const psName of psg.permissionSets) {
        const psPath = path.join(permSetsDir, `${psName}.permissionset-meta.xml`);
        try {
          const content = await fs.readFile(psPath, 'utf-8');
          permSets.push(this.xmlEngine.parsePermissionSet(content));
        } catch {
          // file might not exist or alternate name
        }
      }

      const report = this.parityEngine.verifyParity(profile, permSets);

      this._panel.webview.postMessage({
        type: 'parityReport',
        profileName: profile.name,
        report,
      });

      if (report.is100PercentMatch) {
        vscode.window.showInformationMessage(`✔ 100% Mathematical Parity Proven for ${profile.name}!`);
      } else {
        vscode.window.showWarningMessage(`Parity mismatch detected for ${profile.name} (${report.parityScore}%)`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Parity check failed: ${err.message}`);
    }
  }

  private async handleClusterProfiles(thresholdStr: string, baseName: string) {
    try {
      const rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
      const threshold = parseFloat(thresholdStr) || 0.75;
      const outputDir = path.join(rootPath, 'force-app/main/default');

      let profiles = await this.reader.loadProfiles(path.join(rootPath, 'force-app/main/default/profiles'));
      if (profiles.length === 0) {
        profiles = await this.reader.loadProfiles(rootPath);
      }

      if (profiles.length < 2) {
        vscode.window.showWarningMessage('Clustering requires at least 2 profiles to compare.');
        return;
      }

      const clusterResult = await this.clusterEngine.clusterProfiles(profiles, {
        threshold,
        baselineName: baseName || 'Standard_Employee_Baseline',
        outputDir,
      });

      vscode.window.showInformationMessage(
        `✔ PermForge: Successfully clustered ${profiles.length} profiles into 1 baseline and ${clusterResult.profileDeltas.length} delta sets!`
      );

      vscode.commands.executeCommand('permforge.refreshProfiles');

      this._panel.webview.postMessage({
        type: 'clusterSuccess',
        baselineName: clusterResult.baselinePermissionSet.apiName,
        deltasCount: clusterResult.profileDeltas.length,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Clustering failed: ${err.message}`);
    }
  }

  private async handleStripProfile(profilePath: string, inPlace: boolean) {
    try {
      const rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
      const outputDir = inPlace ? path.dirname(profilePath) : path.join(rootPath, 'output/sanitized_profiles');

      const profile = await this.reader.loadProfile(profilePath);
      const result = await this.stripper.stripProfile(profile, {
        outputDir,
        inPlace,
      });

      vscode.window.showInformationMessage(
        `✔ PermForge: Profile sanitized! Stripped ${result.strippedStats.userPermissionsRemoved} perms, ${result.strippedStats.objectPermissionsRemoved} objects, and ${result.strippedStats.fieldPermissionsRemoved} fields.`
      );

      vscode.commands.executeCommand('permforge.refreshProfiles');

      this._panel.webview.postMessage({
        type: 'stripSuccess',
        result: {
          strippedUserPermissionsCount: result.strippedStats.userPermissionsRemoved,
          strippedObjectCount: result.strippedStats.objectPermissionsRemoved,
          strippedFieldCount: result.strippedStats.fieldPermissionsRemoved,
        },
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Sanitizing failed: ${err.message}`);
    }
  }

  public dispose() {
    MigrationStudioPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    this._panel.title = 'PermForge Migration Studio';
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PermForge Studio</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background);
      --border: var(--vscode-panel-border);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --accent-cyan: #38bdf8;
      --accent-green: #34d399;
      --accent-amber: #fbbf24;
      --accent-rose: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background-color: var(--bg);
      color: var(--fg);
      padding: 24px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .title-group h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .badge {
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent-cyan);
      border: 1px solid rgba(56, 189, 248, 0.3);
      font-weight: 600;
    }
    .tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      opacity: 0.7;
      padding: 8px 16px;
      font-size: 0.9rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab-btn:hover { opacity: 1; }
    .tab-btn.active {
      opacity: 1;
      font-weight: 600;
      color: var(--accent-cyan);
      border-bottom: 2px solid var(--accent-cyan);
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .metric-val {
      font-size: 1.8rem;
      font-weight: 800;
      color: var(--accent-cyan);
    }
    .metric-label {
      font-size: 0.8rem;
      opacity: 0.8;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: rgba(255, 255, 255, 0.04);
      font-weight: 600;
      font-size: 0.85rem;
    }
    .btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .btn:hover { background: var(--btn-hover); }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--fg);
    }
    .btn-danger {
      background: #dc2626;
      color: white;
    }
    .btn-danger:hover { background: #b91c1c; }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    select, input[type="text"], input[type="range"] {
      width: 100%;
      max-width: 480px;
      padding: 8px 12px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 4px;
      outline: none;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .badge-high { color: var(--accent-rose); font-weight: 700; }
    .badge-med { color: var(--accent-amber); font-weight: 700; }
    .badge-low { color: var(--accent-green); font-weight: 700; }
    .status-box {
      background: rgba(52, 211, 153, 0.1);
      border: 1px solid rgba(52, 211, 153, 0.3);
      border-radius: 6px;
      padding: 12px;
      margin-top: 14px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>🛡️ PermForge Migration Studio</h1>
      <span class="badge">Salesforce DX Native</span>
    </div>
    <div>
      <button class="btn btn-secondary" onclick="scanWorkspace()">↻ Scan Workspace</button>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('tab-dashboard')">Overview</button>
    <button class="tab-btn" onclick="switchTab('tab-decompose')">Decomposer</button>
    <button class="tab-btn" onclick="switchTab('tab-parity')">Parity Inspector</button>
    <button class="tab-btn" onclick="switchTab('tab-cluster')">Cross-Profile Clustering</button>
    <button class="tab-btn" onclick="switchTab('tab-strip')">Profile Sanitizer</button>
  </div>

  <!-- Tab 1: Overview -->
  <div class="tab-content active" id="tab-dashboard">
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-val" id="metricProfiles">0</div>
        <div class="metric-label">Discovered Profiles</div>
      </div>
      <div class="metric-card">
        <div class="metric-val" id="metricDebt">0%</div>
        <div class="metric-label">Average Debt Score</div>
      </div>
      <div class="metric-card">
        <div class="metric-val" id="metricRisks">0</div>
        <div class="metric-label">High-Risk Grants</div>
      </div>
      <div class="metric-card">
        <div class="metric-val" id="metricParity">100%</div>
        <div class="metric-label">Parity Guarantee</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom: 12px;">Profiles in Workspace</h3>
      <table>
        <thead>
          <tr>
            <th>Profile Name</th>
            <th>Objects</th>
            <th>FLS Fields</th>
            <th>User Perms</th>
            <th>High Risk</th>
            <th>Complexity</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="profilesTableBody">
          <tr><td colspan="7" style="text-align: center; opacity: 0.6;">Scanning workspace for profile files...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Tab 2: Decompose -->
  <div class="tab-content" id="tab-decompose">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Modularize Profile into Permission Sets & PSG</h3>
      <div class="form-group">
        <label>Select Target Profile:</label>
        <select id="decomposeSelect"></select>
      </div>
      <button class="btn" onclick="executeDecompose()">🔨 Execute Modular Decomposition</button>
      <div class="status-box" id="decomposeStatus"></div>
    </div>
  </div>

  <!-- Tab 3: Parity -->
  <div class="tab-content" id="tab-parity">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Verify 100% Mathematical Access Parity</h3>
      <div class="form-group">
        <label>Select Source Profile:</label>
        <select id="parityProfileSelect"></select>
      </div>
      <div class="form-group">
        <label>Select Target Permission Set Group (.permissionsetgroup-meta.xml):</label>
        <input type="text" id="parityPsgPath" placeholder="force-app/main/default/permissionsetgroups/Sales_PSG.permissionsetgroup-meta.xml">
      </div>
      <button class="btn" onclick="executeVerify()">🛡️ Verify Parity</button>
      <div class="status-box" id="parityStatus"></div>
    </div>
  </div>

  <!-- Tab 4: Cluster -->
  <div class="tab-content" id="tab-cluster">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Cross-Profile Deduplication & Baseline Extraction</h3>
      <p style="opacity: 0.8; margin-bottom: 16px; font-size: 0.9rem;">
        Extracts a shared <code>Standard_Employee_Baseline</code> across all profiles using Jaccard similarity algorithms.
      </p>
      <div class="form-group">
        <label>Sharing Threshold (<span id="thresholdVal">0.75</span>):</label>
        <input type="range" id="clusterThreshold" min="0.1" max="1.0" step="0.05" value="0.75" oninput="document.getElementById('thresholdVal').innerText = this.value">
      </div>
      <div class="form-group">
        <label>Baseline Permission Set API Name:</label>
        <input type="text" id="clusterBaseName" value="Standard_Employee_Baseline">
      </div>
      <button class="btn" onclick="executeCluster()">🧩 Generate Baseline & Deltas</button>
      <div class="status-box" id="clusterStatus"></div>
    </div>
  </div>

  <!-- Tab 5: Strip -->
  <div class="tab-content" id="tab-strip">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Sanitize & Strip Migrated Profile Permissions</h3>
      <p style="opacity: 0.8; margin-bottom: 16px; font-size: 0.9rem;">
        Strips migratable CRUD, FLS, and user permissions from the profile while safely preserving Page Layouts, Tab Visibilities, and Login IP ranges.
      </p>
      <div class="form-group">
        <label>Select Profile to Sanitize:</label>
        <select id="stripProfileSelect"></select>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" id="stripInPlace" checked> Overwrite file in-place
        </label>
      </div>
      <button class="btn btn-danger" onclick="executeStrip()">🧹 Sanitize Profile</button>
      <div class="status-box" id="stripStatus"></div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentProfiles = [];

    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    }

    function scanWorkspace() {
      vscode.postMessage({ command: 'scanWorkspace' });
    }

    function executeDecompose() {
      const path = document.getElementById('decomposeSelect').value;
      if (!path) return;
      vscode.postMessage({ command: 'decomposeProfile', profilePath: path });
    }

    function executeVerify() {
      const profPath = document.getElementById('parityProfileSelect').value;
      const psgPath = document.getElementById('parityPsgPath').value;
      if (!profPath || !psgPath) {
        alert('Please specify both profile and PSG path.');
        return;
      }
      vscode.postMessage({ command: 'verifyParity', profilePath: profPath, psgPath: psgPath });
    }

    function executeCluster() {
      const threshold = document.getElementById('clusterThreshold').value;
      const baseName = document.getElementById('clusterBaseName').value;
      vscode.postMessage({ command: 'clusterProfiles', threshold, baseName });
    }

    function executeStrip() {
      const profPath = document.getElementById('stripProfileSelect').value;
      const inPlace = document.getElementById('stripInPlace').checked;
      if (!profPath) return;
      if (confirm('Sanitize and strip permissions from this profile? Layouts and credentials will be preserved.')) {
        vscode.postMessage({ command: 'stripProfile', profilePath: profPath, inPlace });
      }
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'scanResults':
          renderProfiles(msg.profiles);
          break;
        case 'setSelectedProfile':
          setSelected(msg.profilePath);
          break;
        case 'decomposeSuccess':
          showStatus('decomposeStatus', '✔ Decomposed ' + msg.profileName + '! Created PSG: ' + msg.result.psgName + ' with ' + msg.result.permSets.length + ' permission sets.');
          break;
        case 'parityReport':
          showParityReport(msg.report);
          break;
        case 'clusterSuccess':
          showStatus('clusterStatus', '✔ Clustered profiles! Created baseline ' + msg.baselineName + ' and ' + msg.deltasCount + ' deltas.');
          break;
        case 'stripSuccess':
          showStatus('stripStatus', '✔ Sanitized profile! Stripped ' + msg.result.strippedUserPermissionsCount + ' perms, ' + msg.result.strippedObjectCount + ' objects.');
          break;
      }
    });

    function showStatus(elementId, html) {
      const el = document.getElementById(elementId);
      el.style.display = 'block';
      el.innerHTML = html;
    }

    function showParityReport(report) {
      const el = document.getElementById('parityStatus');
      el.style.display = 'block';
      if (report.is100PercentMatch) {
        el.innerHTML = '<span style="color: var(--accent-green); font-weight: 700;">✔ 100.0% PERFECT PARITY MATCH</span><br>All ' + report.totalOriginalPermissions + ' permissions are mathematically preserved with zero discrepancies.';
      } else {
        el.innerHTML = '<span style="color: var(--accent-rose); font-weight: 700;">✖ Parity Mismatch (' + report.parityScore + '%)</span><br>Mismatches: ' + report.mismatches.length + ' discrepancies found.';
      }
    }

    function setSelected(profilePath) {
      const selects = ['decomposeSelect', 'parityProfileSelect', 'stripProfileSelect'];
      selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = profilePath;
      });
    }

    function renderProfiles(profiles) {
      currentProfiles = profiles;
      document.getElementById('metricProfiles').innerText = profiles.length;

      let totalDebt = 0;
      let totalRisks = 0;

      const tbody = document.getElementById('profilesTableBody');
      const decomposeSelect = document.getElementById('decomposeSelect');
      const paritySelect = document.getElementById('parityProfileSelect');
      const stripSelect = document.getElementById('stripProfileSelect');

      decomposeSelect.innerHTML = '';
      paritySelect.innerHTML = '';
      stripSelect.innerHTML = '';

      if (profiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.6;">No profile files found in workspace.</td></tr>';
        return;
      }

      tbody.innerHTML = '';

      profiles.forEach(p => {
        totalDebt += p.complexityScore;
        totalRisks += p.highRiskFlags.length;

        // Populate options
        const opt = document.createElement('option');
        opt.value = p.filePath;
        opt.innerText = p.name + ' (' + p.complexityScore + '/100)';
        decomposeSelect.appendChild(opt.cloneNode(true));
        paritySelect.appendChild(opt.cloneNode(true));
        stripSelect.appendChild(opt.cloneNode(true));

        let badgeClass = 'badge-low';
        if (p.complexityScore >= 70) badgeClass = 'badge-high';
        else if (p.complexityScore >= 40) badgeClass = 'badge-med';

        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><strong>' + p.name + '</strong></td>' +
          '<td>' + p.objectCount + '</td>' +
          '<td>' + p.fieldCount + '</td>' +
          '<td>' + p.userPermissionCount + '</td>' +
          '<td>' + (p.highRiskFlags.length > 0 ? '<span class="badge-high">⚠️ ' + p.highRiskFlags.length + '</span>' : '0') + '</td>' +
          '<td><span class="' + badgeClass + '">' + p.complexityScore + '/100</span></td>' +
          '<td>' +
            '<button class="btn" style="margin-right: 6px;" onclick="goToDecompose(\\'' + p.filePath.replace(/\\\\/g, '\\\\\\\\') + '\\')">Decompose</button>' +
            '<button class="btn btn-secondary" onclick="goToStrip(\\'' + p.filePath.replace(/\\\\/g, '\\\\\\\\') + '\\')">Sanitize</button>' +
          '</td>';
        tbody.appendChild(tr);
      });

      const avgDebt = profiles.length > 0 ? Math.round(totalDebt / profiles.length) : 0;
      document.getElementById('metricDebt').innerText = avgDebt + '/100';
      document.getElementById('metricRisks').innerText = totalRisks;
    }

    function goToDecompose(path) {
      document.getElementById('decomposeSelect').value = path;
      document.querySelectorAll('.tab-btn')[1].click();
    }

    function goToStrip(path) {
      document.getElementById('stripProfileSelect').value = path;
      document.querySelectorAll('.tab-btn')[4].click();
    }

    // Auto scan on load
    scanWorkspace();
  </script>
</body>
</html>`;
  }
}
