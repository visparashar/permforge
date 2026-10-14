import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { glob } from 'glob';
import { XmlEngine } from 'permforge';

export class PermSetTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly filePath?: string,
    public readonly itemType: 'psg' | 'permset' | 'info' = 'permset',
    public readonly childrenNames: string[] = []
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;

    if (filePath) {
      this.resourceUri = vscode.Uri.file(filePath);
    }

    if (itemType === 'psg') {
      this.iconPath = new vscode.ThemeIcon('layers');
      this.description = `Group (${childrenNames.length} sets)`;
      this.tooltip = `Permission Set Group: ${label}\nIncluded Sets: ${childrenNames.join(', ')}`;
    } else if (itemType === 'permset') {
      this.iconPath = new vscode.ThemeIcon('key');
      this.description = 'Permission Set';
    } else {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}

export class PermSetsTreeProvider implements vscode.TreeDataProvider<PermSetTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<PermSetTreeItem | undefined | null | void> =
    new vscode.EventEmitter<PermSetTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PermSetTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private xmlEngine = new XmlEngine();
  private psgMap: Map<string, { filePath: string; permSets: string[] }> = new Map();
  private standalonePermSets: string[] = [];

  constructor() {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: PermSetTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: PermSetTreeItem): Promise<PermSetTreeItem[]> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return [new PermSetTreeItem('No workspace opened', vscode.TreeItemCollapsibleState.None, undefined, 'info')];
    }

    const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;

    // Root level: return PSGs and standalone Permission Sets
    if (!element) {
      return this.loadRootElements(rootPath);
    }

    // Children level: if PSG, return constituent Permission Sets
    if (element.itemType === 'psg' && element.childrenNames.length > 0) {
      return element.childrenNames.map((name) => {
        return new PermSetTreeItem(name, vscode.TreeItemCollapsibleState.None, undefined, 'permset');
      });
    }

    return [];
  }

  private async loadRootElements(rootPath: string): Promise<PermSetTreeItem[]> {
    const items: PermSetTreeItem[] = [];

    try {
      // Find all PSGs
      const psgFiles = await glob(path.join(rootPath, '**/*.permissionsetgroup-meta.xml'), { nodir: true });
      this.psgMap.clear();

      for (const file of psgFiles) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const psg = this.xmlEngine.parsePermissionSetGroup(content);
          const name = path.basename(file).replace(/\.permissionsetgroup-meta\.xml$/, '');
          const permSets = psg.permissionSets || [];
          this.psgMap.set(name, { filePath: file, permSets });

          items.push(
            new PermSetTreeItem(
              name,
              permSets.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
              file,
              'psg',
              permSets
            )
          );
        } catch {
          // ignore corrupted or partial files
        }
      }

      // Find all Permission Sets
      const psFiles = await glob(path.join(rootPath, '**/*.permissionset-meta.xml'), { nodir: true });
      const includedInPsgs = new Set<string>();
      for (const entry of this.psgMap.values()) {
        entry.permSets.forEach((ps) => includedInPsgs.add(ps));
      }

      for (const file of psFiles) {
        const name = path.basename(file).replace(/\.permissionset-meta\.xml$/, '');
        // If not in a PSG, show at root
        if (!includedInPsgs.has(name)) {
          items.push(
            new PermSetTreeItem(name, vscode.TreeItemCollapsibleState.None, file, 'permset')
          );
        }
      }

      if (items.length === 0) {
        return [
          new PermSetTreeItem('No Permission Sets or Groups found', vscode.TreeItemCollapsibleState.None, undefined, 'info'),
        ];
      }

      return items;
    } catch (err: any) {
      return [
        new PermSetTreeItem(`Error loading permsets: ${err.message}`, vscode.TreeItemCollapsibleState.None, undefined, 'info'),
      ];
    }
  }
}
