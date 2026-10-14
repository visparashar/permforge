import * as vscode from 'vscode';
import * as path from 'node:path';
import { ProfileReader, LoadedProfile, ProfileAnalyzer, ProfileAnalysis } from 'permforge';

export class ProfileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly profilePath?: string,
    public readonly analysis?: ProfileAnalysis,
    public readonly loadedProfile?: LoadedProfile,
    public readonly itemType: 'profile' | 'category' | 'detail' | 'risk' = 'profile'
  ) {
    super(label, collapsibleState);

    this.contextValue = itemType;

    if (itemType === 'profile' && analysis && profilePath) {
      this.resourceUri = vscode.Uri.file(profilePath);
      const score = analysis.complexityScore;
      const riskCount = analysis.highRiskPermissions.length;

      let badge = '🟢 Low';
      if (score >= 70) badge = '🔴 High';
      else if (score >= 40) badge = '🟡 Med';

      this.description = `${badge} (${score}/100) • ${analysis.metrics.objectPermissionsCount} Objs • ${analysis.metrics.fieldPermissionsCount} FLS`;
      this.tooltip = new vscode.MarkdownString(
        `### ${analysis.name}\n` +
        `- **Complexity Debt:** ${score}/100\n` +
        `- **Objects:** ${analysis.metrics.objectPermissionsCount}\n` +
        `- **Field Permissions (FLS):** ${analysis.metrics.fieldPermissionsCount}\n` +
        `- **System User Perms:** ${analysis.metrics.userPermissionsCount}\n` +
        `- **High-Risk Flags:** ${riskCount > 0 ? `⚠️ ${analysis.highRiskPermissions.join(', ')}` : 'None'}\n\n` +
        `*Click to Open in PermForge Studio*`
      );

      this.iconPath = new vscode.ThemeIcon(
        riskCount > 0 ? 'shield' : 'file-code',
        riskCount > 0 ? new vscode.ThemeColor('errorForeground') : undefined
      );

      this.command = {
        command: 'permforge.openStudio',
        title: 'Open in PermForge Studio',
        arguments: [profilePath],
      };
    } else if (itemType === 'risk') {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
    } else if (itemType === 'category') {
      this.iconPath = new vscode.ThemeIcon('folder');
    } else if (itemType === 'detail') {
      this.iconPath = new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class ProfilesTreeProvider implements vscode.TreeDataProvider<ProfileTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ProfileTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ProfileTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ProfileTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private reader = new ProfileReader();
  private analyzer = new ProfileAnalyzer();
  private loadedProfiles: LoadedProfile[] = [];
  private analyses: Map<string, ProfileAnalysis> = new Map();

  constructor() {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ProfileTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ProfileTreeItem): Promise<ProfileTreeItem[]> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return [new ProfileTreeItem('No workspace opened', vscode.TreeItemCollapsibleState.None)];
    }

    // Root level: return all discovered profiles
    if (!element) {
      return this.loadRootProfiles();
    }

    // Children level: expand details for a selected profile
    if (element.itemType === 'profile' && element.analysis && element.loadedProfile) {
      return this.getProfileDetails(element.analysis, element.loadedProfile);
    }

    return [];
  }

  private async loadRootProfiles(): Promise<ProfileTreeItem[]> {
    const config = vscode.workspace.getConfiguration('permforge');
    const customDir = config.get<string>('profilesDirectory', 'force-app/main/default/profiles');
    const rootPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const searchTarget = path.isAbsolute(customDir) ? customDir : path.join(rootPath, customDir);

    try {
      this.loadedProfiles = await this.reader.loadProfiles(searchTarget);

      // If nothing found in configured dir, fallback to general workspace glob
      if (this.loadedProfiles.length === 0) {
        this.loadedProfiles = await this.reader.loadProfiles(rootPath);
      }

      if (this.loadedProfiles.length === 0) {
        return [
          new ProfileTreeItem(
            'No Profile files found in workspace',
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      this.analyses.clear();
      return this.loadedProfiles.map((p) => {
        const analysis = this.analyzer.analyzeProfile(p);
        this.analyses.set(p.filePath, analysis);
        return new ProfileTreeItem(
          p.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          p.filePath,
          analysis,
          p,
          'profile'
        );
      });
    } catch (err: any) {
      return [
        new ProfileTreeItem(`Error scanning: ${err.message}`, vscode.TreeItemCollapsibleState.None),
      ];
    }
  }

  private getProfileDetails(analysis: ProfileAnalysis, profile: LoadedProfile): ProfileTreeItem[] {
    const items: ProfileTreeItem[] = [];

    // Objects category
    items.push(
      new ProfileTreeItem(
        `Objects: ${analysis.metrics.objectPermissionsCount} grants`,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        undefined,
        'detail'
      )
    );

    // FLS category
    items.push(
      new ProfileTreeItem(
        `Field Permissions (FLS): ${analysis.metrics.fieldPermissionsCount}`,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        undefined,
        'detail'
      )
    );

    // System Permissions
    items.push(
      new ProfileTreeItem(
        `System User Permissions: ${analysis.metrics.userPermissionsCount}`,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        undefined,
        'detail'
      )
    );

    // High Risk Flags
    if (analysis.highRiskPermissions.length > 0) {
      items.push(
        new ProfileTreeItem(
          `High-Risk Flags: ${analysis.highRiskPermissions.join(', ')}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          undefined,
          'risk'
        )
      );
    }

    return items;
  }

  public getProfileByPath(filePath: string): LoadedProfile | undefined {
    return this.loadedProfiles.find((p) => p.filePath === filePath);
  }

  public getAllProfiles(): LoadedProfile[] {
    return this.loadedProfiles;
  }
}
