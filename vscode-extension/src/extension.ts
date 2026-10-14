import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ProfilesTreeProvider, ProfileTreeItem } from './views/ProfilesTreeProvider.js';
import { PermSetsTreeProvider } from './views/PermSetsTreeProvider.js';
import { MigrationStudioPanel } from './panels/MigrationStudioPanel.js';
import {
  ProfileReader,
  ProfileAnalyzer,
  ProfileDecomposer,
  HtmlReporter,
  ProfileStripper,
  SalesforceOrgService,
  XmlEngine,
} from 'permforge';

export function activate(context: vscode.ExtensionContext) {
  console.log('PermForge extension is now active!');

  const profilesProvider = new ProfilesTreeProvider();
  const permSetsProvider = new PermSetsTreeProvider();

  // Register Tree Views
  vscode.window.registerTreeDataProvider('permforge-profiles', profilesProvider);
  vscode.window.registerTreeDataProvider('permforge-permsets', permSetsProvider);

  // Command: Open Migration Studio
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.openStudio', (target?: ProfileTreeItem | vscode.Uri | string) => {
      let targetPath: string | undefined;
      if (typeof target === 'string') {
        targetPath = target;
      } else if (target instanceof vscode.Uri) {
        targetPath = target.fsPath;
      } else if (target && target.profilePath) {
        targetPath = target.profilePath;
      }
      MigrationStudioPanel.createOrShow(context.extensionUri, targetPath, 'tab-dashboard');
    })
  );

  // Command: Open Parity Matrix & Access Heatmap
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.openParityMatrix', (target?: ProfileTreeItem | vscode.Uri | string) => {
      let targetPath: string | undefined;
      if (typeof target === 'string') {
        targetPath = target;
      } else if (target instanceof vscode.Uri) {
        targetPath = target.fsPath;
      } else if (target && target.profilePath) {
        targetPath = target.profilePath;
      }
      MigrationStudioPanel.createOrShow(context.extensionUri, targetPath, 'tab-matrix');
    })
  );

  // Command: Run Enterprise Migration Pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.runPipeline', (target?: ProfileTreeItem | vscode.Uri | string) => {
      let targetPath: string | undefined;
      if (typeof target === 'string') {
        targetPath = target;
      } else if (target instanceof vscode.Uri) {
        targetPath = target.fsPath;
      } else if (target && target.profilePath) {
        targetPath = target.profilePath;
      }
      MigrationStudioPanel.createOrShow(context.extensionUri, targetPath, 'tab-pipeline');
    })
  );

  // Command: Retrieve Profiles from Salesforce Org
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.retrieveFromOrg', async () => {
      const orgService = new SalesforceOrgService();
      let targetOrg: string | undefined;

      const knownOrgs = orgService.listAuthorizedOrgs();
      if (knownOrgs.length > 0) {
        const items = knownOrgs.map((o) => ({
          label: o.alias ? `${o.alias} (${o.username})` : o.username,
          description: o.isDefault ? '$(star) Default Org' : undefined,
          target: o.alias || o.username,
        }));
        items.push({
          label: '$(add) Enter Org Alias / Username Manually...',
          description: 'Specify custom target org',
          target: '__custom__',
        });

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select authenticated Salesforce org to retrieve profiles from',
        });
        if (!picked) return;

        if (picked.target === '__custom__') {
          targetOrg = await vscode.window.showInputBox({
            prompt: 'Enter Salesforce username or org alias',
            placeHolder: 'e.g. my-dev-org or user@example.com',
          });
          if (!targetOrg) return;
        } else {
          targetOrg = picked.target;
        }
      } else {
        targetOrg = await vscode.window.showInputBox({
          prompt: 'Enter Salesforce target org alias or username',
          placeHolder: 'e.g. my-dev-org or user@example.com',
        });
        if (!targetOrg) return;
      }

      const scope = await vscode.window.showQuickPick(
        [
          { label: '$(cloud-download) All Custom Profiles (Recommended)', detail: 'Retrieves all custom profiles from the org', value: 'all-custom' },
          { label: '$(list-unordered) Specific Profiles...', detail: 'Enter comma-separated profile names', value: 'specific' },
        ],
        { placeHolder: 'Choose retrieval scope' }
      );
      if (!scope) return;

      let profileNames: string[] = [];
      if (scope.value === 'specific') {
        const namesInput = await vscode.window.showInputBox({
          prompt: 'Enter comma-separated profile names to retrieve',
          placeHolder: 'e.g. Admin, Sales User, Custom Support',
        });
        if (!namesInput) return;
        profileNames = namesInput.split(',').map((s) => s.trim()).filter(Boolean);
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `PermForge: Connecting to ${targetOrg}...`,
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: 'Resolving authentication & listing profiles...' });
            const auth = orgService.resolveAuth(targetOrg);

            if (scope.value === 'all-custom') {
              const remoteProfiles = await orgService.listProfiles({ customOnly: true }, auth);
              profileNames = remoteProfiles.map((p) => p.name);
            }

            if (profileNames.length === 0) {
              vscode.window.showWarningMessage(`No matching profiles found in org ${targetOrg}.`);
              return;
            }

            progress.report({ message: `Retrieving ${profileNames.length} profiles via Metadata API...` });
            const retrieved = await orgService.retrieveProfiles(profileNames, auth);

            const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const config = vscode.workspace.getConfiguration('permforge');
            const targetDir = config.get<string>('profilesDirectory', 'force-app/main/default/profiles');
            const destDir = path.isAbsolute(targetDir) ? targetDir : path.join(rootPath, targetDir);

            await fs.mkdir(destDir, { recursive: true });
            const xmlEngine = new XmlEngine();
            for (const profile of retrieved) {
              const xml = xmlEngine.buildProfileXml(profile.metadata);
              const destPath = path.join(destDir, `${profile.name}.profile-meta.xml`);
              await fs.writeFile(destPath, xml, 'utf-8');
            }

            profilesProvider.refresh();
            const action = await vscode.window.showInformationMessage(
              `✔ Successfully retrieved ${retrieved.length} profiles from ${targetOrg}!`,
              'Open Migration Studio'
            );
            if (action === 'Open Migration Studio') {
              MigrationStudioPanel.createOrShow(context.extensionUri);
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(`Org retrieval failed: ${err.message}`);
          }
        }
      );
    })
  );

  // Command: Refresh Profiles
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.refreshProfiles', () => {
      profilesProvider.refresh();
      permSetsProvider.refresh();
    })
  );

  // Command: Analyze Profile
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.analyzeProfile', async (target?: ProfileTreeItem | vscode.Uri) => {
      let filePath: string | undefined;
      if (target instanceof vscode.Uri) {
        filePath = target.fsPath;
      } else if (target && target.profilePath) {
        filePath = target.profilePath;
      }

      if (!filePath) {
        vscode.window.showErrorMessage('No profile selected for analysis.');
        return;
      }

      const reader = new ProfileReader();
      const analyzer = new ProfileAnalyzer();
      try {
        const profile = await reader.loadProfile(filePath);
        const analysis = analyzer.analyzeProfile(profile);

        const riskSummary = analysis.highRiskPermissions.length > 0
          ? `\n⚠️ High-Risk Grants: ${analysis.highRiskPermissions.join(', ')}`
          : '';

        vscode.window.showInformationMessage(
          `PermForge Analysis for ${analysis.name}:\n` +
          `• Complexity Debt: ${analysis.complexityScore}/100\n` +
          `• SObjects: ${analysis.metrics.objectPermissionsCount} | FLS Fields: ${analysis.metrics.fieldPermissionsCount}\n` +
          `• System Perms: ${analysis.metrics.userPermissionsCount}${riskSummary}`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Analysis failed: ${err.message}`);
      }
    })
  );

  // Command: Decompose Profile
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.decomposeProfile', async (target?: ProfileTreeItem | vscode.Uri) => {
      let filePath: string | undefined;
      if (target instanceof vscode.Uri) {
        filePath = target.fsPath;
      } else if (target && target.profilePath) {
        filePath = target.profilePath;
      }

      if (!filePath) {
        vscode.window.showErrorMessage('No profile selected to decompose.');
        return;
      }

      const rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
      const config = vscode.workspace.getConfiguration('permforge');
      const outputDir = config.get<string>('outputDirectory', path.join(rootPath, 'force-app/main/default'));

      const reader = new ProfileReader();
      const decomposer = new ProfileDecomposer();

      try {
        const profile = await reader.loadProfile(filePath);
        const result = await decomposer.decompose(profile, { outputDir });

        vscode.window.showInformationMessage(
          `✔ Successfully decomposed ${profile.name} into ${result.permissionSets.length} domain Permission Sets and PSG ${result.permissionSetGroup?.apiName || `${profile.name}_PSG`}!`
        );

        profilesProvider.refresh();
        permSetsProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Decomposition failed: ${err.message}`);
      }
    })
  );

  // Command: Verify Parity
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.verifyParity', async (target?: ProfileTreeItem | vscode.Uri) => {
      let filePath: string | undefined;
      if (target instanceof vscode.Uri) {
        filePath = target.fsPath;
      } else if (target && target.profilePath) {
        filePath = target.profilePath;
      }

      MigrationStudioPanel.createOrShow(context.extensionUri, filePath, 'tab-matrix');
    })
  );

  // Command: Strip Profile
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.stripProfile', async (target?: ProfileTreeItem | vscode.Uri) => {
      let filePath: string | undefined;
      if (target instanceof vscode.Uri) {
        filePath = target.fsPath;
      } else if (target && target.profilePath) {
        filePath = target.profilePath;
      }

      if (!filePath) return;

      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to sanitize and strip permissions from ${path.basename(filePath)}? Layouts, IP ranges, and login hours will be preserved.`,
        { modal: true },
        'Sanitize Profile'
      );

      if (confirm === 'Sanitize Profile') {
        const stripper = new ProfileStripper();
        const reader = new ProfileReader();
        try {
          const profile = await reader.loadProfile(filePath);
          const result = await stripper.stripProfile(profile, {
            outputDir: path.dirname(filePath),
            inPlace: true,
          });
          vscode.window.showInformationMessage(
            `✔ Profile sanitized! Stripped ${result.strippedStats.userPermissionsRemoved} perms, ${result.strippedStats.objectPermissionsRemoved} objects, and ${result.strippedStats.fieldPermissionsRemoved} fields.`
          );
          profilesProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Sanitization failed: ${err.message}`);
        }
      }
    })
  );

  // Command: Cluster Profiles
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.clusterProfiles', async () => {
      MigrationStudioPanel.createOrShow(context.extensionUri, undefined, 'tab-cluster');
    })
  );

  // Command: Generate Visual HTML Report
  context.subscriptions.push(
    vscode.commands.registerCommand('permforge.generateReport', async () => {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace open to generate report.');
        return;
      }

      const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const config = vscode.workspace.getConfiguration('permforge');
      const customDir = config.get<string>('profilesDirectory', 'force-app/main/default/profiles');
      const searchTarget = path.isAbsolute(customDir) ? customDir : path.join(rootPath, customDir);

      const reader = new ProfileReader();
      const analyzer = new ProfileAnalyzer();
      const reporter = new HtmlReporter();

      try {
        let profiles = await reader.loadProfiles(searchTarget);
        if (profiles.length === 0) {
          profiles = await reader.loadProfiles(rootPath);
        }

        if (profiles.length === 0) {
          vscode.window.showWarningMessage('No profiles found in workspace to report on.');
          return;
        }

        const analyses = profiles.map((p) => analyzer.analyzeProfile(p));
        const reportPath = path.join(rootPath, 'permforge-audit-report.html');
        await reporter.generateReport(
          {
            analyses,
            generatedAt: new Date().toISOString(),
          },
          reportPath
        );

        const openDoc = await vscode.window.showInformationMessage(
          `✔ PermForge HTML Audit Report created at permforge-audit-report.html`,
          'Open in Browser'
        );

        if (openDoc === 'Open in Browser') {
          vscode.env.openExternal(vscode.Uri.file(reportPath));
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Report generation failed: ${err.message}`);
      }
    })
  );
}

export function deactivate() {}
