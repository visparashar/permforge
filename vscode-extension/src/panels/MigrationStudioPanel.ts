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
  SalesforceOrgService,
  PipelineRunner,
  LeastPrivilegeEngine,
  DriftEngine,
  ComplianceEngine,
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
  private orgService = new SalesforceOrgService();
  private leastPrivilegeEngine = new LeastPrivilegeEngine();
  private driftEngine = new DriftEngine();
  private complianceEngine = new ComplianceEngine();

  public static createOrShow(extensionUri: vscode.Uri, initialProfilePath?: string, initialTab: string = 'tab-dashboard') {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (MigrationStudioPanel.currentPanel) {
      MigrationStudioPanel.currentPanel._panel.reveal(column);
      if (initialProfilePath) {
        MigrationStudioPanel.currentPanel.selectProfile(initialProfilePath);
      }
      if (initialTab) {
        MigrationStudioPanel.currentPanel.switchTab(initialTab);
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

    MigrationStudioPanel.currentPanel = new MigrationStudioPanel(panel, extensionUri, initialProfilePath, initialTab);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    initialProfilePath?: string,
    initialTab: string = 'tab-dashboard'
  ) {
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
          case 'getAuthorizedOrgs':
            await this.handleGetAuthorizedOrgs();
            return;
          case 'decomposeProfile':
            await this.handleDecomposeProfile(message.profilePath, message.outputDir);
            return;
          case 'verifyParity':
            await this.handleVerifyParity(message.profilePath, message.psgPath);
            return;
          case 'loadParityMatrix':
            await this.handleLoadParityMatrix(message.profilePath);
            return;
          case 'clusterProfiles':
            await this.handleClusterProfiles(message.threshold, message.baseName);
            return;
          case 'stripProfile':
            await this.handleStripProfile(message.profilePath, message.inPlace);
            return;
          case 'listOrgProfiles':
            await this.handleListOrgProfiles(message.targetOrg, message.customOnly);
            return;
          case 'retrieveFromOrg':
            await this.handleRetrieveFromOrg(message.targetOrg, message.profileNames);
            return;
          case 'deployToOrg':
            await this.handleDeployToOrg(message.targetOrg, message.profilePath);
            return;
          case 'runPipeline':
            await this.handleRunPipeline(message.options);
            return;
          case 'planUserAssignments':
            await this.handlePlanUserAssignments(message.targetOrg, message.profileName, message.targetName, message.activeOnly);
            return;
          case 'executeUserAssignments':
            await this.handleExecuteUserAssignments(message.targetOrg, message.plan);
            return;
          case 'rollbackUserAssignments':
            await this.handleRollbackUserAssignments(message.targetOrg, message.rollbackFile);
            return;
          case 'auditLeastPrivilege':
            await this.handleAuditLeastPrivilege(message.profilePath, message.eventsPath, message.mode);
            return;
          case 'detectDrift':
            await this.handleDetectDrift(message.basePath, message.targetPath, message.reconcile);
            return;
          case 'auditCompliance':
            await this.handleAuditCompliance(message.framework, message.exportArtifacts);
            return;
        }
      },
      null,
      this._disposables
    );

    // Initial load after webview renders
    setTimeout(async () => {
      await this.handleScanWorkspace();
      await this.handleGetAuthorizedOrgs();
      if (initialProfilePath) {
        this.selectProfile(initialProfilePath);
        if (initialTab === 'tab-matrix') {
          await this.handleLoadParityMatrix(initialProfilePath);
        }
      }
      if (initialTab && initialTab !== 'tab-dashboard') {
        this.switchTab(initialTab);
      }
    }, 600);
  }

  public selectProfile(profilePath: string) {
    this._panel.webview.postMessage({
      type: 'setSelectedProfile',
      profilePath,
    });
  }

  public switchTab(tabId: string) {
    this._panel.webview.postMessage({
      type: 'switchTab',
      tabId,
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

  private async handleGetAuthorizedOrgs() {
    try {
      const orgs = this.orgService.listAuthorizedOrgs();
      this._panel.webview.postMessage({
        type: 'authorizedOrgs',
        orgs,
      });
    } catch {
      this._panel.webview.postMessage({
        type: 'authorizedOrgs',
        orgs: [],
      });
    }
  }

  private async handleLoadParityMatrix(profilePath: string) {
    try {
      const profile = await this.reader.loadProfile(profilePath);
      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

      // Check if already decomposed into force-app/main/default/permissionsetgroups
      const defaultPsgPath = path.join(rootPath, 'force-app/main/default/permissionsetgroups', `${profile.name}_PSG.permissionsetgroup-meta.xml`);
      let permSets: any[] = [];

      try {
        const psgContent = await fs.readFile(defaultPsgPath, 'utf-8');
        const psg = this.xmlEngine.parsePermissionSetGroup(psgContent);
        const psDir = path.join(rootPath, 'force-app/main/default/permissionsets');
        for (const psName of psg.permissionSets) {
          const psPath = path.join(psDir, `${psName}.permissionset-meta.xml`);
          try {
            const content = await fs.readFile(psPath, 'utf-8');
            permSets.push(this.xmlEngine.parsePermissionSet(content));
          } catch {
            // skip missing
          }
        }
      } catch {
        // Not decomposed on disk yet - generate in-memory virtual decomposition for instant live preview!
        const virtualResult = await this.decomposer.decompose(profile, { outputDir: path.join(rootPath, 'force-app/main/default') });
        permSets = virtualResult.permissionSets.map((ps) => ps.metadata);
      }

      const report = this.parityEngine.verifyParity(profile, permSets);

      // Build interactive Objects matrix
      const permSetObjectsMap = new Map<string, { allowCreate: boolean; allowRead: boolean; allowEdit: boolean; allowDelete: boolean; viewAllRecords: boolean; modifyAllRecords: boolean }>();
      for (const ps of permSets) {
        for (const op of ps.objectPermissions || []) {
          const existing = permSetObjectsMap.get(op.object) || {
            allowCreate: false,
            allowRead: false,
            allowEdit: false,
            allowDelete: false,
            viewAllRecords: false,
            modifyAllRecords: false,
          };
          permSetObjectsMap.set(op.object, {
            allowCreate: existing.allowCreate || !!op.allowCreate,
            allowRead: existing.allowRead || !!op.allowRead,
            allowEdit: existing.allowEdit || !!op.allowEdit,
            allowDelete: existing.allowDelete || !!op.allowDelete,
            viewAllRecords: existing.viewAllRecords || !!op.viewAllRecords,
            modifyAllRecords: existing.modifyAllRecords || !!op.modifyAllRecords,
          });
        }
      }

      const objectMatrix = (profile.metadata.objectPermissions || []).map((op) => {
        const target = permSetObjectsMap.get(op.object) || {
          allowCreate: false,
          allowRead: false,
          allowEdit: false,
          allowDelete: false,
          viewAllRecords: false,
          modifyAllRecords: false,
        };

        const isMatch =
          !!op.allowCreate === target.allowCreate &&
          !!op.allowRead === target.allowRead &&
          !!op.allowEdit === target.allowEdit &&
          !!op.allowDelete === target.allowDelete &&
          !!op.viewAllRecords === target.viewAllRecords &&
          !!op.modifyAllRecords === target.modifyAllRecords;

        return {
          object: op.object,
          profile: {
            create: !!op.allowCreate,
            read: !!op.allowRead,
            edit: !!op.allowEdit,
            delete: !!op.allowDelete,
            viewAll: !!op.viewAllRecords,
            modifyAll: !!op.modifyAllRecords,
          },
          target,
          isMatch,
        };
      });

      // Build interactive FLS matrix
      const permSetFieldMap = new Map<string, { readable: boolean; editable: boolean }>();
      for (const ps of permSets) {
        for (const fp of ps.fieldPermissions || []) {
          const existing = permSetFieldMap.get(fp.field) || { readable: false, editable: false };
          permSetFieldMap.set(fp.field, {
            readable: existing.readable || !!fp.readable,
            editable: existing.editable || !!fp.editable,
          });
        }
      }

      const fieldMatrix = (profile.metadata.fieldPermissions || []).slice(0, 300).map((fp) => {
        const target = permSetFieldMap.get(fp.field) || { readable: false, editable: false };
        const isMatch = !!fp.readable === target.readable && !!fp.editable === target.editable;
        return {
          field: fp.field,
          profile: { readable: !!fp.readable, editable: !!fp.editable },
          target,
          isMatch,
        };
      });

      this._panel.webview.postMessage({
        type: 'parityMatrixData',
        profileName: profile.name,
        profilePath,
        parityScore: report.parityScore,
        is100PercentMatch: report.is100PercentMatch,
        totalOriginal: report.totalOriginalPermissions,
        totalTarget: report.totalTargetPermissions,
        objectMatrix,
        fieldMatrix,
        summary: report.summary,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Parity Matrix failed to load: ${err.message}`);
    }
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
      const permSets: any[] = [];
      for (const psName of psg.permissionSets) {
        const psPath = path.join(permSetsDir, `${psName}.permissionset-meta.xml`);
        try {
          const content = await fs.readFile(psPath, 'utf-8');
          permSets.push(this.xmlEngine.parsePermissionSet(content));
        } catch {
          // ignore
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

  private async handleListOrgProfiles(targetOrg?: string, customOnly: boolean = true) {
    try {
      const auth = this.orgService.resolveAuth(targetOrg);
      const profiles = await this.orgService.listProfiles({ customOnly }, auth);
      this._panel.webview.postMessage({
        type: 'orgProfilesList',
        profiles,
        targetOrg: targetOrg || auth.username,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to list profiles from org: ${err.message}`);
      this._panel.webview.postMessage({
        type: 'orgProfilesList',
        profiles: [],
        error: err.message,
      });
    }
  }

  private async handleRetrieveFromOrg(targetOrg: string, profileNames: string[]) {
    try {
      const auth = this.orgService.resolveAuth(targetOrg);
      const retrieved = await this.orgService.retrieveProfiles(profileNames, auth);

      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const config = vscode.workspace.getConfiguration('permforge');
      const targetDir = config.get<string>('profilesDirectory', 'force-app/main/default/profiles');
      const destDir = path.isAbsolute(targetDir) ? targetDir : path.join(rootPath, targetDir);

      await fs.mkdir(destDir, { recursive: true });
      for (const p of retrieved) {
        const xml = this.xmlEngine.buildProfileXml(p.metadata);
        await fs.writeFile(path.join(destDir, `${p.name}.profile-meta.xml`), xml, 'utf-8');
      }

      vscode.commands.executeCommand('permforge.refreshProfiles');
      await this.handleScanWorkspace();

      this._panel.webview.postMessage({
        type: 'retrieveSuccess',
        count: retrieved.length,
        profileNames,
      });
      vscode.window.showInformationMessage(`✔ Retrieved ${retrieved.length} profiles from ${targetOrg} into workspace!`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Retrieve failed: ${err.message}`);
    }
  }

  private async handleDeployToOrg(targetOrg: string, profilePath: string) {
    try {
      const auth = this.orgService.resolveAuth(targetOrg);
      const profile = await this.reader.loadProfile(profilePath);
      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const outputDir = path.join(rootPath, 'force-app/main/default');

      // 1. Decompose locally
      const result = await this.decomposer.decompose(profile, { outputDir });

      // 2. Deploy Permission Sets
      const psDeploy = await this.orgService.deployPermissionSets(result.permissionSets, auth);

      // 3. Deploy Permission Set Group
      let psgDeploy = { success: true, count: 0, items: [] as string[] };
      if (result.permissionSetGroup) {
        psgDeploy = await this.orgService.deployPermissionSetGroups([result.permissionSetGroup], auth);
      }

      this._panel.webview.postMessage({
        type: 'deploySuccess',
        profileName: profile.name,
        permSetsDeployed: psDeploy.count,
        psgDeployed: psgDeploy.count,
      });

      vscode.window.showInformationMessage(
        `✔ Successfully deployed ${psDeploy.count} Permission Sets and PSG to org ${targetOrg}!`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Deployment failed: ${err.message}`);
      this._panel.webview.postMessage({
        type: 'deployError',
        error: err.message,
      });
    }
  }

  private async handleRunPipeline(options: any) {
    try {
      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const runner = new PipelineRunner();

      this._panel.webview.postMessage({
        type: 'pipelineLog',
        message: `🚀 Launching Enterprise Pipeline for workspace...`,
      });

      const result = await runner.run({
        directory: path.join(rootPath, 'force-app/main/default/profiles'),
        outputDir: path.join(rootPath, 'force-app/main/default'),
        reportDir: path.join(rootPath, 'output'),
        cluster: !!options.cluster,
        strict: !!options.strict,
        dryRun: !!options.dryRun,
        deploy: !!options.deploy,
        targetOrg: options.targetOrg,
        profiles: options.profileName ? [options.profileName] : undefined,
      });

      this._panel.webview.postMessage({
        type: 'pipelineComplete',
        result,
      });

      vscode.commands.executeCommand('permforge.refreshProfiles');
      vscode.window.showInformationMessage(`✔ PermForge Enterprise Pipeline completed successfully!`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Pipeline failed: ${err.message}`);
      this._panel.webview.postMessage({
        type: 'pipelineError',
        error: err.message,
      });
    }
  }

  private async handlePlanUserAssignments(targetOrg: string, profileName: string, targetName: string, activeOnly: boolean) {
    try {
      const plan = await this.orgService.planUserAssignments(profileName, targetName, targetOrg, { activeOnly });
      this._panel.webview.postMessage({
        type: 'assignmentPlanResult',
        plan,
      });
    } catch (err: any) {
      this._panel.webview.postMessage({
        type: 'assignmentError',
        error: err.message,
      });
    }
  }

  private async handleExecuteUserAssignments(targetOrg: string, plan: any) {
    try {
      const result = await this.orgService.executeUserAssignments(plan, targetOrg);
      this._panel.webview.postMessage({
        type: 'assignmentExecuteResult',
        result,
      });
      if (result.success) {
        vscode.window.showInformationMessage(`✔ Successfully assigned ${result.assignedCount} user(s) to ${plan.target.name}!`);
      } else {
        vscode.window.showWarningMessage(`Assignment completed with warnings: ${result.assignedCount} assigned, ${result.failedCount} failed.`);
      }
    } catch (err: any) {
      this._panel.webview.postMessage({
        type: 'assignmentError',
        error: err.message,
      });
      vscode.window.showErrorMessage(`Assignment failed: ${err.message}`);
    }
  }

  private async handleRollbackUserAssignments(targetOrg: string, rollbackFile: string) {
    try {
      const result = await this.orgService.rollbackUserAssignments(rollbackFile, targetOrg);
      this._panel.webview.postMessage({
        type: 'assignmentRollbackResult',
        result,
      });
      if (result.success) {
        vscode.window.showInformationMessage(`✔ Rollback successful: Removed ${result.deletedCount} assignment(s)!`);
      } else {
        vscode.window.showWarningMessage(`Rollback finished with warnings: ${result.deletedCount} removed, ${result.failedCount} failed.`);
      }
    } catch (err: any) {
      this._panel.webview.postMessage({
        type: 'assignmentError',
        error: err.message,
      });
      vscode.window.showErrorMessage(`Rollback failed: ${err.message}`);
    }
  }

  private async handleAuditLeastPrivilege(profilePath: string, eventsPath?: string, mode: string = 'audit-only') {
    try {
      const profile = await this.reader.loadProfile(profilePath);
      let eventsContent = '';
      if (eventsPath && eventsPath.trim()) {
        try {
          eventsContent = await fs.readFile(eventsPath.trim(), 'utf-8');
        } catch (err: any) {
          vscode.window.showWarningMessage(`Could not read telemetry file (${err.message}). Proceeding with empty activity baseline.`);
        }
      }

      const footprint = this.leastPrivilegeEngine.parseEvents(eventsContent);
      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const outputDir = path.join(rootPath, 'force-app/main/default');

      const report = await this.leastPrivilegeEngine.auditProfile(profile, footprint, {
        mode: mode as any,
        outputDir,
      });

      if (mode === 'prune' || mode === 'mute') {
        vscode.commands.executeCommand('permforge.refreshProfiles');
      }

      this._panel.webview.postMessage({
        type: 'leastPrivilegeReport',
        profileName: profile.name,
        report,
      });

      vscode.window.showInformationMessage(
        `✔ Least-Privilege audit complete for ${profile.name}: ${report.utilizationRatePercent}% utilization (${report.dormantPermissionsCount} dormant permissions).`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Least-Privilege audit failed: ${err.message}`);
      this._panel.webview.postMessage({
        type: 'leastPrivilegeError',
        error: err.message,
      });
    }
  }

  private async handleDetectDrift(basePath: string, targetPath: string, reconcile: boolean = false) {
    try {
      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const reconciliationOutputDir = path.join(rootPath, 'force-app/main/default');

      const baseStat = await fs.stat(basePath);
      const targetStat = await fs.stat(targetPath);

      if (baseStat.isDirectory() && targetStat.isDirectory()) {
        const baseProfiles = await this.reader.loadProfiles(basePath);
        const targetProfiles = await this.reader.loadProfiles(targetPath);
        const report = this.driftEngine.compareProfileCollections(baseProfiles, targetProfiles, {
          generateReconciliation: reconcile,
          reconciliationOutputDir,
        });

        if (reconcile) {
          vscode.commands.executeCommand('permforge.refreshProfiles');
        }

        this._panel.webview.postMessage({
          type: 'driftReportMulti',
          report,
        });

        vscode.window.showInformationMessage(
          `✔ Drift Analysis complete: ${report.totalDriftsFound} drift(s) across ${report.profilesWithDrift} profile(s).`
        );
      } else {
        const baseProfile = await this.reader.loadProfile(basePath);
        const targetProfile = await this.reader.loadProfile(targetPath);
        const report = this.driftEngine.compareProfiles(baseProfile, targetProfile, {
          generateReconciliation: reconcile,
          reconciliationOutputDir,
        });

        if (reconcile && report.reconciliationPermissionSet) {
          vscode.commands.executeCommand('permforge.refreshProfiles');
        }

        this._panel.webview.postMessage({
          type: 'driftReportSingle',
          report,
        });

        vscode.window.showInformationMessage(
          `✔ Drift Analysis complete for ${baseProfile.name} vs ${targetProfile.name}: ${report.totalDrifts} drift(s) found (${report.overallSeverity} severity).`
        );
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Drift detection failed: ${err.message}`);
      this._panel.webview.postMessage({
        type: 'driftError',
        error: err.message,
      });
    }
  }

  private async handleAuditCompliance(framework: string = 'all', exportArtifacts: boolean = true) {
    try {
      const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const config = vscode.workspace.getConfiguration('permforge');
      const customDir = config.get<string>('profilesDirectory', 'force-app/main/default/profiles');
      const searchTarget = path.isAbsolute(customDir) ? customDir : path.join(rootPath, customDir);

      let profiles = await this.reader.loadProfiles(searchTarget);
      if (profiles.length === 0) {
        profiles = await this.reader.loadProfiles(rootPath);
      }

      if (profiles.length === 0) {
        vscode.window.showWarningMessage('No profiles found in workspace to audit for compliance.');
        return;
      }

      const outputDir = path.join(rootPath, 'output/compliance');
      const report = this.complianceEngine.auditCompliance(profiles, {
        framework: framework as any,
        outputDir,
        generateArtifacts: exportArtifacts,
      });

      this._panel.webview.postMessage({
        type: 'complianceReport',
        report,
      });

      vscode.window.showInformationMessage(
        `✔ Compliance Audit complete: ${report.overallStatus} (${report.scorePercent}% score across ${profiles.length} profiles).`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Compliance audit failed: ${err.message}`);
      this._panel.webview.postMessage({
        type: 'complianceError',
        error: err.message,
      });
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
      --border: var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --accent-cyan: #38bdf8;
      --accent-green: #34d399;
      --accent-amber: #fbbf24;
      --accent-rose: #f87171;
      --accent-purple: #c084fc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background-color: var(--bg);
      color: var(--fg);
      padding: 24px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
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
      letter-spacing: -0.02em;
    }
    .badge {
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent-cyan);
      border: 1px solid rgba(56, 189, 248, 0.3);
      font-weight: 600;
    }
    .tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      opacity: 0.7;
      padding: 9px 16px;
      font-size: 0.88rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .tab-btn:hover { opacity: 1; }
    .tab-btn.active {
      opacity: 1;
      font-weight: 600;
      color: var(--accent-cyan);
      border-bottom: 2px solid var(--accent-cyan);
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.2s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
      letter-spacing: -0.02em;
    }
    .metric-label {
      font-size: 0.8rem;
      opacity: 0.75;
      margin-top: 4px;
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
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 7px 14px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--btn-hover); }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--fg);
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.15); }
    .btn-success {
      background: #059669;
      color: white;
    }
    .btn-success:hover { background: #047857; }
    .btn-danger {
      background: #dc2626;
      color: white;
    }
    .btn-danger:hover { background: #b91c1c; }
    .form-group {
      margin-bottom: 18px;
    }
    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    select, input[type="text"], input[type="range"] {
      width: 100%;
      max-width: 500px;
      padding: 8px 12px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 5px;
      outline: none;
      font-family: inherit;
      font-size: 0.88rem;
    }
    select:focus, input[type="text"]:focus {
      border-color: var(--accent-cyan);
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
      padding: 14px;
      margin-top: 14px;
      display: none;
    }
    .console-box {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 14px;
      font-family: 'JetBrains Mono', 'Menlo', 'Courier New', monospace;
      font-size: 0.82rem;
      max-height: 280px;
      overflow-y: auto;
      white-space: pre-wrap;
      color: #94a3b8;
      margin-top: 16px;
    }
    
    /* Heatmap / Parity Pill Badges */
    .pill {
      display: inline-block;
      width: 22px;
      height: 22px;
      line-height: 22px;
      text-align: center;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 700;
      margin-right: 4px;
    }
    .pill-c { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }
    .pill-r { background: rgba(52, 211, 153, 0.2); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.4); }
    .pill-e { background: rgba(192, 132, 252, 0.2); color: #c084fc; border: 1px solid rgba(192, 132, 252, 0.4); }
    .pill-d { background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.4); }
    .pill-v { background: rgba(45, 212, 191, 0.2); color: #2dd4bf; border: 1px solid rgba(45, 212, 191, 0.4); }
    .pill-m { background: rgba(244, 63, 94, 0.2); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.4); }
    .pill-off { background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.25); border: 1px solid rgba(255, 255, 255, 0.1); }
    
    .match-ok { color: var(--accent-green); font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
    .match-fail { color: var(--accent-rose); font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }

    /* Stepper */
    .stepper {
      display: flex;
      justify-content: space-between;
      margin: 20px 0;
      position: relative;
    }
    .step-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
      z-index: 1;
      width: 16%;
    }
    .step-circle {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--card-bg);
      border: 2px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.85rem;
      color: var(--fg);
      margin-bottom: 6px;
    }
    .step-circle.active {
      border-color: var(--accent-cyan);
      background: rgba(56, 189, 248, 0.2);
      color: var(--accent-cyan);
    }
    .step-circle.done {
      border-color: var(--accent-green);
      background: var(--accent-green);
      color: #000;
    }
    .step-title {
      font-size: 0.72rem;
      text-align: center;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>🛡️ PermForge Migration Studio</h1>
      <span class="badge">Salesforce DX Native</span>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn btn-secondary" onclick="scanWorkspace()">↻ Scan Workspace</button>
      <button class="btn btn-success" onclick="switchTab('tab-pipeline')">🚀 Run Pipeline</button>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" id="tabBtn-dashboard" onclick="switchTab('tab-dashboard')">Overview</button>
    <button class="tab-btn" id="tabBtn-matrix" onclick="switchTab('tab-matrix')">📊 Parity Matrix &amp; Heatmap</button>
    <button class="tab-btn" id="tabBtn-decompose" onclick="switchTab('tab-decompose')">🔨 Decomposer</button>
    <button class="tab-btn" id="tabBtn-cloud" onclick="switchTab('tab-cloud')">☁️ Live Org Migration</button>
    <button class="tab-btn" id="tabBtn-cluster" onclick="switchTab('tab-cluster')">🧩 Cross-Profile Clustering</button>
    <button class="tab-btn" id="tabBtn-pipeline" onclick="switchTab('tab-pipeline')">⚡ Enterprise Pipeline</button>
    <button class="tab-btn" id="tabBtn-strip" onclick="switchTab('tab-strip')">🧹 Profile Sanitizer</button>
    <button class="tab-btn" id="tabBtn-prune" onclick="switchTab('tab-prune')">🎯 Least-Privilege &amp; Pruner</button>
    <button class="tab-btn" id="tabBtn-drift" onclick="switchTab('tab-drift')">🔍 Cross-Org Drift Guard</button>
    <button class="tab-btn" id="tabBtn-compliance" onclick="switchTab('tab-compliance')">📋 Compliance &amp; Audit</button>
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
        <div class="metric-val" style="color: var(--accent-green);" id="metricParity">100%</div>
        <div class="metric-label">Mathematical Parity Guarantee</div>
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

  <!-- Tab 2: Interactive Parity Matrix & Heatmap -->
  <div class="tab-content" id="tab-matrix">
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h3 style="margin-bottom: 4px;">Bit-for-Bit Mathematical Parity Matrix</h3>
          <p style="opacity: 0.8; font-size: 0.88rem;">Inspect side-by-side CRUDVM and FLS access between original Profile and decomposed Permission Sets.</p>
        </div>
        <div style="display: flex; gap: 8px;">
          <select id="matrixProfileSelect" style="max-width: 280px;" onchange="loadMatrixForSelected()"></select>
          <button class="btn btn-secondary" onclick="loadMatrixForSelected()">↻ Refresh Matrix</button>
        </div>
      </div>

      <div class="metrics-grid" style="margin-bottom: 20px;">
        <div class="metric-card">
          <div class="metric-val" id="matrixScore" style="color: var(--accent-green);">100%</div>
          <div class="metric-label">Verified Parity Score</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="matrixObjCount">0</div>
          <div class="metric-label">SObjects Audited</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="matrixFlsCount">0</div>
          <div class="metric-label">FLS Fields Audited</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="matrixDiscrepancies" style="color: var(--accent-green);">0</div>
          <div class="metric-label">Access Discrepancies</div>
        </div>
      </div>

      <!-- Filters -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; flex-wrap: wrap;">
        <input type="text" id="matrixSearch" placeholder="Filter by Object or Field name (e.g. Account, Contact)..." oninput="filterMatrixTable()" style="max-width: 360px;">
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary" id="btnFilterAll" onclick="setMatrixFilter('all')">All Grants</button>
          <button class="btn btn-secondary" id="btnFilterObjects" onclick="setMatrixFilter('objects')">SObjects (CRUDVM)</button>
          <button class="btn btn-secondary" id="btnFilterFLS" onclick="setMatrixFilter('fls')">FLS Fields</button>
          <button class="btn btn-secondary" id="btnFilterMismatches" onclick="setMatrixFilter('mismatches')">Mismatches Only</button>
        </div>
      </div>

      <!-- Matrix Table -->
      <table>
        <thead>
          <tr>
            <th>Permission Subject</th>
            <th>Type</th>
            <th>Profile Access</th>
            <th>Decomposed Access</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="matrixTableBody">
          <tr><td colspan="5" style="text-align: center; opacity: 0.6;">Select a profile to load its Parity Matrix.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Tab 3: Decompose -->
  <div class="tab-content" id="tab-decompose">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Modularize Profile into Domain Permission Sets &amp; PSG</h3>
      <div class="form-group">
        <label>Select Target Profile:</label>
        <select id="decomposeSelect"></select>
      </div>
      <div class="form-group">
        <label>Decomposition Strategy:</label>
        <select id="decomposeStrategy">
          <option value="by-domain" selected>Domain-Driven Decomposition (Recommended - Clean Separation of Concerns)</option>
          <option value="by-object">Object-Centric Modularization (One Permission Set per SObject)</option>
          <option value="consolidated">Single Consolidated Permission Set</option>
        </select>
      </div>
      <button class="btn btn-success" onclick="executeDecompose()">🔨 Execute Modular Decomposition</button>
      <div class="status-box" id="decomposeStatus"></div>
    </div>
  </div>

  <!-- Tab 4: Live Org Migration -->
  <div class="tab-content" id="tab-cloud">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Direct Live Salesforce Org Migration</h3>
      <p style="opacity: 0.8; margin-bottom: 16px; font-size: 0.88rem;">
        Connect directly to an authenticated Salesforce org via sf/sfdx auth cache. Retrieve remote profiles or deploy generated Permission Sets &amp; PSGs directly back to the cloud.
      </p>

      <div style="display: flex; gap: 12px; margin-bottom: 20px; align-items: flex-end; flex-wrap: wrap;">
        <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 280px;">
          <label>Target Salesforce Org:</label>
          <select id="cloudOrgSelect" onchange="syncCustomOrgInput()"></select>
          <input type="text" id="cloudOrgCustom" placeholder="Or enter org alias / username manually..." style="display: none; margin-top: 6px;">
        </div>
        <div>
          <button class="btn btn-secondary" onclick="fetchOrgProfiles()">☁️ Fetch Remote Profiles</button>
        </div>
      </div>

      <div id="cloudProfilesSection" style="display: none; margin-top: 20px;">
        <h4 style="margin-bottom: 10px;">Remote Profiles Discovered in Org:</h4>
        <table>
          <thead>
            <tr>
              <th>Profile Name</th>
              <th>Type</th>
              <th>User Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="cloudProfilesTableBody"></tbody>
        </table>
      </div>

      <div class="status-box" id="cloudStatus"></div>

      <div class="card" style="margin-top: 24px; border-top: 1px solid var(--border-color); padding-top: 20px; background: rgba(0,0,0,0.15);">
        <h4 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          👥 Automated User Reassignment &amp; 1-Click Rollback
        </h4>
        <p style="opacity: 0.8; margin-bottom: 16px; font-size: 0.88rem;">
          Query all users on a legacy profile and assign them to the new Permission Set Group or Permission Set in bulk.
        </p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div class="form-group" style="margin-bottom: 0;">
            <label>Source Profile Name:</label>
            <input type="text" id="reassignProfile" placeholder="e.g. Custom Admin">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label>Target PSG / Permission Set API Name:</label>
            <input type="text" id="reassignTarget" placeholder="e.g. Custom_Admin_PSG">
          </div>
        </div>
        <div style="display: flex; gap: 16px; margin-bottom: 16px; align-items: center;">
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.88rem;">
            <input type="checkbox" id="reassignActiveOnly" checked> Active Users Only
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.88rem;">
            <input type="checkbox" id="reassignDryRun" checked> Dry Run (Preview Only)
          </label>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" onclick="triggerReassignPlan()">🔍 Plan / Preview Assignments</button>
          <button class="btn btn-success" id="btnExecuteReassign" style="display: none;" onclick="triggerExecuteReassign()">⚡ Execute Assignments</button>
        </div>
        <div id="reassignStatus" class="status-box" style="margin-top: 12px;"></div>
      </div>
    </div>
  </div>

  <!-- Tab 5: Cluster -->
  <div class="tab-content" id="tab-cluster">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Cross-Profile Deduplication &amp; Baseline Extraction</h3>
      <p style="opacity: 0.8; margin-bottom: 16px; font-size: 0.88rem;">
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
      <button class="btn btn-success" onclick="executeCluster()">🧩 Generate Baseline &amp; Deltas</button>
      <div class="status-box" id="clusterStatus"></div>
    </div>
  </div>

  <!-- Tab 6: Enterprise Pipeline -->
  <div class="tab-content" id="tab-pipeline">
    <div class="card">
      <h3 style="margin-bottom: 12px;">Enterprise Multi-Stage Migration Pipeline</h3>
      <p style="opacity: 0.8; margin-bottom: 20px; font-size: 0.88rem;">
        Executes discovery, semantic clustering, domain decomposition, mathematical parity verification, and UAP rule generation in a single automated flow.
      </p>

      <!-- Stepper Visualizer -->
      <div class="stepper">
        <div class="step-item">
          <div class="step-circle" id="step1">1</div>
          <div class="step-title">Audit</div>
        </div>
        <div class="step-item">
          <div class="step-circle" id="step2">2</div>
          <div class="step-title">Clustering</div>
        </div>
        <div class="step-item">
          <div class="step-circle" id="step3">3</div>
          <div class="step-title">Decomposition</div>
        </div>
        <div class="step-item">
          <div class="step-circle" id="step4">4</div>
          <div class="step-title">Parity Proof</div>
        </div>
        <div class="step-item">
          <div class="step-circle" id="step5">5</div>
          <div class="step-title">UAP Rules</div>
        </div>
        <div class="step-item">
          <div class="step-circle" id="step6">6</div>
          <div class="step-title">Complete</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0;">
        <div class="form-group">
          <label>Target Scope:</label>
          <select id="pipelineProfileSelect">
            <option value="">All Discovered Profiles in Workspace</option>
          </select>
        </div>
        <div class="form-group">
          <label>Deployment Target:</label>
          <select id="pipelineTargetOrg"></select>
        </div>
      </div>

      <div style="display: flex; gap: 20px; margin-bottom: 20px;">
        <label><input type="checkbox" id="pipelineCluster" checked> Enable Jaccard Clustering</label>
        <label><input type="checkbox" id="pipelineStrict" checked> Strict Mathematical Parity Gate (Fail on 0.01% drift)</label>
        <label><input type="checkbox" id="pipelineDeploy"> Direct Cloud Deploy to Org</label>
      </div>

      <button class="btn btn-success" id="btnLaunchPipeline" onclick="launchPipeline()">🚀 Launch Multi-Stage Pipeline</button>

      <div class="console-box" id="pipelineConsole">PermForge Pipeline Console ready. Click 'Launch Multi-Stage Pipeline' to begin.</div>
    </div>
  </div>

  <!-- Tab 7: Strip -->
  <div class="tab-content" id="tab-strip">
    <div class="card">
      <h3 style="margin-bottom: 16px;">Sanitize &amp; Strip Migrated Profile Permissions</h3>
      <p style="opacity: 0.8; margin-bottom: 16px; font-size: 0.88rem;">
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

  <!-- Tab 8: Least Privilege & Pruner -->
  <div class="tab-content" id="tab-prune">
    <div class="card">
      <h3 style="margin-bottom: 12px;">Usage-Driven Least-Privilege Optimization</h3>
      <p style="opacity: 0.8; margin-bottom: 20px; font-size: 0.88rem;">
        Cross-references static profile permissions with real Salesforce EventLogFile telemetry. Calculates dormant access, computes an Over-Privilege score, and generates a minimal pruned Permission Set or Muting Permission Set.
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label>Target Profile to Audit:</label>
          <select id="pruneProfileSelect"></select>
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label>Audit &amp; Remediation Mode:</label>
          <select id="pruneMode">
            <option value="audit-only" selected>Audit &amp; Scorecard Only (Read-Only)</option>
            <option value="prune">Prune Dormant Access into Minimal Permission Set</option>
            <option value="mute">Generate Muting Permission Set (Silences Dormant Grants)</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>Salesforce EventLogFile Telemetry (CSV or JSON path, or leave blank for zero-activity audit):</label>
        <input type="text" id="pruneEventsPath" placeholder="e.g. ./telemetry/eventlog.csv or force-app/events/usage.json" style="max-width: 100%;">
      </div>

      <div style="display: flex; gap: 10px; margin-bottom: 20px;">
        <button class="btn btn-success" onclick="executeLeastPrivilegeAudit()">🎯 Run Least-Privilege Audit</button>
      </div>

      <div class="status-box" id="pruneStatus"></div>

      <div id="pruneResultsSection" style="display: none; margin-top: 24px;">
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-val" id="pruneMetricUtil" style="color: var(--accent-cyan);">0%</div>
            <div class="metric-label">Utilization Rate</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="pruneMetricOverPriv" style="color: var(--accent-amber);">0/100</div>
            <div class="metric-label">Over-Privilege Score</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="pruneMetricDormantCount">0</div>
            <div class="metric-label">Dormant Permissions</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="pruneMetricRisk" style="color: var(--accent-rose);">LOW</div>
            <div class="metric-label">Dormant Risk Level</div>
          </div>
        </div>

        <div id="pruneArtifactBox" class="card" style="display: none; background: rgba(56, 189, 248, 0.1); border-color: rgba(56, 189, 248, 0.3); margin-bottom: 20px;">
          <h4 style="color: var(--accent-cyan); margin-bottom: 8px;">Generated Remediation Artifact</h4>
          <div id="pruneArtifactDetails" style="font-size: 0.88rem;"></div>
        </div>

        <h4 style="margin-bottom: 12px;">Dormant Permissions Detected (Never Exercised in Telemetry):</h4>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Name</th>
              <th>Granted Access</th>
              <th>Risk Level</th>
              <th>Recommendation</th>
            </tr>
          </thead>
          <tbody id="pruneTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Tab 9: Cross-Org Drift Guard -->
  <div class="tab-content" id="tab-drift">
    <div class="card">
      <h3 style="margin-bottom: 12px;">Cross-Environment Drift Guard</h3>
      <p style="opacity: 0.8; margin-bottom: 20px; font-size: 0.88rem;">
        Compare metadata across branches, orgs, or local profiles to detect unauthorized privilege creep, missing permissions, or configuration drift before deployment.
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label>Base Profile / Directory (Source of Truth):</label>
          <select id="driftBaseSelect" onchange="syncDriftBaseInput()"></select>
          <input type="text" id="driftBasePath" placeholder="Or enter path to base profile / directory..." style="margin-top: 6px; max-width: 100%;">
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label>Target Profile / Directory (To Compare):</label>
          <input type="text" id="driftTargetPath" placeholder="e.g. force-app/main/default/profiles/Target.profile-meta.xml" style="max-width: 100%;">
        </div>
      </div>

      <div style="display: flex; gap: 16px; margin-bottom: 20px; align-items: center;">
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.88rem;">
          <input type="checkbox" id="driftReconcile"> Auto-generate Reconciliation Permission Set for detected drifts
        </label>
      </div>

      <div style="display: flex; gap: 10px; margin-bottom: 20px;">
        <button class="btn btn-success" onclick="executeDetectDrift()">🔍 Scan for Metadata Drift</button>
      </div>

      <div class="status-box" id="driftStatus"></div>

      <div id="driftResultsSection" style="display: none; margin-top: 24px;">
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-val" id="driftMetricTotal">0</div>
            <div class="metric-label">Total Drifts Found</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="driftMetricSeverity" style="color: var(--accent-green);">NONE</div>
            <div class="metric-label">Highest Severity</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="driftMetricObj">0</div>
            <div class="metric-label">SObject Drifts</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="driftMetricFls">0</div>
            <div class="metric-label">FLS Field Drifts</div>
          </div>
        </div>

        <div id="driftReconcileBox" class="card" style="display: none; background: rgba(52, 211, 153, 0.1); border-color: rgba(52, 211, 153, 0.3); margin-bottom: 20px;">
          <h4 style="color: var(--accent-green); margin-bottom: 8px;">Reconciliation Permission Set Created</h4>
          <div id="driftReconcileDetails" style="font-size: 0.88rem;"></div>
        </div>

        <h4 style="margin-bottom: 12px;">Detailed Drift Log:</h4>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Item Name</th>
              <th>Drift Type</th>
              <th>Base State</th>
              <th>Target State</th>
              <th>Severity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="driftTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Tab 10: Compliance & Audit -->
  <div class="tab-content" id="tab-compliance">
    <div class="card">
      <h3 style="margin-bottom: 12px;">Enterprise Regulatory Compliance &amp; Security Scorecard</h3>
      <p style="opacity: 0.8; margin-bottom: 20px; font-size: 0.88rem;">
        Automated compliance assessment covering SOC 2 Type II, HIPAA Security Rule, and ISO 27001. Audits superuser administrative permissions, Segregation of Duties (SoD) violations, and ePHI / PII data exposure.
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label>Target Regulatory Framework:</label>
          <select id="complianceFramework">
            <option value="all" selected>All Frameworks (SOC 2 Type II, HIPAA, ISO 27001)</option>
            <option value="soc2">SOC 2 Type II (Trust Services Criteria CC6.1 - CC6.3)</option>
            <option value="hipaa">HIPAA Security Rule (45 CFR § 164.312 Access Control)</option>
            <option value="iso27001">ISO/IEC 27001:2022 (A.9.2, A.9.4 Access Control)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 0; display: flex; align-items: flex-end;">
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.88rem; padding-bottom: 10px;">
            <input type="checkbox" id="complianceExportArtifacts" checked> Export Evidence Package (HTML Report, CSV Matrix, Markdown)
          </label>
        </div>
      </div>

      <div style="display: flex; gap: 10px; margin-bottom: 20px;">
        <button class="btn btn-success" onclick="executeAuditCompliance()">📋 Run Compliance Audit</button>
      </div>

      <div class="status-box" id="complianceStatus"></div>

      <div id="complianceResultsSection" style="display: none; margin-top: 24px;">
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-val" id="complianceMetricStatus" style="color: var(--accent-green);">COMPLIANT</div>
            <div class="metric-label">Overall Status</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="complianceMetricScore" style="color: var(--accent-cyan);">100%</div>
            <div class="metric-label">Compliance Score</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="complianceMetricProfiles">0</div>
            <div class="metric-label">Profiles Audited</div>
          </div>
          <div class="metric-card">
            <div class="metric-val" id="complianceMetricControls">0</div>
            <div class="metric-label">Controls Evaluated</div>
          </div>
        </div>

        <div id="complianceExportBox" class="card" style="display: none; background: rgba(56, 189, 248, 0.1); border-color: rgba(56, 189, 248, 0.3); margin-bottom: 20px;">
          <h4 style="color: var(--accent-cyan); margin-bottom: 8px;">📁 Exported Audit Evidence Package</h4>
          <div id="complianceExportDetails" style="font-size: 0.88rem;"></div>
        </div>

        <h4 style="margin-bottom: 12px;">Regulatory Controls Scorecard:</h4>
        <table style="margin-bottom: 24px;">
          <thead>
            <tr>
              <th>Control ID</th>
              <th>Framework</th>
              <th>Title</th>
              <th>Status</th>
              <th>Findings</th>
            </tr>
          </thead>
          <tbody id="complianceControlsTableBody"></tbody>
        </table>

        <div id="complianceFindingsContainer">
          <h4 style="margin-bottom: 12px; color: var(--accent-rose);">Critical Administrative &amp; Superuser Privileges:</h4>
          <table style="margin-bottom: 24px;">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Permission</th>
                <th>Risk Category</th>
                <th>Severity</th>
                <th>Mitigation Recommendation</th>
              </tr>
            </thead>
            <tbody id="complianceAdminTableBody"></tbody>
          </table>

          <h4 style="margin-bottom: 12px; color: var(--accent-amber);">ePHI / PII Sensitive Data Grants:</h4>
          <table style="margin-bottom: 24px;">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Object / Field</th>
                <th>Access Granted</th>
                <th>Data Type</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody id="compliancePhiTableBody"></tbody>
          </table>

          <h4 style="margin-bottom: 12px; color: var(--accent-rose);">Segregation of Duties (SoD) Violations:</h4>
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Conflicting Permissions</th>
                <th>Rationale</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody id="complianceSodTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentProfiles = [];
    let currentMatrixData = null;
    let currentMatrixFilter = 'all';

    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const btn = document.getElementById('tabBtn-' + tabId.replace('tab-', ''));
      if (btn) btn.classList.add('active');
      const content = document.getElementById(tabId);
      if (content) content.classList.add('active');
    }

    function scanWorkspace() {
      vscode.postMessage({ command: 'scanWorkspace' });
    }

    function executeDecompose() {
      const path = document.getElementById('decomposeSelect').value;
      if (!path) return;
      vscode.postMessage({ command: 'decomposeProfile', profilePath: path });
    }

    function loadMatrixForSelected() {
      const path = document.getElementById('matrixProfileSelect').value;
      if (!path) return;
      document.getElementById('matrixTableBody').innerHTML = '<tr><td colspan="5" style="text-align: center; opacity: 0.6;">Computing bit-for-bit mathematical parity matrix...</td></tr>';
      vscode.postMessage({ command: 'loadParityMatrix', profilePath: path });
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

    function syncCustomOrgInput() {
      const sel = document.getElementById('cloudOrgSelect').value;
      const customInput = document.getElementById('cloudOrgCustom');
      if (sel === '__custom__') {
        customInput.style.display = 'block';
      } else {
        customInput.style.display = 'none';
      }
    }

    function getSelectedCloudOrg() {
      const sel = document.getElementById('cloudOrgSelect').value;
      if (sel === '__custom__') {
        return document.getElementById('cloudOrgCustom').value.trim();
      }
      return sel;
    }

    function fetchOrgProfiles() {
      const org = getSelectedCloudOrg();
      document.getElementById('cloudStatus').style.display = 'block';
      document.getElementById('cloudStatus').innerHTML = '⏳ Connecting to Salesforce org ' + (org || 'default') + ' and querying profiles...';
      vscode.postMessage({ command: 'listOrgProfiles', targetOrg: org, customOnly: true });
    }

    function retrieveOrgProfile(profileName) {
      const org = getSelectedCloudOrg();
      document.getElementById('cloudStatus').style.display = 'block';
      document.getElementById('cloudStatus').innerHTML = '⏳ Retrieving ' + profileName + ' via Metadata API...';
      vscode.postMessage({ command: 'retrieveFromOrg', targetOrg: org, profileNames: [profileName] });
    }

    function cloudDeployProfile(profilePath) {
      const org = getSelectedCloudOrg();
      if (!confirm('Decompose ' + profilePath + ' and deploy generated Permission Sets and PSG directly to ' + (org || 'default org') + '?')) {
        return;
      }
      document.getElementById('cloudStatus').style.display = 'block';
      document.getElementById('cloudStatus').innerHTML = '⏳ Decomposing & deploying to Salesforce Metadata API...';
      vscode.postMessage({ command: 'deployToOrg', targetOrg: org, profilePath: profilePath });
    }

    function launchPipeline() {
      const profileName = document.getElementById('pipelineProfileSelect').value;
      const targetOrg = document.getElementById('pipelineTargetOrg').value;
      const cluster = document.getElementById('pipelineCluster').checked;
      const strict = document.getElementById('pipelineStrict').checked;
      const deploy = document.getElementById('pipelineDeploy').checked;

      // Animate stepper
      document.getElementById('step1').className = 'step-circle active';
      document.getElementById('pipelineConsole').innerText = '🚀 PermForge Enterprise Pipeline starting...\\n';

      vscode.postMessage({
        command: 'runPipeline',
        options: { profileName, targetOrg, cluster, strict, deploy }
      });
    }

    let currentReassignPlan = null;

    function triggerReassignPlan() {
      const org = getSelectedTargetOrg();
      const profile = document.getElementById('reassignProfile').value.trim();
      const target = document.getElementById('reassignTarget').value.trim();
      const activeOnly = document.getElementById('reassignActiveOnly').checked;

      if (!profile || !target) {
        alert('Please specify both Source Profile and Target PSG / Permission Set API Name.');
        return;
      }

      const status = document.getElementById('reassignStatus');
      status.style.display = 'block';
      status.innerHTML = '<span style="color: var(--accent-cyan);">⏳ Querying org and computing assignment plan...</span>';
      document.getElementById('btnExecuteReassign').style.display = 'none';

      vscode.postMessage({
        command: 'planUserAssignments',
        targetOrg: org,
        profileName: profile,
        targetName: target,
        activeOnly: activeOnly
      });
    }

    function triggerExecuteReassign() {
      if (!currentReassignPlan) return;
      const org = getSelectedTargetOrg();
      const status = document.getElementById('reassignStatus');
      status.style.display = 'block';
      status.innerHTML = '<span style="color: var(--accent-cyan);">⚡ Creating PermissionSetAssignment records in Salesforce...</span>';

      vscode.postMessage({
        command: 'executeUserAssignments',
        targetOrg: org,
        plan: currentReassignPlan
      });
    }

    function triggerRollback(rollbackFile) {
      const org = getSelectedTargetOrg();
      const status = document.getElementById('reassignStatus');
      status.style.display = 'block';
      status.innerHTML = '<span style="color: var(--accent-yellow);">🔄 Reverting assignments via rollback manifest...</span>';

      vscode.postMessage({
        command: 'rollbackUserAssignments',
        targetOrg: org,
        rollbackFile: rollbackFile
      });
    }

    function executeLeastPrivilegeAudit() {
      const profilePath = document.getElementById('pruneProfileSelect').value;
      const eventsPath = document.getElementById('pruneEventsPath').value;
      const mode = document.getElementById('pruneMode').value;
      if (!profilePath) {
        alert('Please select a profile to audit.');
        return;
      }
      const status = document.getElementById('pruneStatus');
      status.style.display = 'block';
      status.innerHTML = '<span style="color: var(--accent-cyan);">⏳ Auditing profile against telemetry...</span>';
      document.getElementById('pruneResultsSection').style.display = 'none';
      vscode.postMessage({
        command: 'auditLeastPrivilege',
        profilePath,
        eventsPath,
        mode,
      });
    }

    function renderLeastPrivilegeReport(report, profileName) {
      document.getElementById('pruneStatus').style.display = 'none';
      const sec = document.getElementById('pruneResultsSection');
      sec.style.display = 'block';

      document.getElementById('pruneMetricUtil').innerText = report.utilizationRatePercent + '%';
      document.getElementById('pruneMetricOverPriv').innerText = report.overPrivilegeScore + '/100';
      document.getElementById('pruneMetricDormantCount').innerText = report.dormantPermissionsCount;

      const riskEl = document.getElementById('pruneMetricRisk');
      riskEl.innerText = report.dormantRiskLevel;
      if (report.dormantRiskLevel === 'CRITICAL' || report.dormantRiskLevel === 'HIGH') {
        riskEl.style.color = 'var(--accent-rose)';
      } else if (report.dormantRiskLevel === 'MEDIUM') {
        riskEl.style.color = 'var(--accent-amber)';
      } else {
        riskEl.style.color = 'var(--accent-green)';
      }

      const artBox = document.getElementById('pruneArtifactBox');
      const artDetails = document.getElementById('pruneArtifactDetails');
      if (report.generatedPrunedPermissionSet) {
        artBox.style.display = 'block';
        artDetails.innerHTML = '<strong>Generated Pruned Permission Set:</strong> <code>' + report.generatedPrunedPermissionSet.apiName + '</code> (' + report.generatedPrunedPermissionSet.fileName + ')';
      } else if (report.generatedMutingPermissionSet) {
        artBox.style.display = 'block';
        artDetails.innerHTML = '<strong>Generated Muting Permission Set:</strong> <code>' + report.generatedMutingPermissionSet.apiName + '</code> (Muted ' + (report.generatedMutingPermissionSet.stats ? report.generatedMutingPermissionSet.stats.objectsMuted : 0) + ' objects, ' + (report.generatedMutingPermissionSet.stats ? report.generatedMutingPermissionSet.stats.userPermsMuted : 0) + ' user perms)';
      } else {
        artBox.style.display = 'none';
      }

      const tbody = document.getElementById('pruneTableBody');
      tbody.innerHTML = '';
      if (!report.dormantPermissions || report.dormantPermissions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--accent-green); font-weight: 600;">🎉 100% Permission Utilization! Zero dormant permissions detected.</td></tr>';
      } else {
        report.dormantPermissions.forEach(dp => {
          let badgeClass = 'badge-low';
          if (dp.riskLevel === 'CRITICAL' || dp.riskLevel === 'HIGH') badgeClass = 'badge-high';
          else if (dp.riskLevel === 'MEDIUM') badgeClass = 'badge-med';

          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td><span class="badge">' + dp.category + '</span></td>' +
            '<td><strong>' + dp.name + '</strong></td>' +
            '<td><code>' + dp.grantedAccess + '</code></td>' +
            '<td><span class="' + badgeClass + '">' + dp.riskLevel + '</span></td>' +
            '<td>' + dp.recommendation + '</td>';
          tbody.appendChild(tr);
        });
      }
    }

    function syncDriftBaseInput() {
      const sel = document.getElementById('driftBaseSelect').value;
      if (sel) {
        document.getElementById('driftBasePath').value = sel;
      }
    }

    function executeDetectDrift() {
      const basePath = document.getElementById('driftBasePath').value.trim() || document.getElementById('driftBaseSelect').value;
      const targetPath = document.getElementById('driftTargetPath').value.trim();
      const reconcile = document.getElementById('driftReconcile').checked;

      if (!basePath || !targetPath) {
        alert('Please specify both Base path and Target path for drift comparison.');
        return;
      }

      const status = document.getElementById('driftStatus');
      status.style.display = 'block';
      status.innerHTML = '<span style="color: var(--accent-cyan);">⏳ Analyzing metadata drift between environments...</span>';
      document.getElementById('driftResultsSection').style.display = 'none';

      vscode.postMessage({
        command: 'detectDrift',
        basePath,
        targetPath,
        reconcile,
      });
    }

    function renderDriftReportSingle(report) {
      document.getElementById('driftStatus').style.display = 'none';
      const sec = document.getElementById('driftResultsSection');
      sec.style.display = 'block';

      document.getElementById('driftMetricTotal').innerText = report.totalDrifts;
      const sevEl = document.getElementById('driftMetricSeverity');
      sevEl.innerText = report.overallSeverity;
      if (report.overallSeverity === 'CRITICAL' || report.overallSeverity === 'HIGH') {
        sevEl.style.color = 'var(--accent-rose)';
      } else if (report.overallSeverity === 'MEDIUM') {
        sevEl.style.color = 'var(--accent-amber)';
      } else {
        sevEl.style.color = 'var(--accent-green)';
      }

      document.getElementById('driftMetricObj').innerText = report.driftsByCategory ? report.driftsByCategory.objects : 0;
      document.getElementById('driftMetricFls').innerText = report.driftsByCategory ? report.driftsByCategory.fields : 0;

      const recBox = document.getElementById('driftReconcileBox');
      const recDetails = document.getElementById('driftReconcileDetails');
      if (report.reconciliationPermissionSet) {
        recBox.style.display = 'block';
        recDetails.innerHTML = '<strong>Reconciliation Permission Set Created:</strong> <code>' + report.reconciliationPermissionSet.apiName + '</code> (' + report.reconciliationPermissionSet.fileName + ')';
      } else {
        recBox.style.display = 'none';
      }

      const tbody = document.getElementById('driftTableBody');
      tbody.innerHTML = '';
      if (!report.drifts || report.drifts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--accent-green); font-weight: 600;">✔ Zero drift detected! Environments are identical.</td></tr>';
      } else {
        report.drifts.forEach(d => {
          let badgeClass = 'badge-low';
          if (d.severity === 'CRITICAL' || d.severity === 'HIGH') badgeClass = 'badge-high';
          else if (d.severity === 'MEDIUM') badgeClass = 'badge-med';

          let typeBadge = 'color: var(--accent-cyan);';
          if (d.type === 'ADDED') typeBadge = 'color: var(--accent-green);';
          else if (d.type === 'REMOVED') typeBadge = 'color: var(--accent-rose);';
          else if (d.type === 'MODIFIED') typeBadge = 'color: var(--accent-amber);';

          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td><span class="badge">' + d.category + '</span></td>' +
            '<td><strong>' + d.name + '</strong></td>' +
            '<td style="' + typeBadge + ' font-weight: 700;">' + d.type + '</td>' +
            '<td><code>' + d.baseState + '</code></td>' +
            '<td><code>' + d.targetState + '</code></td>' +
            '<td><span class="' + badgeClass + '">' + d.severity + '</span></td>' +
            '<td>' + d.details + '</td>';
          tbody.appendChild(tr);
        });
      }
    }

    function renderDriftReportMulti(multiReport) {
      document.getElementById('driftStatus').style.display = 'none';
      const sec = document.getElementById('driftResultsSection');
      sec.style.display = 'block';

      document.getElementById('driftMetricTotal').innerText = multiReport.totalDriftsFound;
      const sevEl = document.getElementById('driftMetricSeverity');
      sevEl.innerText = multiReport.highestSeverity;
      if (multiReport.highestSeverity === 'CRITICAL' || multiReport.highestSeverity === 'HIGH') {
        sevEl.style.color = 'var(--accent-rose)';
      } else if (multiReport.highestSeverity === 'MEDIUM') {
        sevEl.style.color = 'var(--accent-amber)';
      } else {
        sevEl.style.color = 'var(--accent-green)';
      }

      let totalObj = 0;
      let totalFls = 0;
      const allDrifts = [];
      (multiReport.reports || []).forEach(r => {
        if (r.driftsByCategory) {
          totalObj += r.driftsByCategory.objects;
          totalFls += r.driftsByCategory.fields;
        }
        (r.drifts || []).forEach(d => {
          allDrifts.push({ ...d, profileName: r.profileName });
        });
      });

      document.getElementById('driftMetricObj').innerText = totalObj;
      document.getElementById('driftMetricFls').innerText = totalFls;

      const recBox = document.getElementById('driftReconcileBox');
      recBox.style.display = 'none';

      const tbody = document.getElementById('driftTableBody');
      tbody.innerHTML = '';
      if (allDrifts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--accent-green); font-weight: 600;">✔ Zero drift detected across all profiles!</td></tr>';
      } else {
        allDrifts.forEach(d => {
          let badgeClass = 'badge-low';
          if (d.severity === 'CRITICAL' || d.severity === 'HIGH') badgeClass = 'badge-high';
          else if (d.severity === 'MEDIUM') badgeClass = 'badge-med';

          let typeBadge = 'color: var(--accent-cyan);';
          if (d.type === 'ADDED') typeBadge = 'color: var(--accent-green);';
          else if (d.type === 'REMOVED') typeBadge = 'color: var(--accent-rose);';
          else if (d.type === 'MODIFIED') typeBadge = 'color: var(--accent-amber);';

          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td><span class="badge">' + d.category + '</span></td>' +
            '<td><strong>' + (d.profileName ? d.profileName + ' &rsaquo; ' : '') + d.name + '</strong></td>' +
            '<td style="' + typeBadge + ' font-weight: 700;">' + d.type + '</td>' +
            '<td><code>' + d.baseState + '</code></td>' +
            '<td><code>' + d.targetState + '</code></td>' +
            '<td><span class="' + badgeClass + '">' + d.severity + '</span></td>' +
            '<td>' + d.details + '</td>';
          tbody.appendChild(tr);
        });
      }
    }

    function executeAuditCompliance() {
      const framework = document.getElementById('complianceFramework').value;
      const exportArtifacts = document.getElementById('complianceExportArtifacts').checked;

      const status = document.getElementById('complianceStatus');
      status.style.display = 'block';
      status.innerHTML = '<span style="color: var(--accent-cyan);">⏳ Auditing regulatory controls and security baselines...</span>';
      document.getElementById('complianceResultsSection').style.display = 'none';

      vscode.postMessage({
        command: 'auditCompliance',
        framework,
        exportArtifacts,
      });
    }

    function renderComplianceReport(report) {
      document.getElementById('complianceStatus').style.display = 'none';
      const sec = document.getElementById('complianceResultsSection');
      sec.style.display = 'block';

      const statusEl = document.getElementById('complianceMetricStatus');
      statusEl.innerText = report.overallStatus;
      if (report.overallStatus === 'COMPLIANT') {
        statusEl.style.color = 'var(--accent-green)';
      } else if (report.overallStatus === 'WARNING') {
        statusEl.style.color = 'var(--accent-amber)';
      } else {
        statusEl.style.color = 'var(--accent-rose)';
      }

      document.getElementById('complianceMetricScore').innerText = report.scorePercent + '%';
      document.getElementById('complianceMetricProfiles').innerText = report.totalProfilesAudited;
      document.getElementById('complianceMetricControls').innerText = report.controlResults ? report.controlResults.length : 0;

      const expBox = document.getElementById('complianceExportBox');
      const expDetails = document.getElementById('complianceExportDetails');
      if (report.exportedFiles && (report.exportedFiles.htmlReportPath || report.exportedFiles.csvMatrixPath || report.exportedFiles.markdownSummaryPath)) {
        expBox.style.display = 'block';
        let filesHtml = '<ul style="padding-left: 20px; line-height: 1.8;">';
        if (report.exportedFiles.htmlReportPath) filesHtml += '<li><strong>Interactive HTML Report:</strong> <code>' + report.exportedFiles.htmlReportPath + '</code></li>';
        if (report.exportedFiles.csvMatrixPath) filesHtml += '<li><strong>CSV Audit Matrix:</strong> <code>' + report.exportedFiles.csvMatrixPath + '</code></li>';
        if (report.exportedFiles.markdownSummaryPath) filesHtml += '<li><strong>Markdown Executive Summary:</strong> <code>' + report.exportedFiles.markdownSummaryPath + '</code></li>';
        filesHtml += '</ul>';
        expDetails.innerHTML = filesHtml;
      } else {
        expBox.style.display = 'none';
      }

      const cTbody = document.getElementById('complianceControlsTableBody');
      cTbody.innerHTML = '';
      (report.controlResults || []).forEach(ctrl => {
        let statusClass = 'badge-low';
        if (ctrl.status === 'NON_COMPLIANT') statusClass = 'badge-high';
        else if (ctrl.status === 'WARNING') statusClass = 'badge-med';

        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><code>' + ctrl.controlId + '</code></td>' +
          '<td><span class="badge">' + ctrl.framework + '</span></td>' +
          '<td><strong>' + ctrl.title + '</strong><br><span style="font-size: 0.8rem; opacity: 0.75;">' + ctrl.description + '</span></td>' +
          '<td><span class="' + statusClass + '">' + ctrl.status + '</span></td>' +
          '<td>' + ctrl.findingsCount + ' finding(s)</td>';
        cTbody.appendChild(tr);
      });

      const admTbody = document.getElementById('complianceAdminTableBody');
      admTbody.innerHTML = '';
      if (!report.adminPrivileges || report.adminPrivileges.length === 0) {
        admTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--accent-green); font-weight: 600;">✔ No unauthorized superuser permissions detected.</td></tr>';
      } else {
        report.adminPrivileges.forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td><strong>' + item.profileName + '</strong></td>' +
            '<td><code>' + item.permission + '</code></td>' +
            '<td><span class="badge">' + item.riskCategory + '</span></td>' +
            '<td><span class="badge-high">' + item.severity + '</span></td>' +
            '<td>' + item.mitigationRecommendation + '</td>';
          admTbody.appendChild(tr);
        });
      }

      const phiTbody = document.getElementById('compliancePhiTableBody');
      phiTbody.innerHTML = '';
      if (!report.phiPiiAccesses || report.phiPiiAccesses.length === 0) {
        phiTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--accent-green); font-weight: 600;">✔ Zero unauthorized ePHI/PII sensitive data access found.</td></tr>';
      } else {
        report.phiPiiAccesses.forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td><strong>' + item.profileName + '</strong></td>' +
            '<td><code>' + item.objectOrField + '</code></td>' +
            '<td>' + item.accessGranted + '</td>' +
            '<td><span class="badge">' + item.dataType + '</span></td>' +
            '<td><span class="badge-med">' + item.severity + '</span></td>';
          phiTbody.appendChild(tr);
        });
      }

      const sodTbody = document.getElementById('complianceSodTableBody');
      sodTbody.innerHTML = '';
      if (!report.sodViolations || report.sodViolations.length === 0) {
        sodTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--accent-green); font-weight: 600;">✔ Zero Segregation of Duties conflicts detected.</td></tr>';
      } else {
        report.sodViolations.forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td><strong>' + item.profileName + '</strong></td>' +
            '<td><code>' + item.conflictingPermissions.join('</code> + <code>') + '</code></td>' +
            '<td>' + item.conflictRationale + '</td>' +
            '<td><span class="badge-high">' + item.severity + '</span></td>';
          sodTbody.appendChild(tr);
        });
      }
    }

    function goToPrune(path) {
      const el = document.getElementById('pruneProfileSelect');
      if (el) el.value = path;
      switchTab('tab-prune');
    }

    function goToDrift(path) {
      const sel = document.getElementById('driftBaseSelect');
      if (sel) sel.value = path;
      const inp = document.getElementById('driftBasePath');
      if (inp) inp.value = path;
      switchTab('tab-drift');
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'leastPrivilegeReport':
          renderLeastPrivilegeReport(msg.report, msg.profileName);
          break;
        case 'leastPrivilegeError':
          showStatus('pruneStatus', '<span style="color: var(--accent-rose);">✖ ' + msg.error + '</span>');
          break;
        case 'driftReportSingle':
          renderDriftReportSingle(msg.report);
          break;
        case 'driftReportMulti':
          renderDriftReportMulti(msg.report);
          break;
        case 'driftError':
          showStatus('driftStatus', '<span style="color: var(--accent-rose);">✖ ' + msg.error + '</span>');
          break;
        case 'complianceReport':
          renderComplianceReport(msg.report);
          break;
        case 'complianceError':
          showStatus('complianceStatus', '<span style="color: var(--accent-rose);">✖ ' + msg.error + '</span>');
          break;
        case 'switchTab':
          switchTab(msg.tabId);
          break;
        case 'assignmentPlanResult': {
          currentReassignPlan = msg.plan;
          const status = document.getElementById('reassignStatus');
          status.style.display = 'block';
          const isDryRun = document.getElementById('reassignDryRun').checked;
          const pendingCount = msg.plan.usersToAssign.length;
          
          let html = '<div style="margin-bottom: 8px;"><strong>Plan Generated:</strong> ' + msg.plan.totalUsersFound + ' users found on profile (' + msg.plan.activeUsersCount + ' active, ' + msg.plan.alreadyAssignedCount + ' already assigned).</div>';
          html += '<div style="color: ' + (pendingCount > 0 ? 'var(--accent-yellow)' : 'var(--accent-green)') + '; font-weight: 600;">' + pendingCount + ' pending assignment(s) ready.</div>';
          
          if (pendingCount > 0 && !isDryRun) {
            document.getElementById('btnExecuteReassign').style.display = 'inline-block';
          } else {
            document.getElementById('btnExecuteReassign').style.display = 'none';
          }
          status.innerHTML = html;
          break;
        }
        case 'assignmentExecuteResult': {
          const status = document.getElementById('reassignStatus');
          status.style.display = 'block';
          document.getElementById('btnExecuteReassign').style.display = 'none';
          let html = '<div style="color: var(--accent-green); font-weight: 600; margin-bottom: 6px;">🎉 Successfully assigned ' + msg.result.assignedCount + ' user(s)!</div>';
          if (msg.result.rollbackFile) {
            html += '<div style="font-size: 0.82rem; opacity: 0.85;">Rollback file: ' + msg.result.rollbackFile + '</div>';
            html += '<button class="btn btn-secondary" style="margin-top: 8px; font-size: 0.78rem;" onclick="triggerRollback(\\'' + msg.result.rollbackFile.replace(/\\/g, '\\\\') + '\\')">🔄 1-Click Rollback</button>';
          }
          status.innerHTML = html;
          break;
        }
        case 'assignmentRollbackResult': {
          const status = document.getElementById('reassignStatus');
          status.style.display = 'block';
          status.innerHTML = '<div style="color: var(--accent-green); font-weight: 600;">✅ Rollback Complete: Removed ' + msg.result.deletedCount + ' assignment(s)!</div>';
          break;
        }
        case 'assignmentError': {
          const status = document.getElementById('reassignStatus');
          status.style.display = 'block';
          status.innerHTML = '<span style="color: var(--accent-rose);">Error: ' + msg.error + '</span>';
          break;
        }
        case 'scanResults':
          renderProfiles(msg.profiles);
          break;
        case 'authorizedOrgs':
          renderOrgs(msg.orgs);
          break;
        case 'setSelectedProfile':
          setSelected(msg.profilePath);
          break;
        case 'parityMatrixData':
          renderParityMatrix(msg);
          break;
        case 'orgProfilesList':
          renderCloudProfiles(msg);
          break;
        case 'retrieveSuccess':
          showStatus('cloudStatus', '✔ Successfully retrieved ' + msg.count + ' profiles into workspace!');
          scanWorkspace();
          break;
        case 'deploySuccess':
          showStatus('cloudStatus', '✔ Successfully deployed ' + msg.permSetsDeployed + ' Permission Sets & PSG to org!');
          break;
        case 'deployError':
          showStatus('cloudStatus', '<span style="color: var(--accent-rose);">✖ Deployment failed: ' + msg.error + '</span>');
          break;
        case 'decomposeSuccess':
          showStatus('decomposeStatus', '✔ Decomposed ' + msg.profileName + '! Created PSG: ' + msg.result.psgName + ' with ' + msg.result.permSets.length + ' permission sets.');
          break;
        case 'clusterSuccess':
          showStatus('clusterStatus', '✔ Clustered profiles! Created baseline ' + msg.baselineName + ' and ' + msg.deltasCount + ' deltas.');
          break;
        case 'stripSuccess':
          showStatus('stripStatus', '✔ Sanitized profile! Stripped ' + msg.result.strippedUserPermissionsCount + ' perms, ' + msg.result.strippedObjectCount + ' objects.');
          break;
        case 'pipelineLog':
          const logEl = document.getElementById('pipelineConsole');
          logEl.innerText += msg.message + '\\n';
          logEl.scrollTop = logEl.scrollHeight;
          break;
        case 'pipelineComplete':
          finishPipeline(msg.result);
          break;
      }
    });

    function showStatus(elementId, html) {
      const el = document.getElementById(elementId);
      el.style.display = 'block';
      el.innerHTML = html;
    }

    function finishPipeline(res) {
      for (let i = 1; i <= 6; i++) {
        document.getElementById('step' + i).className = 'step-circle done';
      }
      const logEl = document.getElementById('pipelineConsole');
      logEl.innerText += '\\n✔ Enterprise Pipeline finished with 100% mathematical parity across ' + res.decompositions.length + ' profiles!\\n';
      logEl.scrollTop = logEl.scrollHeight;
    }

    function renderOrgs(orgs) {
      const cloudSelect = document.getElementById('cloudOrgSelect');
      const pipeSelect = document.getElementById('pipelineTargetOrg');
      cloudSelect.innerHTML = '';
      pipeSelect.innerHTML = '';

      if (orgs.length === 0) {
        cloudSelect.innerHTML = '<option value="">(No CLI orgs detected)</option>';
        pipeSelect.innerHTML = '<option value="">(None)</option>';
      }

      orgs.forEach(o => {
        const text = (o.alias ? o.alias + ' (' + o.username + ')' : o.username) + (o.isDefault ? ' [Default]' : '');
        const opt = document.createElement('option');
        opt.value = o.alias || o.username;
        opt.innerText = text;
        if (o.isDefault) opt.selected = true;
        cloudSelect.appendChild(opt.cloneNode(true));
        pipeSelect.appendChild(opt.cloneNode(true));
      });

      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.innerText = '➕ Custom Org Alias / Username...';
      cloudSelect.appendChild(customOpt);
    }

    function renderCloudProfiles(msg) {
      const sec = document.getElementById('cloudProfilesSection');
      const tbody = document.getElementById('cloudProfilesTableBody');
      const status = document.getElementById('cloudStatus');

      if (msg.error) {
        status.innerHTML = '<span style="color: var(--accent-rose);">Error connecting to org: ' + msg.error + '</span>';
        return;
      }

      status.style.display = 'none';
      sec.style.display = 'block';
      tbody.innerHTML = '';

      if (!msg.profiles || msg.profiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; opacity: 0.6;">No custom profiles found in target org.</td></tr>';
        return;
      }

      msg.profiles.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><strong>' + p.name + '</strong></td>' +
          '<td><span class="badge">' + (p.custom ? 'Custom Profile' : 'Standard') + '</span></td>' +
          '<td>' + (p.userType || 'Standard') + '</td>' +
          '<td>' +
            '<button class="btn btn-secondary" style="margin-right: 6px;" onclick="retrieveOrgProfile(\\'' + p.name + '\\')">📥 Retrieve to Workspace</button>' +
          '</td>';
        tbody.appendChild(tr);
      });
    }

    function renderParityMatrix(data) {
      currentMatrixData = data;
      document.getElementById('matrixScore').innerText = data.parityScore.toFixed(1) + '%';
      document.getElementById('matrixObjCount').innerText = data.objectMatrix ? data.objectMatrix.length : 0;
      document.getElementById('matrixFlsCount').innerText = data.fieldMatrix ? data.fieldMatrix.length : 0;
      
      const mismatchesCount = (data.objectMatrix || []).filter(o => !o.isMatch).length + (data.fieldMatrix || []).filter(f => !f.isMatch).length;
      document.getElementById('matrixDiscrepancies').innerText = mismatchesCount;
      if (mismatchesCount > 0) {
        document.getElementById('matrixDiscrepancies').style.color = 'var(--accent-rose)';
      } else {
        document.getElementById('matrixDiscrepancies').style.color = 'var(--accent-green)';
      }

      renderMatrixTable();
    }

    function setMatrixFilter(filter) {
      currentMatrixFilter = filter;
      document.querySelectorAll('#tab-matrix .btn-secondary').forEach(b => b.style.borderColor = '');
      renderMatrixTable();
    }

    function filterMatrixTable() {
      renderMatrixTable();
    }

    function renderPills(crudvm) {
      return (crudvm.create ? '<span class="pill pill-c">C</span>' : '<span class="pill pill-off">C</span>') +
             (crudvm.read ? '<span class="pill pill-r">R</span>' : '<span class="pill pill-off">R</span>') +
             (crudvm.edit ? '<span class="pill pill-e">E</span>' : '<span class="pill pill-off">E</span>') +
             (crudvm.delete ? '<span class="pill pill-d">D</span>' : '<span class="pill pill-off">D</span>') +
             (crudvm.viewAll ? '<span class="pill pill-v">V</span>' : '<span class="pill pill-off">V</span>') +
             (crudvm.modifyAll ? '<span class="pill pill-m">M</span>' : '<span class="pill pill-off">M</span>');
    }

    function renderFlsPills(fls) {
      return (fls.readable ? '<span class="pill pill-r">R</span>' : '<span class="pill pill-off">R</span>') +
             (fls.editable ? '<span class="pill pill-e">E</span>' : '<span class="pill pill-off">E</span>');
    }

    function renderMatrixTable() {
      if (!currentMatrixData) return;
      const tbody = document.getElementById('matrixTableBody');
      const search = (document.getElementById('matrixSearch').value || '').toLowerCase();
      tbody.innerHTML = '';

      let rowsAdded = 0;

      // Objects
      if (currentMatrixFilter === 'all' || currentMatrixFilter === 'objects' || currentMatrixFilter === 'mismatches') {
        (currentMatrixData.objectMatrix || []).forEach(item => {
          if (currentMatrixFilter === 'mismatches' && item.isMatch) return;
          if (search && !item.object.toLowerCase().includes(search)) return;

          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td><strong>' + item.object + '</strong></td>' +
            '<td><span class="badge" style="background: rgba(56, 189, 248, 0.1); color: #38bdf8;">SObject</span></td>' +
            '<td>' + renderPills(item.profile) + '</td>' +
            '<td>' + renderPills(item.target) + '</td>' +
            '<td>' + (item.isMatch ? '<span class="match-ok">✔ 100% Match</span>' : '<span class="match-fail">✖ Discrepancy</span>') + '</td>';
          tbody.appendChild(tr);
          rowsAdded++;
        });
      }

      // FLS Fields
      if (currentMatrixFilter === 'all' || currentMatrixFilter === 'fls' || currentMatrixFilter === 'mismatches') {
        (currentMatrixData.fieldMatrix || []).forEach(item => {
          if (currentMatrixFilter === 'mismatches' && item.isMatch) return;
          if (search && !item.field.toLowerCase().includes(search)) return;

          const tr = document.createElement('tr');
          tr.innerHTML = 
            '<td>' + item.field + '</td>' +
            '<td><span class="badge" style="background: rgba(192, 132, 252, 0.1); color: #c084fc;">FLS Field</span></td>' +
            '<td>' + renderFlsPills(item.profile) + '</td>' +
            '<td>' + renderFlsPills(item.target) + '</td>' +
            '<td>' + (item.isMatch ? '<span class="match-ok">✔ 100% Match</span>' : '<span class="match-fail">✖ Discrepancy</span>') + '</td>';
          tbody.appendChild(tr);
          rowsAdded++;
        });
      }

      if (rowsAdded === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; opacity: 0.6;">No permissions matching current filter.</td></tr>';
      }
    }

    function renderProfiles(profiles) {
      currentProfiles = profiles;
      document.getElementById('metricProfiles').innerText = profiles.length;

      let totalDebt = 0;
      let totalRisks = 0;

      const tbody = document.getElementById('profilesTableBody');
      const matrixSelect = document.getElementById('matrixProfileSelect');
      const decomposeSelect = document.getElementById('decomposeSelect');
      const stripSelect = document.getElementById('stripProfileSelect');
      const pipeSelect = document.getElementById('pipelineProfileSelect');
      const pruneSelect = document.getElementById('pruneProfileSelect');
      const driftSelect = document.getElementById('driftBaseSelect');

      matrixSelect.innerHTML = '';
      decomposeSelect.innerHTML = '';
      stripSelect.innerHTML = '';
      if (pruneSelect) pruneSelect.innerHTML = '';
      if (driftSelect) driftSelect.innerHTML = '';
      pipeSelect.innerHTML = '<option value="">All Discovered Profiles in Workspace</option>';

      if (profiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; opacity: 0.6;">No profile files found in workspace. Use "Live Org Migration" to retrieve from Salesforce.</td></tr>';
        return;
      }

      tbody.innerHTML = '';

      profiles.forEach(p => {
        totalDebt += p.complexityScore;
        totalRisks += p.highRiskFlags.length;

        const opt = document.createElement('option');
        opt.value = p.filePath;
        opt.innerText = p.name + ' (' + p.complexityScore + '/100)';
        matrixSelect.appendChild(opt.cloneNode(true));
        decomposeSelect.appendChild(opt.cloneNode(true));
        stripSelect.appendChild(opt.cloneNode(true));
        if (pruneSelect) pruneSelect.appendChild(opt.cloneNode(true));
        if (driftSelect) driftSelect.appendChild(opt.cloneNode(true));

        const pipeOpt = document.createElement('option');
        pipeOpt.value = p.name;
        pipeOpt.innerText = p.name;
        pipeSelect.appendChild(pipeOpt);

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
            '<button class="btn btn-secondary" style="margin-right: 4px; padding: 5px 8px; font-size: 0.78rem;" onclick="goToMatrix(\\'' + p.filePath.replace(/\\\\/g, '\\\\\\\\') + '\\')">📊 Matrix</button>' +
            '<button class="btn" style="margin-right: 4px; padding: 5px 8px; font-size: 0.78rem;" onclick="goToDecompose(\\'' + p.filePath.replace(/\\\\/g, '\\\\\\\\') + '\\')">🔨 Decompose</button>' +
            '<button class="btn btn-secondary" style="margin-right: 4px; padding: 5px 8px; font-size: 0.78rem;" onclick="goToPrune(\\'' + p.filePath.replace(/\\\\/g, '\\\\\\\\') + '\\')">🎯 Prune</button>' +
            '<button class="btn btn-secondary" style="margin-right: 4px; padding: 5px 8px; font-size: 0.78rem;" onclick="goToDrift(\\'' + p.filePath.replace(/\\\\/g, '\\\\\\\\') + '\\')">🔍 Drift</button>' +
            '<button class="btn btn-secondary" style="padding: 5px 8px; font-size: 0.78rem;" onclick="cloudDeployProfile(\\'' + p.filePath.replace(/\\\\/g, '\\\\\\\\') + '\\')">⚡ Deploy</button>' +
          '</td>';
        tbody.appendChild(tr);
      });

      const avgDebt = profiles.length > 0 ? Math.round(totalDebt / profiles.length) : 0;
      document.getElementById('metricDebt').innerText = avgDebt + '/100';
      document.getElementById('metricRisks').innerText = totalRisks;

      if (!currentMatrixData && profiles.length > 0) {
        loadMatrixForSelected();
      }
    }

    function setSelected(profilePath) {
      const selects = ['decomposeSelect', 'matrixProfileSelect', 'stripProfileSelect', 'pruneProfileSelect', 'driftBaseSelect'];
      selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = profilePath;
      });
      loadMatrixForSelected();
    }

    function goToMatrix(path) {
      document.getElementById('matrixProfileSelect').value = path;
      loadMatrixForSelected();
      switchTab('tab-matrix');
    }

    function goToDecompose(path) {
      document.getElementById('decomposeSelect').value = path;
      switchTab('tab-decompose');
    }

    // Auto scan on load
    scanWorkspace();
  </script>
</body>
</html>`;
  }
}
