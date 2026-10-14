import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { ProfileReader, LoadedProfile } from '../parser/profile-reader.js';
import { ProfileAnalyzer } from './analyzer.js';
import { ProfileDecomposer } from './decomposer.js';
import { ParityEngine } from './parity-engine.js';
import { ClusterEngine } from './cluster-engine.js';
import { ProfileStripper } from './profile-stripper.js';
import { UapBuilder } from './uap-builder.js';
import { RolloutPlanner } from './rollout-planner.js';
import { HtmlReporter } from './html-reporter.js';
import { SalesforceOrgService } from '../services/salesforce-org.js';
import {
  DecompositionStrategy,
  ProfileAnalysis,
  ParityReport,
  ClusterResult,
  GeneratedPermissionSet,
  GeneratedPermissionSetGroup,
} from '../types/decomposition.js';

export interface PipelineStageConfig {
  enabled?: boolean;
  [key: string]: any;
}

export interface PipelineConfig {
  sourceDir?: string;
  outputDir: string;
  strict?: boolean;
  dryRun?: boolean;
  targetOrg?: string;
  deploy?: boolean;
  profiles?: string[];
  stages?: {
    audit?: PipelineStageConfig;
    cluster?: PipelineStageConfig & { threshold?: number; baselineName?: string };
    decompose?: PipelineStageConfig & { strategy?: DecompositionStrategy };
    verify?: PipelineStageConfig & { minParityPercent?: number };
    strip?: PipelineStageConfig & { inPlace?: boolean };
    uap?: PipelineStageConfig;
    plan?: PipelineStageConfig;
    report?: PipelineStageConfig & { reportPath?: string };
  };
}

export interface PipelineStageResult {
  stage: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  message: string;
  data?: any;
}

export interface PipelineExecutionResult {
  success: boolean;
  totalDurationMs: number;
  profilesProcessed: number;
  stages: PipelineStageResult[];
  summary: {
    totalPermissionSetsCreated: number;
    totalGroupsCreated: number;
    averageParityScore: number;
    allParityPassed: boolean;
    profilesSanitized: number;
    reportGenerated?: string;
  };
}

export class PipelineRunner {
  private reader: ProfileReader;
  private analyzer: ProfileAnalyzer;
  private decomposer: ProfileDecomposer;
  private parityEngine: ParityEngine;
  private clusterEngine: ClusterEngine;
  private stripper: ProfileStripper;
  private uapBuilder: UapBuilder;
  private rolloutPlanner: RolloutPlanner;
  private reporter: HtmlReporter;

  constructor() {
    this.reader = new ProfileReader();
    this.analyzer = new ProfileAnalyzer();
    this.decomposer = new ProfileDecomposer();
    this.parityEngine = new ParityEngine();
    this.clusterEngine = new ClusterEngine();
    this.stripper = new ProfileStripper();
    this.uapBuilder = new UapBuilder();
    this.rolloutPlanner = new RolloutPlanner();
    this.reporter = new HtmlReporter();
  }

  /**
   * Run the complete multi-stage profile migration pipeline.
   */
  public async runPipeline(config: PipelineConfig): Promise<PipelineExecutionResult> {
    const startTime = Date.now();
    const stageResults: PipelineStageResult[] = [];

    const strict = config.strict ?? false;
    const dryRun = config.dryRun ?? false;
    const outputDir = path.resolve(config.outputDir);

    let totalPermSets = 0;
    let totalGroups = 0;
    let allParityPassed = true;
    let parityScores: number[] = [];
    let profilesSanitized = 0;
    let reportGeneratedPath: string | undefined;

    const allGeneratedSets: GeneratedPermissionSet[] = [];
    const allGeneratedGroups: GeneratedPermissionSetGroup[] = [];

    // Discover profiles (from targetOrg or local sourceDir)
    let profiles: LoadedProfile[] = [];
    if (config.targetOrg) {
      try {
        const orgService = new SalesforceOrgService();
        let targetNames = config.profiles;
        if (!targetNames || targetNames.length === 0) {
          const all = await orgService.listProfiles(config.targetOrg, { customOnly: true });
          targetNames = all.filter((p) => p.custom).map((p) => p.name);
        }
        profiles = await orgService.retrieveProfiles(targetNames, config.targetOrg, {
          saveToDir: dryRun ? undefined : path.join(outputDir, 'profiles'),
        });
      } catch (err: any) {
        return {
          success: false,
          totalDurationMs: Date.now() - startTime,
          profilesProcessed: 0,
          stages: [
            {
              stage: 'discovery',
              status: 'FAILED',
              durationMs: Date.now() - startTime,
              message: `Could not retrieve profiles from target org '${config.targetOrg}': ${err.message}`,
            },
          ],
          summary: {
            totalPermissionSetsCreated: 0,
            totalGroupsCreated: 0,
            averageParityScore: 0,
            allParityPassed: false,
            profilesSanitized: 0,
          },
        };
      }
    } else if (config.sourceDir) {
      profiles = await this.reader.loadProfiles(config.sourceDir);
    }

    if (profiles.length === 0) {
      return {
        success: false,
        totalDurationMs: Date.now() - startTime,
        profilesProcessed: 0,
        stages: [
          {
            stage: 'discovery',
            status: 'FAILED',
            durationMs: Date.now() - startTime,
            message: config.targetOrg
              ? `No custom profiles found in target org '${config.targetOrg}'`
              : `No profiles found at: ${config.sourceDir}`,
          },
        ],
        summary: {
          totalPermissionSetsCreated: 0,
          totalGroupsCreated: 0,
          averageParityScore: 0,
          allParityPassed: false,
          profilesSanitized: 0,
        },
      };
    }

    let analyses: ProfileAnalysis[] = [];
    let parityReports: ParityReport[] = [];
    let clusteredResult: ClusterResult | undefined;

    // STAGE 1: Audit & Discovery
    const stageAuditStart = Date.now();
    if (config.stages?.audit?.enabled !== false) {
      analyses = profiles.map((p) => this.analyzer.analyzeProfile(p));
      const highRiskTotal = analyses.reduce((acc, a) => acc + a.highRiskPermissions.length, 0);
      const avgDebt = Math.round(
        analyses.reduce((acc, a) => acc + a.complexityScore, 0) / analyses.length
      );

      const hasRisk = highRiskTotal > 0 || avgDebt > 60;
      stageResults.push({
        stage: 'audit',
        status: hasRisk ? 'WARNING' : 'SUCCESS',
        durationMs: Date.now() - stageAuditStart,
        message: `Audited ${profiles.length} profiles. Avg Complexity: ${avgDebt}/100, High-Risk Flags: ${highRiskTotal}`,
        data: { analyses, highRiskTotal, avgDebt },
      });
    } else {
      stageResults.push({
        stage: 'audit',
        status: 'SKIPPED',
        durationMs: 0,
        message: 'Audit stage disabled in configuration.',
      });
    }

    // STAGE 2: Clustering (Cross-profile baseline)
    const stageClusterStart = Date.now();
    if (config.stages?.cluster?.enabled && profiles.length >= 2) {
      try {
        const threshold = config.stages.cluster.threshold ?? 0.75;
        const baseName = config.stages.cluster.baselineName ?? 'Standard_Employee_Baseline';

        clusteredResult = await this.clusterEngine.clusterProfiles(profiles, {
          threshold,
          baselineName: baseName,
          outputDir: dryRun ? undefined : outputDir,
        });

        totalPermSets += 1 + clusteredResult.profileDeltas.reduce((acc, d) => acc + d.deltaPermissionSets.length, 0);
        totalGroups += clusteredResult.profileDeltas.filter((d) => d.permissionSetGroup).length;

        allGeneratedSets.push(clusteredResult.baselinePermissionSet);
        for (const delta of clusteredResult.profileDeltas) {
          allGeneratedSets.push(...delta.deltaPermissionSets);
          if (delta.permissionSetGroup) allGeneratedGroups.push(delta.permissionSetGroup);
        }

        stageResults.push({
          stage: 'cluster',
          status: 'SUCCESS',
          durationMs: Date.now() - stageClusterStart,
          message: `Clustered ${profiles.length} profiles into 1 baseline (${baseName}) and ${clusteredResult.profileDeltas.length} role deltas.`,
          data: clusteredResult,
        });
      } catch (err: any) {
        stageResults.push({
          stage: 'cluster',
          status: 'FAILED',
          durationMs: Date.now() - stageClusterStart,
          message: `Clustering error: ${err.message}`,
        });
        if (strict) {
          return this.buildResult(false, startTime, profiles.length, stageResults, totalPermSets, totalGroups, parityScores, allParityPassed, profilesSanitized);
        }
      }
    } else {
      stageResults.push({
        stage: 'cluster',
        status: 'SKIPPED',
        durationMs: 0,
        message: profiles.length < 2 ? 'Requires at least 2 profiles to cluster.' : 'Clustering stage disabled.',
      });
    }

    // STAGE 3: Decomposition (If not already clustered)
    const stageDecompStart = Date.now();
    if (!clusteredResult && config.stages?.decompose?.enabled !== false) {
      try {
        for (const profile of profiles) {
          const result = await this.decomposer.decompose(profile, {
            outputDir: dryRun ? undefined as any : outputDir,
            strategy: config.stages?.decompose?.strategy ?? 'by-domain',
          });

          totalPermSets += result.permissionSets.length;
          if (result.permissionSetGroup) totalGroups += 1;

          allGeneratedSets.push(...result.permissionSets);
          if (result.permissionSetGroup) allGeneratedGroups.push(result.permissionSetGroup);

          // STAGE 4: Mathematical Parity Verification
          const report = this.parityEngine.verifyParity(
            profile,
            result.permissionSets.map((ps) => ps.metadata)
          );
          parityReports.push(report);
          parityScores.push(report.parityScore);

          if (!report.is100PercentMatch) {
            allParityPassed = false;
          }
        }

        stageResults.push({
          stage: 'decompose',
          status: 'SUCCESS',
          durationMs: Date.now() - stageDecompStart,
          message: `Decomposed ${profiles.length} profiles into ${totalPermSets} domain Permission Sets and ${totalGroups} PSGs.`,
        });
      } catch (err: any) {
        stageResults.push({
          stage: 'decompose',
          status: 'FAILED',
          durationMs: Date.now() - stageDecompStart,
          message: `Decomposition error: ${err.message}`,
        });
        if (strict) {
          return this.buildResult(false, startTime, profiles.length, stageResults, totalPermSets, totalGroups, parityScores, allParityPassed, profilesSanitized);
        }
      }
    } else if (clusteredResult) {
      // Verify clustered parity
      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        const delta = clusteredResult.profileDeltas[i];
        const allSets = [
          clusteredResult.baselinePermissionSet.metadata,
          ...delta.deltaPermissionSets.map((d) => d.metadata),
        ];
        const report = this.parityEngine.verifyParity(profile, allSets);
        parityReports.push(report);
        parityScores.push(report.parityScore);
        if (!report.is100PercentMatch) {
          allParityPassed = false;
        }
      }
      stageResults.push({
        stage: 'decompose',
        status: 'SKIPPED',
        durationMs: 0,
        message: 'Bypassed: profiles were modularized via clustering engine.',
      });
    }

    // STAGE 4: Parity Verification Gate
    const minParity = config.stages?.verify?.minParityPercent ?? 100;
    const avgParity = parityScores.length > 0
      ? Math.round(parityScores.reduce((a, b) => a + b, 0) / parityScores.length)
      : 100;

    const parityStatus = (avgParity >= minParity && allParityPassed) ? 'SUCCESS' : 'FAILED';
    stageResults.push({
      stage: 'verify',
      status: parityStatus,
      durationMs: 10,
      message: `Access Parity Audit: Avg ${avgParity}% (Required: ${minParity}%). 100% Match: ${allParityPassed}`,
      data: { parityReports, avgParity, allParityPassed },
    });

    if (strict && parityStatus === 'FAILED') {
      return this.buildResult(false, startTime, profiles.length, stageResults, totalPermSets, totalGroups, parityScores, allParityPassed, profilesSanitized);
    }

    // STAGE 5: Sanitization / Stripping
    const stageStripStart = Date.now();
    if (config.stages?.strip?.enabled && !dryRun) {
      try {
        const inPlace = config.stages.strip.inPlace ?? false;
        const stripOutputDir = inPlace ? undefined : path.join(outputDir, 'sanitized_profiles');

        for (const profile of profiles) {
          await this.stripper.stripProfile(profile, {
            outputDir: stripOutputDir,
            inPlace,
          });
          profilesSanitized++;
        }

        stageResults.push({
          stage: 'strip',
          status: 'SUCCESS',
          durationMs: Date.now() - stageStripStart,
          message: `Sanitized and stripped permissions from ${profilesSanitized} profiles. Layouts and IP ranges preserved.`,
        });
      } catch (err: any) {
        stageResults.push({
          stage: 'strip',
          status: 'FAILED',
          durationMs: Date.now() - stageStripStart,
          message: `Sanitization error: ${err.message}`,
        });
      }
    } else {
      stageResults.push({
        stage: 'strip',
        status: 'SKIPPED',
        durationMs: 0,
        message: dryRun ? 'Dry run enabled: no files modified.' : 'Sanitization stage disabled.',
      });
    }

    // STAGE 6: User Access Policy (UAP) Generator
    const stageUapStart = Date.now();
    if (config.stages?.uap?.enabled) {
      if (dryRun) {
        stageResults.push({
          stage: 'uap',
          status: 'SKIPPED',
          durationMs: 0,
          message: 'Dry run enabled: no UAP metadata written.',
        });
      } else {
        try {
          const uapDir = path.join(outputDir, 'userAccessPolicies');

          for (const profile of profiles) {
            const groupName = `${profile.name.replace(/[^a-zA-Z0-9_]/g, '_')}_PSG`;
            await this.uapBuilder.generateUap({
              name: `Auto_Assign_${profile.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
              label: `Auto Assign ${profile.name} Permissions`,
              description: `Automated User Access Policy generated by PermForge Pipeline for ${profile.name}`,
              psgName: groupName,
              outputDir: uapDir,
            });
          }

          stageResults.push({
            stage: 'uap',
            status: 'SUCCESS',
            durationMs: Date.now() - stageUapStart,
            message: `Generated ${profiles.length} User Access Policies for automated PSG assignment.`,
          });
        } catch (err: any) {
          stageResults.push({
            stage: 'uap',
            status: 'WARNING',
            durationMs: Date.now() - stageUapStart,
            message: `UAP generation notice: ${err.message}`,
          });
        }
      }
    } else {
      stageResults.push({
        stage: 'uap',
        status: 'SKIPPED',
        durationMs: 0,
        message: 'User Access Policy generation disabled.',
      });
    }

    // STAGE 7: Migration & Rollout Runbook Plan
    const stagePlanStart = Date.now();
    if (config.stages?.plan?.enabled) {
      if (dryRun) {
        stageResults.push({
          stage: 'plan',
          status: 'SKIPPED',
          durationMs: 0,
          message: 'Dry run enabled: no rollout plan files written.',
        });
      } else {
        try {
          const planDir = path.join(outputDir, 'migration_plan');
          for (const profile of profiles) {
            const groupName = `${profile.name.replace(/[^a-zA-Z0-9_]/g, '_')}_PSG`;
            await this.rolloutPlanner.generatePlan({
              profileName: profile.name,
              psgName: groupName,
              outputDir: planDir,
            });
          }

          stageResults.push({
            stage: 'plan',
            status: 'SUCCESS',
            durationMs: Date.now() - stagePlanStart,
            message: `Generated user assignment CSVs, rollback scripts, and SF CLI deploy sequences in ${path.relative(process.cwd(), path.join(outputDir, 'migration_plan'))}.`,
          });
        } catch (err: any) {
          stageResults.push({
            stage: 'plan',
            status: 'WARNING',
            durationMs: Date.now() - stagePlanStart,
            message: `Plan generation notice: ${err.message}`,
          });
        }
      }
    } else {
      stageResults.push({
        stage: 'plan',
        status: 'SKIPPED',
        durationMs: 0,
        message: 'Rollout plan generation disabled.',
      });
    }

    // STAGE 8: Executive HTML Audit Report
    const stageReportStart = Date.now();
    if (config.stages?.report?.enabled !== false) {
      if (dryRun) {
        stageResults.push({
          stage: 'report',
          status: 'SKIPPED',
          durationMs: 0,
          message: 'Dry run enabled: no report file written.',
        });
      } else {
        try {
          reportGeneratedPath = config.stages?.report?.reportPath
            ? path.resolve(config.stages.report.reportPath)
            : path.join(outputDir, 'permforge-migration-report.html');

          await this.reporter.generateReport(
            {
              analyses,
              parityReports,
              generatedAt: new Date().toISOString(),
            },
            reportGeneratedPath
          );

          stageResults.push({
            stage: 'report',
            status: 'SUCCESS',
            durationMs: Date.now() - stageReportStart,
            message: `Executive HTML Audit Report generated at: ${path.relative(process.cwd(), reportGeneratedPath)}`,
          });
        } catch (err: any) {
          stageResults.push({
            stage: 'report',
            status: 'WARNING',
            durationMs: Date.now() - stageReportStart,
            message: `Report generation notice: ${err.message}`,
          });
        }
      }
    } else {
      stageResults.push({
        stage: 'report',
        status: 'SKIPPED',
        durationMs: 0,
        message: 'HTML report generation disabled.',
      });
    }

    // STAGE 9: Target Org Deployment (Optional)
    const stageDeployStart = Date.now();
    if (config.deploy && config.targetOrg) {
      if (dryRun) {
        stageResults.push({
          stage: 'deploy',
          status: 'SKIPPED',
          durationMs: 0,
          message: `Dry run enabled: skipping deployment to live Salesforce org '${config.targetOrg}'.`,
        });
      } else if (!allParityPassed) {
        stageResults.push({
          stage: 'deploy',
          status: 'FAILED',
          durationMs: Date.now() - stageDeployStart,
          message: 'Deployment blocked: access parity is not 100%. Fix discrepancies before deploying.',
        });
      } else {
        try {
          const orgService = new SalesforceOrgService();
          const psResult = await orgService.deployPermissionSets(allGeneratedSets, config.targetOrg);
          const psgResult = await orgService.deployPermissionSetGroups(allGeneratedGroups, config.targetOrg);

          const hasErrors = psResult.errors.length > 0 || psgResult.errors.length > 0;
          stageResults.push({
            stage: 'deploy',
            status: hasErrors ? 'WARNING' : 'SUCCESS',
            durationMs: Date.now() - stageDeployStart,
            message: `Deployed ${psResult.created.length} Permission Sets and ${psgResult.created.length} PSGs to org '${config.targetOrg}'.` +
              (hasErrors ? ` (Errors: ${[...psResult.errors, ...psgResult.errors].join('; ')})` : ''),
          });
        } catch (err: any) {
          stageResults.push({
            stage: 'deploy',
            status: 'FAILED',
            durationMs: Date.now() - stageDeployStart,
            message: `Deployment failed: ${err.message}`,
          });
        }
      }
    }

    return this.buildResult(
      allParityPassed,
      startTime,
      profiles.length,
      stageResults,
      totalPermSets,
      totalGroups,
      parityScores,
      allParityPassed,
      profilesSanitized,
      reportGeneratedPath
    );
  }

  private buildResult(
    success: boolean,
    startTime: number,
    profilesProcessed: number,
    stages: PipelineStageResult[],
    totalPermSets: number,
    totalGroups: number,
    parityScores: number[],
    allParityPassed: boolean,
    profilesSanitized: number,
    reportGenerated?: string
  ): PipelineExecutionResult {
    const avgParity = parityScores.length > 0
      ? Math.round(parityScores.reduce((a, b) => a + b, 0) / parityScores.length)
      : 100;

    return {
      success,
      totalDurationMs: Date.now() - startTime,
      profilesProcessed,
      stages,
      summary: {
        totalPermissionSetsCreated: totalPermSets,
        totalGroupsCreated: totalGroups,
        averageParityScore: avgParity,
        allParityPassed,
        profilesSanitized,
        reportGenerated,
      },
    };
  }
}
