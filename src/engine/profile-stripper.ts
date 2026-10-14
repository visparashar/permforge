import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { XmlEngine } from '../parser/xml-engine.js';
import { LoadedProfile } from '../parser/profile-reader.js';
import { ProfileMetadata } from '../types/metadata.js';

export interface StripOptions {
  outputDir?: string;
  inPlace?: boolean;
  createBackup?: boolean;
}

export interface StripResult {
  profileName: string;
  outputPath: string;
  strippedStats: {
    objectPermissionsRemoved: number;
    fieldPermissionsRemoved: number;
    userPermissionsRemoved: number;
    classAccessesRemoved: number;
    customPermissionsRemoved: number;
  };
  preservedSettings: {
    layoutAssignmentsCount: number;
    recordTypesCount: number;
    hasLoginHours: boolean;
    loginIpRangesCount: number;
  };
}

export class ProfileStripper {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
  }

  /**
   * Strip all permissions from a profile, retaining only layout assignments,
   * credentials, login hours/ranges, and defaults.
   */
  public async stripProfile(profile: LoadedProfile, options: StripOptions): Promise<StripResult> {
    const meta = profile.metadata;

    const strippedStats = {
      objectPermissionsRemoved: meta.objectPermissions?.length || 0,
      fieldPermissionsRemoved: meta.fieldPermissions?.length || 0,
      userPermissionsRemoved: meta.userPermissions?.length || 0,
      classAccessesRemoved: meta.classAccesses?.length || 0,
      customPermissionsRemoved: meta.customPermissions?.length || 0,
    };

    const preservedSettings = {
      layoutAssignmentsCount: meta.layoutAssignments?.length || 0,
      recordTypesCount: meta.recordTypeVisibilities?.length || 0,
      hasLoginHours: Boolean(meta.loginHours),
      loginIpRangesCount: meta.loginIpRanges?.length || 0,
    };

    // Construct stripped profile metadata
    const cleanProfile: ProfileMetadata = {
      custom: meta.custom,
      description: meta.description
        ? `${meta.description} (Sanitized by PermForge: Permissions migrated to Permission Sets)`
        : 'Sanitized by PermForge: Permissions migrated to Permission Sets',
      userLicense: meta.userLicense,
      applicationVisibilities: meta.applicationVisibilities,
      layoutAssignments: meta.layoutAssignments,
      loginHours: meta.loginHours,
      loginIpRanges: meta.loginIpRanges,
      recordTypeVisibilities: meta.recordTypeVisibilities,
      tabVisibilities: meta.tabVisibilities,
      // Stripped clean:
      objectPermissions: undefined,
      fieldPermissions: undefined,
      userPermissions: undefined,
      classAccesses: undefined,
      pageAccesses: undefined,
      customPermissions: undefined,
    };

    let targetPath = profile.filePath;
    if (options.outputDir) {
      await fs.mkdir(options.outputDir, { recursive: true });
      targetPath = path.join(options.outputDir, path.basename(profile.filePath));
    }

    if (options.createBackup && (options.inPlace || targetPath === profile.filePath)) {
      const backupPath = `${profile.filePath}.bak`;
      await fs.copyFile(profile.filePath, backupPath);
    }

    const xml = this.xmlEngine.serializeProfile(cleanProfile);
    await fs.writeFile(targetPath, xml, 'utf-8');

    return {
      profileName: profile.name,
      outputPath: targetPath,
      strippedStats,
      preservedSettings,
    };
  }
}
