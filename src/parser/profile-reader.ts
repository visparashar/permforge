import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import { XmlEngine } from './xml-engine.js';
import { ProfileMetadata } from '../types/metadata.js';

export interface LoadedProfile {
  name: string;
  filePath: string;
  metadata: ProfileMetadata;
}

export class ProfileReader {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
  }

  /**
   * Load a single profile file.
   */
  public async loadProfile(filePath: string): Promise<LoadedProfile> {
    const resolvedPath = path.resolve(filePath);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const metadata = this.xmlEngine.parseProfile(content);
    const name = path.basename(resolvedPath).replace(/\.profile(-meta\.xml)?$/, '');

    return {
      name,
      filePath: resolvedPath,
      metadata,
    };
  }

  /**
   * Find and load all profiles matching a directory or glob pattern.
   */
  public async loadProfiles(sourcePattern: string): Promise<LoadedProfile[]> {
    let searchPattern = sourcePattern;

    try {
      const stats = await fs.stat(sourcePattern);
      if (stats.isDirectory()) {
        searchPattern = path.join(sourcePattern, '**/*.profile-meta.xml');
      }
    } catch {
      // pattern is already a glob or file that doesn't exist directly
    }

    const files = await glob(searchPattern, { nodir: true });
    const results: LoadedProfile[] = [];

    for (const file of files) {
      if (file.endsWith('.profile-meta.xml') || file.endsWith('.profile')) {
        try {
          const profile = await this.loadProfile(file);
          results.push(profile);
        } catch (err: any) {
          console.warn(`Warning: Could not parse profile at ${file}: ${err.message}`);
        }
      }
    }

    return results;
  }
}
