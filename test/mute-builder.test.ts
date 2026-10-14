import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MuteBuilder } from '../src/engine/mute-builder.js';

describe('MuteBuilder', () => {
  const testOutputDir = path.join(process.cwd(), 'tmp-mute-test');
  const builder = new MuteBuilder();

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  it('should generate valid MutingPermissionSet metadata', async () => {
    const result = await builder.generateMutingPermissionSet({
      name: 'Sales_Junior_Mute',
      mutedObjects: [{ object: 'Account', muteDelete: true }],
      mutedUserPerms: ['ModifyAllData'],
      outputDir: testOutputDir,
    });

    expect(await fs.stat(result.filePath)).toBeDefined();
    const content = await fs.readFile(result.filePath, 'utf-8');
    expect(content).toContain(
      '<MutingPermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">'
    );
    expect(content).toContain('<object>Account</object>');
    expect(content).toContain('<allowDelete>true</allowDelete>');
    expect(content).toContain('<name>ModifyAllData</name>');
  });
});
