import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrBotEngine } from '../src/engine/pr-bot-engine.js';
import { LoadedProfile } from '../src/parser/profile-reader.js';
import PrBot from '../src/commands/pr-bot.js';

describe('PrBotEngine', () => {
  let bot: PrBotEngine;
  const tempDir = path.join(process.cwd(), 'tmp-test-pr-bot');

  beforeEach(() => {
    bot = new PrBotEngine();
    vi.restoreAllMocks();
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const sampleProfile: LoadedProfile = {
    name: 'Sales_Rep',
    filePath: '/path/to/Sales_Rep.profile-meta.xml',
    metadata: {
      custom: true,
      userPermissions: [{ name: 'ApiEnabled', enabled: true }],
      objectPermissions: [
        {
          object: 'Opportunity',
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: false,
        },
      ],
      fieldPermissions: [{ field: 'Opportunity.Amount', readable: true, editable: true }],
    },
  };

  const riskyProfile: LoadedProfile = {
    name: 'Admin_Lead',
    filePath: '/path/to/Admin_Lead.profile-meta.xml',
    metadata: {
      custom: true,
      userPermissions: [
        { name: 'ModifyAllData', enabled: true },
        { name: 'AuthorApex', enabled: true },
      ],
      objectPermissions: [
        {
          object: 'Account',
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: true,
          modifyAllRecords: true,
        },
      ],
    },
  };

  const cleanProfile: LoadedProfile = {
    name: 'Clean_Sales_Rep',
    filePath: '/path/to/Clean_Sales_Rep.profile-meta.xml',
    metadata: {
      custom: true,
      layoutAssignments: [{ layout: 'Account-Account Layout' }],
    },
  };

  it('generates a clean PR review markdown comment for standard profiles', () => {
    const review = bot.generatePrReview([cleanProfile]);

    expect(review.hasCriticalRisks).toBe(false);
    expect(review.impactedProfiles).toEqual(['Clean_Sales_Rep']);
    expect(review.markdownComment).toContain('## 🛡️ PermForge Automated PR Security & Parity Review');
    expect(review.markdownComment).toContain('`Clean_Sales_Rep`');
    expect(review.markdownComment).toContain('PASSED: Permissions Clean & Aligned');
  });

  it('detects linter violations for legacy profile permissions', () => {
    const review = bot.generatePrReview([sampleProfile]);

    expect(review.hasCriticalRisks).toBe(false);
    expect(review.totalViolations).toBeGreaterThan(0);
    expect(review.markdownComment).toContain('Linter Violations Found');
    expect(review.markdownComment).toContain('objectPermissions');
  });

  it('flags critical security risks with GitHub alert callouts', () => {
    const review = bot.generatePrReview([riskyProfile]);

    expect(review.hasCriticalRisks).toBe(true);
    expect(review.markdownComment).toContain('SECURITY ALERT: Critical Privileges Detected');
    expect(review.markdownComment).toContain('> [!CAUTION]');
    expect(review.markdownComment).toContain('ModifyAllData');
    expect(review.markdownComment).toContain('AuthorApex');
  });

  it('writes markdown comment to disk when outputFile is specified', () => {
    const outFile = path.join(tempDir, 'pr-comment.md');
    const review = bot.generatePrReview([sampleProfile], {
      outputFile: outFile,
    });

    expect(fs.existsSync(outFile)).toBe(true);
    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toBe(review.markdownComment);
  });

  it('detects delta drift when base profiles are supplied', () => {
    const baseProfile: LoadedProfile = {
      name: 'Sales_Rep',
      filePath: '/path/to/base/Sales_Rep.profile-meta.xml',
      metadata: {
        custom: true,
        objectPermissions: [],
      },
    };

    const review = bot.generatePrReview([sampleProfile], {
      baseProfiles: [baseProfile],
    });

    expect(review.driftReports).toBeDefined();
    expect(review.driftReports).toHaveLength(1);
    expect(review.markdownComment).toContain('### 🔍 Environment & Branch Drift Analysis');
    expect(review.markdownComment).toContain('Opportunity');
  });

  it('posts comment to GitHub via REST API with valid credentials', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, html_url: 'https://github.com/myorg/myrepo/pull/1#issuecomment-12345' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await bot.postCommentToGitHub('ghp_test123', 'myorg/myrepo', 1, 'Test comment');
    expect(res.id).toBe(12345);
    expect(res.html_url).toContain('issuecomment-12345');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/myorg/myrepo/issues/1/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test123',
        }),
      })
    );
  });

  describe('PrBot CLI command', () => {
    it('executes pr-bot CLI and outputs JSON', async () => {
      const fixtureDir = path.join(__dirname, 'fixtures/profiles');

      let logged = '';
      const logSpy = vi.spyOn(PrBot.prototype, 'log').mockImplementation((m?: string) => {
        logged += (m || '') + '\n';
      });

      await PrBot.run(['--source', fixtureDir, '--json']);

      logSpy.mockRestore();
      expect(logged).toContain('"impactedProfiles"');
      expect(logged).toContain('"markdownComment"');
    });
  });
});
