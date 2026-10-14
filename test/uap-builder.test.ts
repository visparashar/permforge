import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { UapBuilder } from '../src/engine/uap-builder.js';

describe('UapBuilder', () => {
  const testOutputDir = path.join(process.cwd(), 'tmp-uap-test');
  const builder = new UapBuilder();

  beforeEach(async () => {
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testOutputDir, { recursive: true, force: true });
  });

  it('should generate valid UserAccessPolicy metadata', async () => {
    const result = await builder.generateUap({
      name: 'Sales_Auto_Assign',
      psgName: 'Sales_User_PSG',
      predicates: [{ field: 'Department', operator: 'Equals', value: 'Sales' }],
      outputDir: testOutputDir,
    });

    expect(await fs.stat(result.filePath)).toBeDefined();
    const content = await fs.readFile(result.filePath, 'utf-8');
    expect(content).toContain('<UserAccessPolicy xmlns="http://soap.sforce.com/2006/04/metadata">');
    expect(content).toContain('<target>Sales_User_PSG</target>');
    expect(content).toContain('<field>Department</field>');
    expect(content).toContain('<value>Sales</value>');
  });
});
