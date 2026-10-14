import { LoadedProfile } from '../parser/profile-reader.js';

export interface LintViolation {
  profileName: string;
  filePath: string;
  type:
    | 'objectPermissions'
    | 'fieldPermissions'
    | 'userPermissions'
    | 'classAccesses'
    | 'customPermissions';
  identifier: string;
  message: string;
}

export interface LintReport {
  totalProfilesScanned: number;
  cleanProfilesCount: number;
  violatingProfilesCount: number;
  totalViolations: number;
  violations: LintViolation[];
}

export class ProfileLinter {
  /**
   * Lint profiles to detect deprecated permissions that violate the
   * zero-profile-permissions standard.
   */
  public lintProfiles(profiles: LoadedProfile[]): LintReport {
    const violations: LintViolation[] = [];
    let violatingProfiles = 0;

    for (const p of profiles) {
      const meta = p.metadata;
      let hasViolation = false;

      // Objects
      for (const obj of meta.objectPermissions || []) {
        hasViolation = true;
        violations.push({
          profileName: p.name,
          filePath: p.filePath,
          type: 'objectPermissions',
          identifier: obj.object,
          message: `Profile '${p.name}' contains objectPermissions for '${obj.object}'. Permissions must reside in Permission Sets.`,
        });
      }

      // Fields
      for (const f of meta.fieldPermissions || []) {
        hasViolation = true;
        violations.push({
          profileName: p.name,
          filePath: p.filePath,
          type: 'fieldPermissions',
          identifier: f.field,
          message: `Profile '${p.name}' contains fieldPermissions for '${f.field}'. FLS must reside in Permission Sets.`,
        });
      }

      // User Perms
      for (const u of meta.userPermissions || []) {
        if (u.enabled) {
          hasViolation = true;
          violations.push({
            profileName: p.name,
            filePath: p.filePath,
            type: 'userPermissions',
            identifier: u.name,
            message: `Profile '${p.name}' contains enabled userPermission '${u.name}'. System permissions must reside in Permission Sets.`,
          });
        }
      }

      // Classes
      for (const c of meta.classAccesses || []) {
        if (c.enabled) {
          hasViolation = true;
          violations.push({
            profileName: p.name,
            filePath: p.filePath,
            type: 'classAccesses',
            identifier: c.apexClass,
            message: `Profile '${p.name}' contains enabled classAccess for '${c.apexClass}'. Apex access must reside in Permission Sets.`,
          });
        }
      }

      if (hasViolation) {
        violatingProfiles++;
      }
    }

    return {
      totalProfilesScanned: profiles.length,
      cleanProfilesCount: profiles.length - violatingProfiles,
      violatingProfilesCount: violatingProfiles,
      totalViolations: violations.length,
      violations,
    };
  }
}
