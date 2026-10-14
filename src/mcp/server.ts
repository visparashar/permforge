import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { ProfileReader } from '../parser/profile-reader.js';
import { ProfileAnalyzer } from '../engine/analyzer.js';
import { ProfileDecomposer } from '../engine/decomposer.js';
import { ClusterEngine } from '../engine/cluster-engine.js';
import { ParityEngine } from '../engine/parity-engine.js';
import { ProfileStripper } from '../engine/profile-stripper.js';
import { ProfileLinter } from '../engine/profile-linter.js';
import { UapBuilder } from '../engine/uap-builder.js';
import { MuteBuilder } from '../engine/mute-builder.js';
import { GraphBuilder } from '../engine/graph-builder.js';
import { PipelineRunner } from '../engine/pipeline-runner.js';
import { XmlEngine } from '../parser/xml-engine.js';
import { DecompositionStrategy } from '../types/decomposition.js';

const TOOLS: Tool[] = [
  {
    name: 'permforge_analyze',
    description:
      'Audit and inventory Salesforce profiles to detect security risks (e.g. ModifyAllData, AuthorApex), inventory Object CRUD & Field FLS permissions, and compute a complexity score (0-100).',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Path to a profile file, directory, or glob pattern (defaults to force-app/main/default/profiles)',
        },
      },
    },
  },
  {
    name: 'permforge_decompose',
    description:
      'Decompose a legacy monolithic Salesforce profile into modular, domain-aligned Permission Sets and a Persona-based Permission Set Group (PSG) with 100% access parity guarantee.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Path to the profile XML file to decompose',
        },
        outputDir: {
          type: 'string',
          description:
            'Destination directory for generated permission sets and groups (e.g. force-app/main/default)',
        },
        strategy: {
          type: 'string',
          enum: ['by-domain', 'by-object', 'consolidated'],
          description: 'Decomposition strategy (defaults to by-domain)',
        },
        prefix: {
          type: 'string',
          description: 'Custom prefix for generated permission sets',
        },
        createGroup: {
          type: 'boolean',
          description: 'Whether to generate a matching Permission Set Group (defaults to true)',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'permforge_cluster',
    description:
      'Analyze multiple Salesforce profiles simultaneously, extract a shared Standard Baseline Permission Set for common permissions across the org, and generate persona delta sets and PSGs.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Path to profiles directory or glob pattern',
        },
        threshold: {
          type: 'number',
          description: 'Sharing threshold fraction (e.g. 0.75 for 75% sharing, default: 0.75)',
        },
        baselineName: {
          type: 'string',
          description:
            'API name for the extracted baseline Permission Set (default: Standard_Employee_Baseline)',
        },
        outputDir: {
          type: 'string',
          description: 'Output directory for generated metadata',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'permforge_verify',
    description:
      'Mathematically verify access and security parity between an original Profile and target Permission Sets / Permission Set Group to prove zero permissions are dropped.',
    inputSchema: {
      type: 'object',
      properties: {
        profilePath: {
          type: 'string',
          description: 'Path to the original source profile XML',
        },
        groupPath: {
          type: 'string',
          description: 'Path to the target Permission Set Group XML',
        },
        permsetsDir: {
          type: 'string',
          description:
            'Directory containing target permission sets (default: force-app/main/default/permissionsets)',
        },
      },
      required: ['profilePath'],
    },
  },
  {
    name: 'permforge_strip',
    description:
      'Sanitize and strip deprecated permissions (Object, Field FLS, User Perms, Apex) from a Profile, retaining only layout assignments, default record types, and credentials to comply with Salesforce profile sunset.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Path to profile file or directory',
        },
        outputDir: {
          type: 'string',
          description: 'Output directory for stripped profiles',
        },
        inPlace: {
          type: 'boolean',
          description: 'Whether to overwrite profiles in-place (defaults to false)',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'permforge_lint',
    description:
      'Lint profiles in CI/CD or PR reviews to enforce the zero-profile-permissions standard and flag any deprecated permissions still residing in profile metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Path to profiles directory or glob pattern',
        },
      },
    },
  },
  {
    name: 'permforge_uap',
    description:
      'Generate native Salesforce User Access Policy (UAP) metadata to automate continuous, zero-touch user provisioning when users are created or updated.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'DeveloperName for the User Access Policy',
        },
        group: {
          type: 'string',
          description: 'Target Permission Set Group to auto-assign',
        },
        criteria: {
          type: 'string',
          description:
            'Comma-separated Field=Value criteria pairs (e.g. "Department=Sales,UserType=Standard")',
        },
        outputDir: {
          type: 'string',
          description: 'Destination directory (defaults to force-app/main/default)',
        },
      },
      required: ['name', 'group'],
    },
  },
  {
    name: 'permforge_mute',
    description:
      'Generate a Muting Permission Set targeting a Permission Set Group to selectively restrict sensitive permissions (e.g. Delete) for junior or contractor roles.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'API name for the Muting Permission Set',
        },
        muteDeleteObjects: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of SObjects where Delete access will be muted',
        },
        muteUserPerms: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of User Permissions to mute (e.g. ModifyAllData)',
        },
        outputDir: {
          type: 'string',
          description: 'Destination directory (defaults to force-app/main/default)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'permforge_graph',
    description:
      'Visualize permission architecture hierarchy and dependencies (PSG -> Permission Sets -> SObjects) as a Mermaid diagram or ASCII tree.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Directory containing permissionsets and permissionsetgroups',
        },
        format: {
          type: 'string',
          enum: ['mermaid', 'tree', 'markdown'],
          description: 'Output format (default: mermaid)',
        },
      },
    },
  },
  {
    name: 'permforge_pipeline',
    description:
      'Execute the complete multi-stage profile migration pipeline: audit, cross-profile clustering, modular decomposition, mathematical parity proof, sanitization, User Access Policy (UAP) generation, and migration runbook rollout planning.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Path to profiles directory or glob pattern (defaults to force-app/main/default/profiles)',
        },
        outputDir: {
          type: 'string',
          description: 'Destination directory (defaults to force-app/main/default)',
        },
        cluster: {
          type: 'boolean',
          description: 'Enable cross-profile clustering to extract shared Standard Employee Baseline',
        },
        strip: {
          type: 'boolean',
          description: 'Sanitize source profiles by stripping migratable permissions',
        },
        strict: {
          type: 'boolean',
          description: 'Fail pipeline if parity < 100% or any stage fails',
        },
        dryRun: {
          type: 'boolean',
          description: 'Simulate without modifying files on disk',
        },
      },
    },
  },
];

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'permforge',
      version: '1.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const reader = new ProfileReader();
  const xmlEngine = new XmlEngine();
  const analyzer = new ProfileAnalyzer();
  const decomposer = new ProfileDecomposer(xmlEngine);
  const clusterEngine = new ClusterEngine(xmlEngine);
  const parityEngine = new ParityEngine();
  const stripper = new ProfileStripper(xmlEngine);
  const linter = new ProfileLinter();
  const uapBuilder = new UapBuilder();
  const muteBuilder = new MuteBuilder();
  const graphBuilder = new GraphBuilder(xmlEngine);
  const pipelineRunner = new PipelineRunner();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'permforge_analyze': {
          const source = (args.source as string) || 'force-app/main/default/profiles';
          const profiles = await reader.loadProfiles(source);
          const analyses = profiles.map((p) => analyzer.analyzeProfile(p));
          return {
            content: [{ type: 'text', text: JSON.stringify(analyses, null, 2) }],
          };
        }

        case 'permforge_decompose': {
          const source = args.source as string;
          const outputDir = (args.outputDir as string) || 'force-app/main/default';
          const strategy = (args.strategy as DecompositionStrategy) || 'by-domain';
          const prefix = args.prefix as string | undefined;
          const createGroup = args.createGroup !== false;

          const loaded = await reader.loadProfile(source);
          const result = await decomposer.decompose(loaded, {
            outputDir,
            strategy,
            prefix,
            createGroup,
          });

          // Check parity
          const parity = parityEngine.verifyParity(
            loaded,
            result.permissionSets.map((ps) => ps.metadata),
            result.permissionSetGroup?.apiName
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ...result, parityReport: parity }, null, 2),
              },
            ],
          };
        }

        case 'permforge_cluster': {
          const source = args.source as string;
          const threshold = typeof args.threshold === 'number' ? args.threshold : 0.75;
          const baselineName = (args.baselineName as string) || 'Standard_Employee_Baseline';
          const outputDir = (args.outputDir as string) || 'force-app/main/default';

          const profiles = await reader.loadProfiles(source);
          const result = await clusterEngine.clusterProfiles(profiles, {
            threshold,
            baselineName,
            outputDir,
            createGroups: true,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'permforge_verify': {
          const profilePath = args.profilePath as string;
          const groupPath = args.groupPath as string | undefined;
          const permsetsDir =
            (args.permsetsDir as string) || 'force-app/main/default/permissionsets';

          const loadedProfile = await reader.loadProfile(profilePath);
          const permSetsToVerify = [];
          let groupName: string | undefined;

          if (groupPath) {
            const groupContent = await fs.readFile(path.resolve(groupPath), 'utf-8');
            const groupMeta = xmlEngine.parsePermissionSetGroup(groupContent);
            groupName = path.basename(groupPath).replace(/\.permissionsetgroup(-meta\.xml)?$/, '');

            for (const psName of groupMeta.permissionSets) {
              const psPath = path.join(permsetsDir, `${psName}.permissionset-meta.xml`);
              try {
                const psContent = await fs.readFile(psPath, 'utf-8');
                permSetsToVerify.push(xmlEngine.parsePermissionSet(psContent));
              } catch {
                // file missing
              }
            }
          } else {
            const entries = await fs.readdir(path.resolve(permsetsDir));
            for (const entry of entries) {
              if (entry.endsWith('.permissionset-meta.xml')) {
                const psContent = await fs.readFile(path.join(permsetsDir, entry), 'utf-8');
                permSetsToVerify.push(xmlEngine.parsePermissionSet(psContent));
              }
            }
          }

          const report = parityEngine.verifyParity(loadedProfile, permSetsToVerify, groupName);
          return {
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          };
        }

        case 'permforge_strip': {
          const source = args.source as string;
          const outputDir = args.outputDir as string | undefined;
          const inPlace = Boolean(args.inPlace);

          const profiles = await reader.loadProfiles(source);
          const results = [];
          for (const p of profiles) {
            const res = await stripper.stripProfile(p, {
              outputDir,
              inPlace,
              createBackup: true,
            });
            results.push(res);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        }

        case 'permforge_lint': {
          const source = (args.source as string) || 'force-app/main/default/profiles';
          const profiles = await reader.loadProfiles(source);
          const report = linter.lintProfiles(profiles);
          return {
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          };
        }

        case 'permforge_uap': {
          const name = args.name as string;
          const group = args.group as string;
          const criteriaStr = args.criteria as string | undefined;
          const outputDir = (args.outputDir as string) || 'force-app/main/default';

          const predicates = [];
          if (criteriaStr) {
            const pairs = criteriaStr.split(',');
            for (const pair of pairs) {
              const [field, value] = pair.split('=').map((s) => s.trim());
              if (field && value) {
                predicates.push({ field, operator: 'Equals' as const, value });
              }
            }
          }

          const result = await uapBuilder.generateUap({
            name,
            psgName: group,
            predicates: predicates.length > 0 ? predicates : undefined,
            outputDir,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'permforge_mute': {
          const name = args.name as string;
          const muteDeleteObjects = (args.muteDeleteObjects as string[]) || [];
          const muteUserPerms = args.muteUserPerms as string[] | undefined;
          const outputDir = (args.outputDir as string) || 'force-app/main/default';

          const result = await muteBuilder.generateMutingPermissionSet({
            name,
            mutedObjects: muteDeleteObjects.map((obj) => ({ object: obj, muteDelete: true })),
            mutedUserPerms: muteUserPerms,
            outputDir,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'permforge_graph': {
          const source = (args.source as string) || 'force-app/main/default';
          const format = (args.format as string) || 'mermaid';

          const data = await graphBuilder.loadGraphData(source);
          let text = '';
          if (format === 'mermaid') {
            text = graphBuilder.generateMermaid(data);
          } else if (format === 'markdown') {
            text = `# Permission Architecture Graph\n\n\`\`\`mermaid\n${graphBuilder.generateMermaid(data)}\n\`\`\`\n`;
          } else {
            text = graphBuilder.generateAsciiTree(data);
          }

          return {
            content: [{ type: 'text', text }],
          };
        }

        case 'permforge_pipeline': {
          const source = (args.source as string) || 'force-app/main/default/profiles';
          const outputDir = (args.outputDir as string) || 'force-app/main/default';
          const cluster = Boolean(args.cluster);
          const strip = Boolean(args.strip);
          const strict = Boolean(args.strict);
          const dryRun = Boolean(args.dryRun);

          const result = await pipelineRunner.runPipeline({
            sourceDir: source,
            outputDir,
            strict,
            dryRun,
            stages: {
              audit: { enabled: true },
              cluster: { enabled: cluster, threshold: 0.75, baselineName: 'Standard_Employee_Baseline' },
              decompose: { enabled: true, strategy: 'by-domain' },
              verify: { enabled: true, minParityPercent: 100 },
              strip: { enabled: strip, inPlace: false },
              uap: { enabled: true },
              plan: { enabled: true },
              report: { enabled: true },
            },
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        default:
          throw new Error(`Unknown MCP tool: ${name}`);
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the PermForge MCP server over standard I/O (stdio).
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('PermForge MCP Server running on stdio');
}
