import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import { XmlEngine } from '../parser/xml-engine.js';
import { PermissionSetMetadata, PermissionSetGroupMetadata } from '../types/metadata.js';

export interface GraphNode {
  name: string;
  type: 'group' | 'permset' | 'sobject';
  children: string[];
}

export interface GraphData {
  groups: { name: string; metadata: PermissionSetGroupMetadata }[];
  permSets: { name: string; metadata: PermissionSetMetadata }[];
}

export class GraphBuilder {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
  }

  /**
   * Scan metadata directories and load all Permission Set Groups and Permission Sets.
   */
  public async loadGraphData(baseDir: string): Promise<GraphData> {
    const resolvedBase = path.resolve(baseDir);

    const psgFiles = await glob(
      path.join(resolvedBase, '**/permissionsetgroups/*.permissionsetgroup-meta.xml')
    );
    const psFiles = await glob(
      path.join(resolvedBase, '**/permissionsets/*.permissionset-meta.xml')
    );

    const groups: { name: string; metadata: PermissionSetGroupMetadata }[] = [];
    for (const f of psgFiles) {
      const content = await fs.readFile(f, 'utf-8');
      const name = path.basename(f).replace(/\.permissionsetgroup-meta\.xml$/, '');
      groups.push({
        name,
        metadata: this.xmlEngine.parsePermissionSetGroup(content),
      });
    }

    const permSets: { name: string; metadata: PermissionSetMetadata }[] = [];
    for (const f of psFiles) {
      const content = await fs.readFile(f, 'utf-8');
      const name = path.basename(f).replace(/\.permissionset-meta\.xml$/, '');
      permSets.push({
        name,
        metadata: this.xmlEngine.parsePermissionSet(content),
      });
    }

    return { groups, permSets };
  }

  /**
   * Generate Mermaid diagram markdown from graph data.
   */
  public generateMermaid(data: GraphData): string {
    const lines: string[] = ['flowchart TD'];

    if (data.groups.length > 0) {
      lines.push('    subgraph Groups ["Permission Set Groups"]');
      for (const g of data.groups) {
        lines.push(`        G_${this.sanitizeId(g.name)}["${g.name}"]`);
      }
      lines.push('    end\n');
    }

    if (data.permSets.length > 0) {
      lines.push('    subgraph PermSets ["Modular Permission Sets"]');
      for (const ps of data.permSets) {
        lines.push(`        PS_${this.sanitizeId(ps.name)}["${ps.name}"]`);
      }
      lines.push('    end\n');
    }

    const sobjectsSet = new Set<string>();
    for (const ps of data.permSets) {
      for (const obj of ps.metadata.objectPermissions || []) {
        sobjectsSet.add(obj.object);
      }
    }

    if (sobjectsSet.size > 0) {
      lines.push('    subgraph SObjects ["SObjects & Data"]');
      for (const sobj of Array.from(sobjectsSet).sort()) {
        lines.push(`        OBJ_${this.sanitizeId(sobj)}[("${sobj}")]`);
      }
      lines.push('    end\n');
    }

    // Connections from Group to PermSet
    for (const g of data.groups) {
      for (const member of g.metadata.permissionSets) {
        lines.push(`    G_${this.sanitizeId(g.name)} --> PS_${this.sanitizeId(member)}`);
      }
    }

    // Connections from PermSet to SObjects
    for (const ps of data.permSets) {
      for (const obj of ps.metadata.objectPermissions || []) {
        lines.push(`    PS_${this.sanitizeId(ps.name)} --> OBJ_${this.sanitizeId(obj.object)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate an ASCII tree for terminal display.
   */
  public generateAsciiTree(data: GraphData): string {
    const lines: string[] = [];
    const psMap = new Map(data.permSets.map((p) => [p.name, p.metadata]));

    for (const g of data.groups) {
      lines.push(`📦 [PSG] ${g.name}`);
      const members = g.metadata.permissionSets;
      members.forEach((m, idx) => {
        const isLastM = idx === members.length - 1;
        const branchM = isLastM ? '└── ' : '├── ';
        lines.push(`    ${branchM}🔑 [PS] ${m}`);

        const psMeta = psMap.get(m);
        const objs = (psMeta?.objectPermissions || []).map((o) => o.object);
        objs.forEach((o, oIdx) => {
          const indent = isLastM ? '        ' : '│   ';
          const isLastO = oIdx === objs.length - 1;
          const branchO = isLastO ? '└── ' : '├── ';
          lines.push(`    ${indent}${branchO}📄 ${o}`);
        });
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  private sanitizeId(str: string): string {
    return str.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}
