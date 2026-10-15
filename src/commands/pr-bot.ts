import * as fs from 'node:fs';
import { Command, Flags } from '@oclif/core';
import pc from 'picocolors';
import { ProfileReader, LoadedProfile } from '../parser/profile-reader.js';
import { PrBotEngine } from '../engine/pr-bot-engine.js';

export default class PrBot extends Command {
  static override description =
    'Analyze Pull Request permission changes, generate visual GitHub PR review comment with risk diffs, and post to GitHub Actions';

  static override aliases = ['pr-review'];

  static override examples = [
    '<%= config.bin %> pr-bot --source force-app/main/default/profiles',
    '<%= config.bin %> pr-bot --source force-app/main/default/profiles --base main-branch/profiles',
    '<%= config.bin %> pr-bot --source force-app/main/default/profiles --post --pr-number 42 --repo myorg/myrepo',
    '<%= config.bin %> pr-bot --source force-app/main/default/profiles --fail-on-risk',
    '<%= config.bin %> pr-bot --json',
  ];

  static override flags = {
    source: Flags.string({
      char: 's',
      description: 'Path to profile file, directory, or glob pattern modified in the PR',
      default: 'force-app/main/default/profiles',
    }),
    base: Flags.string({
      char: 'b',
      description: 'Path to base branch profiles directory or file for delta drift comparison',
    }),
    'pr-number': Flags.integer({
      description: 'GitHub Pull Request number',
      env: 'GITHUB_PR_NUMBER',
    }),
    repo: Flags.string({
      description: 'GitHub repository (owner/repo)',
      env: 'GITHUB_REPOSITORY',
    }),
    token: Flags.string({
      description: 'GitHub personal access token or GITHUB_TOKEN',
      env: 'GITHUB_TOKEN',
    }),
    'output-file': Flags.string({
      char: 'o',
      description: 'File path to save the generated Markdown PR comment',
      default: 'pr-review-comment.md',
    }),
    post: Flags.boolean({
      description: 'Post the review comment directly to the GitHub PR via API',
      default: false,
    }),
    'fail-on-risk': Flags.boolean({
      description: 'Exit with non-zero exit code if critical security risks are introduced',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Format output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(PrBot);

    const reader = new ProfileReader();
    const bot = new PrBotEngine();

    const profiles = await reader.loadProfiles(flags.source);
    if (profiles.length === 0) {
      this.error(pc.red(`No profile metadata found at path: ${flags.source}`));
    }

    let baseProfiles: LoadedProfile[] | undefined;
    if (flags.base && fs.existsSync(flags.base)) {
      baseProfiles = await reader.loadProfiles(flags.base);
    }

    const review = bot.generatePrReview(profiles, {
      baseProfiles,
      outputFile: flags['output-file'],
      prNumber: flags['pr-number'],
      repo: flags.repo,
    });

    if (flags.json) {
      this.log(JSON.stringify(review, null, 2));
      if (flags['fail-on-risk'] && review.hasCriticalRisks) {
        this.exit(1);
      }
      return;
    }

    this.log(pc.bold(pc.cyan('\n🤖 PermForge GitHub Actions PR Bot')));
    this.log(pc.bold(pc.yellow('═══════════════════════════════════════════════════════════')));
    this.log(`Impacted Profiles:  ${pc.bold(String(review.impactedProfiles.length))} (${review.impactedProfiles.join(', ')})`);
    this.log(`Security Violations:${review.totalViolations > 0 ? pc.yellow(` ${review.totalViolations}`) : pc.green(' 0')}`);
    this.log(`Critical Risks:     ${review.hasCriticalRisks ? pc.bgRed(pc.white(' DETECTED ')) : pc.green('None')}`);
    this.log(`Saved Comment File: ${pc.cyan(flags['output-file'])}\n`);

    if (flags.post) {
      if (!flags.token || !flags.repo || !flags['pr-number']) {
        this.warn(pc.yellow('Skipping GitHub API post: --token, --repo, and --pr-number must all be provided.'));
      } else {
        this.log(pc.dim(`Posting PR review comment to https://github.com/${flags.repo}/pull/${flags['pr-number']}...`));
        try {
          const res = await bot.postCommentToGitHub(flags.token, flags.repo, flags['pr-number'], review.markdownComment);
          this.log(pc.green(`✔ Successfully posted comment: ${res.html_url}`));
        } catch (err: any) {
          this.error(pc.red(`Failed to post comment to GitHub: ${err.message}`));
        }
      }
    } else {
      this.log(pc.dim(`Tip: Pass --post with GITHUB_TOKEN & GITHUB_REPOSITORY to publish directly to the PR.`));
    }

    if (flags['fail-on-risk'] && review.hasCriticalRisks) {
      this.error(pc.red('\n❌ PR Review failed: Critical security permissions detected in PR metadata changes.'));
    }
  }
}
