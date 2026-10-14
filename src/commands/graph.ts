import * as fs from 'node:fs/promises';
import { Command, Flags } from '@oclif/core';
import pc from 'picocolors';
import { GraphBuilder } from '../engine/graph-builder.js';

export default class Graph extends Command {
  static override description =
    'Visualize permission architecture hierarchy and dependencies (PSG -> Permission Sets -> SObjects)';

  static override examples = [
    '<%= config.bin %> graph',
    '<%= config.bin %> graph --format mermaid',
    '<%= config.bin %> graph --format markdown --output PERMISSION_GRAPH.md',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Directory containing permissionsets and permissionsetgroups',
      default: 'force-app/main/default',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['tree', 'mermaid', 'markdown'],
      default: 'tree',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Optional file to write the graph output to',
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Graph);

    const builder = new GraphBuilder();
    const data = await builder.loadGraphData(flags.source);

    if (data.groups.length === 0 && data.permSets.length === 0) {
      this.warn(`No Permission Sets or Groups found under: ${flags.source}`);
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(data, null, 2));
      return;
    }

    let outputText = '';

    if (flags.format === 'mermaid') {
      outputText = builder.generateMermaid(data);
    } else if (flags.format === 'markdown') {
      const mermaidCode = builder.generateMermaid(data);
      outputText = `# Permission Architecture Graph\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n`;
    } else {
      outputText = builder.generateAsciiTree(data);
    }

    if (flags.output) {
      await fs.writeFile(flags.output, outputText, 'utf-8');
      this.log(pc.bold(pc.green(`✔ Permission architecture graph written to: ${flags.output}\n`)));
    } else {
      this.log(pc.bold(pc.cyan(`\n🕸️  Permission Architecture Graph:\n`)));
      this.log(outputText);
    }
  }
}
