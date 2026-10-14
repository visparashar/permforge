import { Command } from '@oclif/core';
import { startMcpServer } from '../mcp/server.js';

export default class Mcp extends Command {
  static override description =
    'Start the PermForge Model Context Protocol (MCP) server for AI coding assistants (Cursor, Claude Desktop, Antigravity, Cline, VS Code)';

  static override examples = ['<%= config.bin %> mcp', 'npx -y permforge mcp'];

  public async run(): Promise<void> {
    await startMcpServer();
  }
}
