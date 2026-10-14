import * as core from '@actions/core';
import { PermForgeGateRunner, GateOptions } from './gate-runner.js';

function getBoolean(name: string, defaultValue: boolean): boolean {
  const val = core.getInput(name);
  if (!val) return defaultValue;
  return val.toLowerCase() === 'true';
}

async function run(): Promise<void> {
  try {
    const profilesDir = core.getInput('profiles-directory') || 'force-app/main/default/profiles';
    const outputDir = core.getInput('output-directory') || 'force-app/main/default';
    const strictParity = getBoolean('strict-parity', true);
    const blockProfilePermissions = getBoolean('block-profile-permissions', true);
    const maxComplexityScore = parseInt(core.getInput('max-complexity-score') || '75', 10);
    const failOnRisk = getBoolean('fail-on-risk', false);
    const postPrComment = getBoolean('post-pr-comment', true);
    const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN;

    core.info(`🛡️ PermForge Security & Parity Gate starting...`);
    core.info(`• Profiles Directory: ${profilesDir}`);
    core.info(`• Strict Parity Gate: ${strictParity}`);
    core.info(`• Block Profile Permissions: ${blockProfilePermissions}`);
    core.info(`• Max Complexity Score: ${maxComplexityScore}`);

    const options: GateOptions = {
      profilesDir,
      outputDir,
      strictParity,
      blockProfilePermissions,
      maxComplexityScore,
      failOnRisk,
      postPrComment,
      githubToken,
    };

    const runner = new PermForgeGateRunner();
    const result = await runner.runGate(options);

    // Set outputs
    core.setOutput('passed', result.passed);
    core.setOutput('profiles-scanned', result.totalProfilesScanned);
    core.setOutput('permission-creep-count', result.totalPermissionCreep);
    core.setOutput('parity-failures', result.parityFailureCount);
    core.setOutput('average-complexity-debt', result.averageComplexityDebt);

    if (!result.passed) {
      core.setFailed(`PermForge Security Gate failed due to policy violations or parity discrepancies.`);
    } else {
      core.info(`✔ PermForge Security Gate passed successfully!`);
    }
  } catch (error: any) {
    core.setFailed(`PermForge Gate execution error: ${error.message}`);
  }
}

run();
