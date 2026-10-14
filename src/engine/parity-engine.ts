import { LoadedProfile } from '../parser/profile-reader.js';
import {
  ProfileMetadata,
  PermissionSetMetadata,
  ObjectPermission,
  FieldPermission,
} from '../types/metadata.js';
import { ParityReport, ParityMismatch } from '../types/decomposition.js';

export class ParityEngine {
  /**
   * Verify parity between an original profile and a collection of target permission sets.
   */
  public verifyParity(
    originalProfile: LoadedProfile,
    targetPermSets: PermissionSetMetadata[],
    groupName?: string
  ): ParityReport {
    const mismatches: ParityMismatch[] = [];
    const meta = originalProfile.metadata;

    // 1. Build aggregated target maps
    const targetObjects = new Map<string, ObjectPermission>();
    const targetFields = new Map<string, FieldPermission>();
    const targetUserPerms = new Set<string>();
    const targetClasses = new Set<string>();
    const targetCustomPerms = new Set<string>();
    const targetTabs = new Set<string>();

    for (const ps of targetPermSets) {
      // Objects (additive union)
      for (const obj of ps.objectPermissions || []) {
        const existing = targetObjects.get(obj.object) || {
          object: obj.object,
          allowCreate: false,
          allowRead: false,
          allowEdit: false,
          allowDelete: false,
          viewAllRecords: false,
          modifyAllRecords: false,
        };

        targetObjects.set(obj.object, {
          object: obj.object,
          allowCreate: existing.allowCreate || Boolean(obj.allowCreate),
          allowRead: existing.allowRead || Boolean(obj.allowRead),
          allowEdit: existing.allowEdit || Boolean(obj.allowEdit),
          allowDelete: existing.allowDelete || Boolean(obj.allowDelete),
          viewAllRecords: existing.viewAllRecords || Boolean(obj.viewAllRecords),
          modifyAllRecords: existing.modifyAllRecords || Boolean(obj.modifyAllRecords),
        });
      }

      // Fields (additive union)
      for (const f of ps.fieldPermissions || []) {
        const existing = targetFields.get(f.field) || {
          field: f.field,
          readable: false,
          editable: false,
        };

        targetFields.set(f.field, {
          field: f.field,
          readable: existing.readable || Boolean(f.readable),
          editable: existing.editable || Boolean(f.editable),
        });
      }

      // User permissions
      for (const u of ps.userPermissions || []) {
        if (u.enabled) targetUserPerms.add(u.name);
      }

      // Classes
      for (const c of ps.classAccesses || []) {
        if (c.enabled) targetClasses.add(c.apexClass);
      }

      // Custom Permissions
      for (const cp of ps.customPermissions || []) {
        if (cp.enabled) targetCustomPerms.add(cp.name);
      }

      // Tabs
      for (const t of ps.tabSettings || []) {
        if (t.visibility === 'Visible' || t.visibility === 'Available') {
          targetTabs.add(t.tab);
        }
      }
    }

    let totalOriginalChecks = 0;
    let matchedOriginalChecks = 0;

    // 2. Check Object Permissions Parity
    for (const origObj of meta.objectPermissions || []) {
      const perms: (keyof Omit<ObjectPermission, 'object'>)[] = [
        'allowRead',
        'allowCreate',
        'allowEdit',
        'allowDelete',
        'viewAllRecords',
        'modifyAllRecords',
      ];

      const targetObj = targetObjects.get(origObj.object);

      for (const p of perms) {
        if (origObj[p]) {
          totalOriginalChecks++;
          if (targetObj && targetObj[p]) {
            matchedOriginalChecks++;
          } else {
            mismatches.push({
              type: 'object',
              identifier: origObj.object,
              detail: `Missing '${p}' permission on object ${origObj.object}`,
              severity: 'missing',
            });
          }
        }
      }
    }

    // 3. Check Field Permissions Parity
    for (const origField of meta.fieldPermissions || []) {
      const targetField = targetFields.get(origField.field);

      if (origField.readable) {
        totalOriginalChecks++;
        if (targetField && targetField.readable) {
          matchedOriginalChecks++;
        } else {
          mismatches.push({
            type: 'field',
            identifier: origField.field,
            detail: `Missing 'readable' FLS permission on field ${origField.field}`,
            severity: 'missing',
          });
        }
      }

      if (origField.editable) {
        totalOriginalChecks++;
        if (targetField && targetField.editable) {
          matchedOriginalChecks++;
        } else {
          mismatches.push({
            type: 'field',
            identifier: origField.field,
            detail: `Missing 'editable' FLS permission on field ${origField.field}`,
            severity: 'missing',
          });
        }
      }
    }

    // 4. Check User Permissions Parity
    for (const origUser of meta.userPermissions || []) {
      if (origUser.enabled) {
        totalOriginalChecks++;
        if (targetUserPerms.has(origUser.name)) {
          matchedOriginalChecks++;
        } else {
          mismatches.push({
            type: 'userPermission',
            identifier: origUser.name,
            detail: `Missing system user permission '${origUser.name}'`,
            severity: 'missing',
          });
        }
      }
    }

    // 5. Check Apex Class Parity
    for (const origClass of meta.classAccesses || []) {
      if (origClass.enabled) {
        totalOriginalChecks++;
        if (targetClasses.has(origClass.apexClass)) {
          matchedOriginalChecks++;
        } else {
          mismatches.push({
            type: 'classAccess',
            identifier: origClass.apexClass,
            detail: `Missing Apex class access for '${origClass.apexClass}'`,
            severity: 'missing',
          });
        }
      }
    }

    // 6. Check Custom Permissions Parity
    for (const origCp of meta.customPermissions || []) {
      if (origCp.enabled) {
        totalOriginalChecks++;
        if (targetCustomPerms.has(origCp.name)) {
          matchedOriginalChecks++;
        } else {
          mismatches.push({
            type: 'customPermission',
            identifier: origCp.name,
            detail: `Missing Custom Permission '${origCp.name}'`,
            severity: 'missing',
          });
        }
      }
    }

    const parityScore =
      totalOriginalChecks === 0
        ? 100
        : Math.round((matchedOriginalChecks / totalOriginalChecks) * 1000) / 10;

    const missingMismatches = mismatches.filter((m) => m.severity === 'missing');

    return {
      profileName: originalProfile.name,
      targetGroupName: groupName,
      targetPermissionSets: targetPermSets.map((p) => p.label),
      is100PercentMatch: missingMismatches.length === 0,
      parityScore,
      totalOriginalPermissions: totalOriginalChecks,
      totalTargetPermissions: matchedOriginalChecks,
      mismatches,
      summary: {
        objectsMatch: !mismatches.some((m) => m.type === 'object'),
        fieldsMatch: !mismatches.some((m) => m.type === 'field'),
        userPermissionsMatch: !mismatches.some((m) => m.type === 'userPermission'),
        apexMatch: !mismatches.some((m) => m.type === 'classAccess'),
        tabsMatch: !mismatches.some((m) => m.type === 'tab'),
      },
    };
  }
}
