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
import { SalesforceOrgService } from '../services/salesforce-org.js';
import { ModernizationAdvisor } from '../engine/modernization-advisor.js';
import { LeastPrivilegeEngine } from '../engine/least-privilege-engine.js';
import { DriftEngine } from '../engine/drift-engine.js';
import { ComplianceEngine } from '../engine/compliance-engine.js';
import { PrBotEngine } from '../engine/pr-bot-engine.js';
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
    name: 'permforge_list_org_profiles',
    description:
      'Query and list all profiles available in an authenticated live Salesforce org via Tooling/SOQL API.',
    inputSchema: {
      type: 'object',
      properties: {
        targetOrg: {
          type: 'string',
          description: 'Salesforce org username or alias (defaults to default SFDX/SF org)',
        },
        customOnly: {
          type: 'boolean',
          description: 'Filter only custom profiles (default: true)',
        },
      },
    },
  },
  {
    name: 'permforge_retrieve_profiles',
    description:
      'Retrieve full profile XML metadata directly from an authenticated live Salesforce org via Metadata API.',
    inputSchema: {
      type: 'object',
      properties: {
        targetOrg: {
          type: 'string',
          description: 'Salesforce org username or alias (defaults to default SFDX/SF org)',
        },
        profiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of profile names to retrieve (e.g. ["Custom_Admin", "Sales_User"])',
        },
        outputDir: {
          type: 'string',
          description: 'Directory where retrieved .profile-meta.xml files should be saved',
        },
      },
    },
  },
  {
    name: 'permforge_pipeline',
    description:
      'Execute the complete multi-stage profile migration pipeline: audit, cross-profile clustering, modular decomposition, mathematical parity proof, sanitization, User Access Policy (UAP) generation, migration rollout planning, and optional target org deployment.',
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
        targetOrg: {
          type: 'string',
          description: 'Connect directly to a live Salesforce org (alias or username)',
        },
        deploy: {
          type: 'boolean',
          description: 'Deploy generated Permission Sets & PSGs to the live org upon completion',
        },
        profiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific profiles to process when targeting a live org',
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
  {
    name: 'permforge_assign_users',
    description:
      'Assign Salesforce users from legacy profiles to generated Permission Set Groups or Permission Sets with preview, dry-run simulation, and 1-click rollback file generation.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          description: 'Source Profile name (e.g. "Custom Admin")',
        },
        target: {
          type: 'string',
          description: 'Destination Permission Set Group or Permission Set name (e.g. "Custom_Admin_PSG")',
        },
        targetOrg: {
          type: 'string',
          description: 'Salesforce org username or alias (defaults to default SFDX/SF org)',
        },
        dryRun: {
          type: 'boolean',
          description: 'Simulate assignment without modifying the live org; returns planned assignments and skip counts',
          default: false,
        },
        allUsers: {
          type: 'boolean',
          description: 'Include inactive users (default: active users only)',
          default: false,
        },
        userFilter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of specific usernames or User IDs to assign',
        },
        outputDir: {
          type: 'string',
          description: 'Directory where the rollback manifest should be saved (defaults to output/rollbacks)',
        },
      },
      required: ['profile', 'target'],
    },
  },
  {
    name: 'permforge_rollback_assignment',
    description:
      'Roll back previously created Salesforce PermissionSetAssignment records using a PermForge rollback manifest JSON file.',
    inputSchema: {
      type: 'object',
      properties: {
        rollbackFile: {
          type: 'string',
          description: 'Path to the assignment-rollback-*.json file',
        },
        targetOrg: {
          type: 'string',
          description: 'Salesforce org username or alias (defaults to manifest targetOrg)',
        },
      },
      required: ['rollbackFile'],
    },
  },
  {
    name: 'permforge_advise_modernization',
    description:
      'Audit Salesforce profiles for Dynamic Forms readiness and decouple non-default Record Types into Permission Sets under Salesforce 2026 architecture.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Path to a profile file, directory, or glob pattern (defaults to force-app/main/default/profiles)',
        },
        decoupleRecordTypes: {
          type: 'boolean',
          description: 'Generate decoupled Permission Sets for non-default Record Types',
          default: false,
        },
        outputDir: {
          type: 'string',
          description: 'Destination directory for generated Permission Sets',
        },
      },
    },
  },
  {
    name: 'permforge_least_privilege_audit',
    description:
      'Audit profile permissions against Salesforce Event Monitoring logs to detect dormant access, compute an over-privilege score, and optionally generate least-privilege or muting permission sets.',
    inputSchema: {
      type: 'object',
      properties: {
        profilePath: {
          type: 'string',
          description: 'Path to source profile XML file',
        },
        eventsFile: {
          type: 'string',
          description: 'Path to Salesforce Event Monitoring CSV/JSON telemetry file',
        },
        eventsContent: {
          type: 'string',
          description: 'Raw CSV or JSON event telemetry content (alternative to eventsFile)',
        },
        mode: {
          type: 'string',
          enum: ['audit-only', 'prune', 'mute'],
          description: 'Remediation mode (defaults to audit-only)',
          default: 'audit-only',
        },
        outputDir: {
          type: 'string',
          description: 'Destination directory for generated permission sets (defaults to force-app/main/default)',
        },
        prunedName: {
          type: 'string',
          description: 'Custom API name for the generated pruned Permission Set',
        },
        mutingName: {
          type: 'string',
          description: 'Custom API name for the generated Muting Permission Set',
        },
      },
      required: ['profilePath'],
    },
  },
  {
    name: 'permforge_detect_drift',
    description:
      'Detect and analyze permission drift between environments, branches, or live Salesforce orgs (Object CRUD, FLS, Apex classes, and User Permissions).',
    inputSchema: {
      type: 'object',
      properties: {
        basePath: {
          type: 'string',
          description: 'Path to base profile XML file or profiles directory',
        },
        targetPath: {
          type: 'string',
          description: 'Path to target profile XML file or profiles directory',
        },
        reconcile: {
          type: 'boolean',
          description: 'Generate reconciliation Permission Set containing drifted permissions',
          default: false,
        },
        outputDir: {
          type: 'string',
          description: 'Destination directory for generated reconciliation Permission Sets',
        },
      },
      required: ['basePath', 'targetPath'],
    },
  },
  {
    name: 'permforge_compliance_audit',
    description:
      'Audit Salesforce profiles against SOC 2, HIPAA, and ISO 27001 regulatory frameworks to detect superuser risks, Segregation of Duties conflicts, and ePHI/PII exposure.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Path to profile file, directory, or glob pattern (defaults to force-app/main/default/profiles)',
        },
        framework: {
          type: 'string',
          enum: ['soc2', 'hipaa', 'iso27001', 'all'],
          description: 'Compliance framework to audit against (defaults to all)',
          default: 'all',
        },
        outputDir: {
          type: 'string',
          description: 'Destination directory for generated compliance evidence packages (HTML/CSV/Markdown)',
        },
        exportArtifacts: {
          type: 'boolean',
          description: 'Whether to write auditor evidence packages to disk',
          default: true,
        },
      },
    },
  },
  {
    name: 'permforge_pr_review',
    description:
      'Analyze Pull Request permission changes, generate automated GitHub Markdown review comment with risk diffs, complexity scores, and linter warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Path to profile file, directory, or glob pattern modified in the PR (defaults to force-app/main/default/profiles)',
        },
        base: {
          type: 'string',
          description: 'Path to base branch profiles directory or file for delta drift comparison',
        },
        outputFile: {
          type: 'string',
          description: 'File path to save the generated Markdown PR comment',
        },
      },
    },
  },
];

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'permforge',
      version: '2.0.0',
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
  const orgService = new SalesforceOrgService(xmlEngine);
  const advisor = new ModernizationAdvisor(xmlEngine);
  const leastPrivilegeEngine = new LeastPrivilegeEngine(xmlEngine, muteBuilder);
  const driftEngine = new DriftEngine(xmlEngine);
  const complianceEngine = new ComplianceEngine();
  const prBotEngine = new PrBotEngine(analyzer, linter, driftEngine);

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

        case 'permforge_list_org_profiles': {
          const targetOrg = args.targetOrg as string | undefined;
          const customOnly = args.customOnly !== false;
          const orgService = new SalesforceOrgService();
          const profiles = await orgService.listProfiles(targetOrg, { customOnly });
          return {
            content: [{ type: 'text', text: JSON.stringify(profiles, null, 2) }],
          };
        }

        case 'permforge_retrieve_profiles': {
          const targetOrg = args.targetOrg as string | undefined;
          const profileNames = (args.profiles as string[]) || [];
          const outputDir = (args.outputDir as string) || 'force-app/main/default/profiles';
          const orgService = new SalesforceOrgService();
          const profiles = await orgService.retrieveProfiles(profileNames, targetOrg, {
            saveToDir: outputDir,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    retrievedCount: profiles.length,
                    outputDir,
                    profiles: profiles.map((p) => p.name),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'permforge_pipeline': {
          const source = (args.source as string) || 'force-app/main/default/profiles';
          const outputDir = (args.outputDir as string) || 'force-app/main/default';
          const targetOrg = args.targetOrg as string | undefined;
          const deploy = Boolean(args.deploy);
          const profiles = args.profiles as string[] | undefined;
          const cluster = Boolean(args.cluster);
          const strip = Boolean(args.strip);
          const strict = Boolean(args.strict);
          const dryRun = Boolean(args.dryRun);

          const result = await pipelineRunner.runPipeline({
            sourceDir: source,
            outputDir,
            targetOrg,
            deploy,
            profiles,
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

        case 'permforge_assign_users': {
          const profile = args.profile as string;
          const target = args.target as string;
          const targetOrg = args.targetOrg as string | undefined;
          const dryRun = Boolean(args.dryRun);
          const allUsers = Boolean(args.allUsers);
          const userFilter = args.userFilter as string[] | undefined;
          const outputDir = args.outputDir as string | undefined;

          const plan = await orgService.planUserAssignments(profile, target, targetOrg, {
            activeOnly: !allUsers,
            userFilter,
          });

          if (dryRun) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ dryRun: true, plan }, null, 2),
                },
              ],
            };
          }

          const result = await orgService.executeUserAssignments(plan, targetOrg, {
            rollbackDir: outputDir,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'permforge_rollback_assignment': {
          const rollbackFile = args.rollbackFile as string;
          const targetOrg = args.targetOrg as string | undefined;

          const result = await orgService.rollbackUserAssignments(rollbackFile, targetOrg);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'permforge_advise_modernization': {
          const source = (args.source as string) || 'force-app/main/default/profiles';
          const decouple = Boolean(args.decoupleRecordTypes);
          const outputDir = args.outputDir as string | undefined;

          const profiles = await reader.loadProfiles(source);
          const advisories = profiles.map((p) =>
            advisor.analyzeDynamicFormsReadiness(p, {
              outputDir: decouple ? outputDir : undefined,
            })
          );

          return {
            content: [{ type: 'text', text: JSON.stringify(advisories, null, 2) }],
          };
        }

        case 'permforge_least_privilege_audit': {
          const profilePath = args.profilePath as string;
          const eventsFile = args.eventsFile as string | undefined;
          const eventsContent = args.eventsContent as string | undefined;
          const mode = (args.mode as 'audit-only' | 'prune' | 'mute') || 'audit-only';
          const outputDir = args.outputDir as string | undefined;
          const prunedName = args.prunedName as string | undefined;
          const mutingName = args.mutingName as string | undefined;

          let rawEvents = eventsContent;
          if (!rawEvents && eventsFile) {
            rawEvents = await fs.readFile(eventsFile, 'utf-8');
          }
          if (!rawEvents) {
            throw new Error(
              'Either eventsFile or eventsContent must be provided for least-privilege audit.'
            );
          }

          const profile = await reader.loadProfile(profilePath);
          const footprint = leastPrivilegeEngine.parseEvents(rawEvents);
          const report = await leastPrivilegeEngine.auditProfile(profile, footprint, {
            mode,
            outputDir,
            prunedName,
            mutingName,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          };
        }

        case 'permforge_detect_drift': {
          const basePath = args.basePath as string;
          const targetPath = args.targetPath as string;
          const reconcile = Boolean(args.reconcile);
          const outputDir = args.outputDir as string | undefined;

          const baseProfiles = await reader.loadProfiles(basePath);
          const targetProfiles = await reader.loadProfiles(targetPath);

          const driftResult = driftEngine.compareProfileCollections(baseProfiles, targetProfiles, {
            baseLabel: basePath,
            targetLabel: targetPath,
            generateReconciliation: reconcile,
            reconciliationOutputDir: outputDir,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(driftResult, null, 2) }],
          };
        }

        case 'permforge_compliance_audit': {
          const source = (args.source as string) || 'force-app/main/default/profiles';
          const framework = (args.framework as any) || 'all';
          const outputDir = args.outputDir as string | undefined;
          const exportArtifacts = args.exportArtifacts !== false;

          const profiles = await reader.loadProfiles(source);
          const report = complianceEngine.auditCompliance(profiles, {
            framework,
            outputDir,
            generateArtifacts: exportArtifacts,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          };
        }

        case 'permforge_pr_review': {
          const source = (args.source as string) || 'force-app/main/default/profiles';
          const base = args.base as string | undefined;
          const outputFile = args.outputFile as string | undefined;

          const profiles = await reader.loadProfiles(source);
          let baseProfiles: any[] | undefined;
          if (base) {
            baseProfiles = await reader.loadProfiles(base);
          }

          const review = prBotEngine.generatePrReview(profiles, {
            baseProfiles,
            outputFile,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(review, null, 2) }],
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
