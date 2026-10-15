import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { createMcpServer } from '../src/mcp/server.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('PermForge MCP Server', () => {
  const server = createMcpServer();
  const fixturesDir = path.join(process.cwd(), 'test/fixtures/profiles');

  it('should initialize and register all PermForge MCP tools', async () => {
    // Invoke list tools handler directly
    const listHandler = (server as any)._requestHandlers.get(
      ListToolsRequestSchema.shape.method.value
    );
    expect(listHandler).toBeDefined();

    const response = await listHandler({ method: 'tools/list', params: {} });
    expect(response.tools).toBeDefined();
    expect(response.tools.length).toBeGreaterThanOrEqual(9);

    const toolNames = response.tools.map((t: any) => t.name);
    expect(toolNames).toContain('permforge_analyze');
    expect(toolNames).toContain('permforge_decompose');
    expect(toolNames).toContain('permforge_cluster');
    expect(toolNames).toContain('permforge_verify');
    expect(toolNames).toContain('permforge_strip');
    expect(toolNames).toContain('permforge_lint');
    expect(toolNames).toContain('permforge_uap');
    expect(toolNames).toContain('permforge_mute');
    expect(toolNames).toContain('permforge_graph');
    expect(toolNames).toContain('permforge_assign_users');
    expect(toolNames).toContain('permforge_rollback_assignment');
    expect(toolNames).toContain('permforge_advise_modernization');
    expect(toolNames).toContain('permforge_least_privilege_audit');
  });

  it('should execute permforge_analyze tool successfully', async () => {
    const callHandler = (server as any)._requestHandlers.get(
      CallToolRequestSchema.shape.method.value
    );
    expect(callHandler).toBeDefined();

    const response = await callHandler({
      method: 'tools/call',
      params: {
        name: 'permforge_analyze',
        arguments: {
          source: fixturesDir,
        },
      },
    });

    expect(response.isError).toBeFalsy();
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');

    const analyses = JSON.parse(response.content[0].text);
    expect(analyses.length).toBe(3);
    expect(analyses.some((a: any) => a.name === 'Sales_User')).toBe(true);
    expect(analyses.some((a: any) => a.name === 'Custom_Admin')).toBe(true);
  });

  it('should execute permforge_lint tool successfully', async () => {
    const callHandler = (server as any)._requestHandlers.get(
      CallToolRequestSchema.shape.method.value
    );

    const response = await callHandler({
      method: 'tools/call',
      params: {
        name: 'permforge_lint',
        arguments: {
          source: fixturesDir,
        },
      },
    });

    expect(response.isError).toBeFalsy();
    const report = JSON.parse(response.content[0].text);
    expect(report.totalProfilesScanned).toBe(3);
    expect(report.totalViolations).toBeGreaterThan(0);
  });

  it('should execute permforge_least_privilege_audit tool successfully', async () => {
    const callHandler = (server as any)._requestHandlers.get(
      CallToolRequestSchema.shape.method.value
    );

    const profilePath = path.join(fixturesDir, 'Sales_User.profile-meta.xml');
    const eventsPath = path.join(process.cwd(), 'test/fixtures/event_logs/sample_events.csv');

    const response = await callHandler({
      method: 'tools/call',
      params: {
        name: 'permforge_least_privilege_audit',
        arguments: {
          profilePath,
          eventsFile: eventsPath,
          mode: 'audit-only',
        },
      },
    });

    expect(response.isError).toBeFalsy();
    const auditReport = JSON.parse(response.content[0].text);
    expect(auditReport.profileName).toBe('Sales_User');
    expect(auditReport.totalPermissionsGranted).toBeGreaterThan(0);
    expect(auditReport.exercisedPermissionsCount).toBeGreaterThan(0);
    expect(auditReport.dormantPermissionsCount).toBeGreaterThan(0);
    expect(auditReport.overPrivilegeScore).toBeGreaterThan(0);
  });
});
