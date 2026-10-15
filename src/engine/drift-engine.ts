import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoadedProfile } from '../parser/profile-reader.js';
import {
  ProfileMetadata,
  PermissionSetMetadata,
  ObjectPermission,
  FieldPermission,
  UserPermission,
  ClassAccess,
  CustomPermission,
} from '../types/metadata.js';
import { GeneratedPermissionSet } from '../types/decomposition.js';
import { XmlEngine } from '../parser/xml-engine.js';

export type DriftType = 'ADDED' | 'REMOVED' | 'MODIFIED';
export type DriftSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface MetadataDriftItem {
  category: 'Object' | 'Field' | 'UserPermission' | 'ApexClass' | 'CustomPermission' | 'RecordType';
  name: string;
  type: DriftType;
  baseState: string;
  targetState: string;
  severity: DriftSeverity;
  details: string;
}

export interface ProfileDriftReport {
  profileName: string;
  baseLabel: string;
  targetLabel: string;
  hasDrift: boolean;
  totalDrifts: number;
  driftsByCategory: {
    objects: number;
    fields: number;
    userPermissions: number;
    classes: number;
    customPermissions: number;
    recordTypes: number;
  };
  overallSeverity: DriftSeverity;
  drifts: MetadataDriftItem[];
  reconciliationPermissionSet?: GeneratedPermissionSet;
}

export interface MultiProfileDriftReport {
  baseSource: string;
  targetSource: string;
  totalProfilesCompared: number;
  profilesWithDrift: number;
  totalDriftsFound: number;
  highestSeverity: DriftSeverity;
  reports: ProfileDriftReport[];
}

export interface DriftOptions {
  baseLabel?: string;
  targetLabel?: string;
  generateReconciliation?: boolean;
  reconciliationOutputDir?: string;
  reconciliationName?: string;
}

const CRITICAL_USER_PERMS = new Set([
  'ModifyAllData',
  'ViewAllData',
  'AuthorApex',
  'ManageUsers',
  'BulkApiHardDelete',
  'CustomizeApplication',
  'ModifyMetadata',
  'ManageRoles',
]);

export class DriftEngine {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
  }

  /**
   * Compare two loaded profiles (Base vs Target) and calculate detailed drift.
   */
  public compareProfiles(
    base: LoadedProfile,
    target: LoadedProfile,
    options?: DriftOptions
  ): ProfileDriftReport {
    return this.compareMetadata(
      base.metadata,
      target.metadata,
      base.name,
      options?.baseLabel || 'Base',
      options?.targetLabel || 'Target',
      options
    );
  }

  /**
   * Compare metadata between two profiles or permission sets.
   */
  public compareMetadata(
    baseMeta: ProfileMetadata,
    targetMeta: ProfileMetadata,
    entityName: string,
    baseLabel = 'Base',
    targetLabel = 'Target',
    options?: DriftOptions
  ): ProfileDriftReport {
    const drifts: MetadataDriftItem[] = [];

    // 1. SObject Permissions Drift
    const baseObjMap = new Map<string, ObjectPermission>();
    for (const op of (baseMeta.objectPermissions || []).filter(this.isObjectActive)) {
      baseObjMap.set(op.object, op);
    }

    const targetObjMap = new Map<string, ObjectPermission>();
    for (const op of (targetMeta.objectPermissions || []).filter(this.isObjectActive)) {
      targetObjMap.set(op.object, op);
    }

    const allObjects = new Set([...baseObjMap.keys(), ...targetObjMap.keys()]);
    for (const obj of allObjects) {
      const b = baseObjMap.get(obj);
      const t = targetObjMap.get(obj);

      if (!b && t) {
        const isCritical = Boolean(t.modifyAllRecords || t.viewAllRecords);
        const isHigh = Boolean(t.allowDelete);
        drifts.push({
          category: 'Object',
          name: obj,
          type: 'ADDED',
          baseState: 'No Access',
          targetState: this.describeObjectPerm(t),
          severity: isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : 'MEDIUM',
          details: `Object '${obj}' was added in ${targetLabel} with ${this.describeObjectPerm(t)}.`,
        });
      } else if (b && !t) {
        drifts.push({
          category: 'Object',
          name: obj,
          type: 'REMOVED',
          baseState: this.describeObjectPerm(b),
          targetState: 'No Access',
          severity: 'MEDIUM',
          details: `Object '${obj}' was removed in ${targetLabel}.`,
        });
      } else if (b && t) {
        const diffs = this.diffObjectPerms(b, t);
        if (diffs.length > 0) {
          const isCritical = Boolean(
            (!b.modifyAllRecords && t.modifyAllRecords) || (!b.viewAllRecords && t.viewAllRecords)
          );
          const isHigh = Boolean(!b.allowDelete && t.allowDelete);
          drifts.push({
            category: 'Object',
            name: obj,
            type: 'MODIFIED',
            baseState: this.describeObjectPerm(b),
            targetState: this.describeObjectPerm(t),
            severity: isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : 'MEDIUM',
            details: `Object '${obj}' modified: ${diffs.join(', ')}.`,
          });
        }
      }
    }

    // 2. Field Permissions Drift
    const baseFieldMap = new Map<string, FieldPermission>();
    for (const fp of (baseMeta.fieldPermissions || []).filter((f) => f.readable || f.editable)) {
      baseFieldMap.set(fp.field, fp);
    }

    const targetFieldMap = new Map<string, FieldPermission>();
    for (const fp of (targetMeta.fieldPermissions || []).filter((f) => f.readable || f.editable)) {
      targetFieldMap.set(fp.field, fp);
    }

    const allFields = new Set([...baseFieldMap.keys(), ...targetFieldMap.keys()]);
    for (const fld of allFields) {
      const b = baseFieldMap.get(fld);
      const t = targetFieldMap.get(fld);

      if (!b && t) {
        drifts.push({
          category: 'Field',
          name: fld,
          type: 'ADDED',
          baseState: 'No Access',
          targetState: t.editable ? 'Read/Edit' : 'Read-Only',
          severity: 'LOW',
          details: `Field '${fld}' added with ${t.editable ? 'Read/Edit' : 'Read-Only'} access.`,
        });
      } else if (b && !t) {
        drifts.push({
          category: 'Field',
          name: fld,
          type: 'REMOVED',
          baseState: b.editable ? 'Read/Edit' : 'Read-Only',
          targetState: 'No Access',
          severity: 'LOW',
          details: `Field '${fld}' removed in ${targetLabel}.`,
        });
      } else if (b && t) {
        if (b.readable !== t.readable || b.editable !== t.editable) {
          drifts.push({
            category: 'Field',
            name: fld,
            type: 'MODIFIED',
            baseState: b.editable ? 'Read/Edit' : 'Read-Only',
            targetState: t.editable ? 'Read/Edit' : 'Read-Only',
            severity: 'LOW',
            details: `Field '${fld}' access changed from ${b.editable ? 'Read/Edit' : 'Read-Only'} to ${t.editable ? 'Read/Edit' : 'Read-Only'}.`,
          });
        }
      }
    }

    // 3. User Permissions Drift
    const baseUserPerms = new Set(
      (baseMeta.userPermissions || []).filter((u) => u.enabled).map((u) => u.name)
    );
    const targetUserPerms = new Set(
      (targetMeta.userPermissions || []).filter((u) => u.enabled).map((u) => u.name)
    );

    const allUserPerms = new Set([...baseUserPerms, ...targetUserPerms]);
    for (const up of allUserPerms) {
      const inBase = baseUserPerms.has(up);
      const inTarget = targetUserPerms.has(up);

      if (!inBase && inTarget) {
        const isCritical = CRITICAL_USER_PERMS.has(up);
        drifts.push({
          category: 'UserPermission',
          name: up,
          type: 'ADDED',
          baseState: 'Disabled',
          targetState: 'Enabled',
          severity: isCritical ? 'CRITICAL' : 'MEDIUM',
          details: isCritical
            ? `CRITICAL RISK: System permission '${up}' was added in ${targetLabel}!`
            : `User permission '${up}' was added in ${targetLabel}.`,
        });
      } else if (inBase && !inTarget) {
        drifts.push({
          category: 'UserPermission',
          name: up,
          type: 'REMOVED',
          baseState: 'Enabled',
          targetState: 'Disabled',
          severity: 'MEDIUM',
          details: `User permission '${up}' was removed in ${targetLabel}.`,
        });
      }
    }

    // 4. Apex Class Access Drift
    const baseClasses = new Set(
      (baseMeta.classAccesses || []).filter((c) => c.enabled).map((c) => c.apexClass)
    );
    const targetClasses = new Set(
      (targetMeta.classAccesses || []).filter((c) => c.enabled).map((c) => c.apexClass)
    );

    const allClasses = new Set([...baseClasses, ...targetClasses]);
    for (const cls of allClasses) {
      const inBase = baseClasses.has(cls);
      const inTarget = targetClasses.has(cls);

      if (!inBase && inTarget) {
        drifts.push({
          category: 'ApexClass',
          name: cls,
          type: 'ADDED',
          baseState: 'Disabled',
          targetState: 'Enabled',
          severity: 'MEDIUM',
          details: `Apex Class '${cls}' access was added in ${targetLabel}.`,
        });
      } else if (inBase && !inTarget) {
        drifts.push({
          category: 'ApexClass',
          name: cls,
          type: 'REMOVED',
          baseState: 'Enabled',
          targetState: 'Disabled',
          severity: 'LOW',
          details: `Apex Class '${cls}' access was removed in ${targetLabel}.`,
        });
      }
    }

    // 5. Custom Permissions Drift
    const baseCustomPerms = new Set(
      (baseMeta.customPermissions || []).filter((c) => c.enabled).map((c) => c.name)
    );
    const targetCustomPerms = new Set(
      (targetMeta.customPermissions || []).filter((c) => c.enabled).map((c) => c.name)
    );

    const allCustomPerms = new Set([...baseCustomPerms, ...targetCustomPerms]);
    for (const cp of allCustomPerms) {
      const inBase = baseCustomPerms.has(cp);
      const inTarget = targetCustomPerms.has(cp);

      if (!inBase && inTarget) {
        drifts.push({
          category: 'CustomPermission',
          name: cp,
          type: 'ADDED',
          baseState: 'Disabled',
          targetState: 'Enabled',
          severity: 'LOW',
          details: `Custom permission '${cp}' added in ${targetLabel}.`,
        });
      } else if (inBase && !inTarget) {
        drifts.push({
          category: 'CustomPermission',
          name: cp,
          type: 'REMOVED',
          baseState: 'Enabled',
          targetState: 'Disabled',
          severity: 'LOW',
          details: `Custom permission '${cp}' removed in ${targetLabel}.`,
        });
      }
    }

    // Compute metrics
    const objects = drifts.filter((d) => d.category === 'Object').length;
    const fields = drifts.filter((d) => d.category === 'Field').length;
    const userPermissions = drifts.filter((d) => d.category === 'UserPermission').length;
    const classes = drifts.filter((d) => d.category === 'ApexClass').length;
    const customPermissions = drifts.filter((d) => d.category === 'CustomPermission').length;
    const recordTypes = drifts.filter((d) => d.category === 'RecordType').length;

    let overallSeverity: DriftSeverity = 'NONE';
    if (drifts.some((d) => d.severity === 'CRITICAL')) overallSeverity = 'CRITICAL';
    else if (drifts.some((d) => d.severity === 'HIGH')) overallSeverity = 'HIGH';
    else if (drifts.some((d) => d.severity === 'MEDIUM')) overallSeverity = 'MEDIUM';
    else if (drifts.some((d) => d.severity === 'LOW')) overallSeverity = 'LOW';

    let reconciliationPermissionSet: GeneratedPermissionSet | undefined;

    // Optional reconciliation generation
    if (options?.generateReconciliation && drifts.length > 0) {
      const outDir = options.reconciliationOutputDir || path.join(process.cwd(), 'force-app/main/default');
      const recName = (options.reconciliationName || `${entityName}_Drift_Reconciliation`).replace(
        /[^a-zA-Z0-9_]/g,
        '_'
      );

      // Reconcile added permissions in target into a permission set
      const addedObjPerms: ObjectPermission[] = [];
      for (const d of drifts.filter((d) => d.category === 'Object' && (d.type === 'ADDED' || d.type === 'MODIFIED'))) {
        const targetObj = targetObjMap.get(d.name);
        if (targetObj) addedObjPerms.push({ ...targetObj });
      }

      const addedFieldPerms: FieldPermission[] = [];
      for (const d of drifts.filter((d) => d.category === 'Field' && (d.type === 'ADDED' || d.type === 'MODIFIED'))) {
        const targetFld = targetFieldMap.get(d.name);
        if (targetFld) addedFieldPerms.push({ ...targetFld });
      }

      const addedUserPerms: UserPermission[] = [];
      for (const d of drifts.filter((d) => d.category === 'UserPermission' && d.type === 'ADDED')) {
        addedUserPerms.push({ name: d.name, enabled: true });
      }

      const addedClasses: ClassAccess[] = [];
      for (const d of drifts.filter((d) => d.category === 'ApexClass' && d.type === 'ADDED')) {
        addedClasses.push({ apexClass: d.name, enabled: true });
      }

      const addedCustomPerms: CustomPermission[] = [];
      for (const d of drifts.filter((d) => d.category === 'CustomPermission' && d.type === 'ADDED')) {
        addedCustomPerms.push({ name: d.name, enabled: true });
      }

      const meta: PermissionSetMetadata = {
        label: `${entityName} - Drift Reconciliation`,
        description: `Auto-generated Permission Set reconciling environment drift between ${baseLabel} and ${targetLabel}`,
        hasActivationRequired: false,
        objectPermissions: addedObjPerms,
        fieldPermissions: addedFieldPerms,
        userPermissions: addedUserPerms,
        classAccesses: addedClasses,
        customPermissions: addedCustomPerms,
      };

      const psDir = path.join(outDir, 'permissionsets');
      fs.mkdirSync(psDir, { recursive: true });
      const fileName = `${recName}.permissionset-meta.xml`;
      const filePath = path.join(psDir, fileName);
      const xml = this.xmlEngine.serializePermissionSet(meta);
      fs.writeFileSync(filePath, xml, 'utf-8');

      reconciliationPermissionSet = {
        fileName,
        apiName: recName,
        category: 'domain',
        metadata: meta,
      };
    }

    return {
      profileName: entityName,
      baseLabel,
      targetLabel,
      hasDrift: drifts.length > 0,
      totalDrifts: drifts.length,
      driftsByCategory: {
        objects,
        fields,
        userPermissions,
        classes,
        customPermissions,
        recordTypes,
      },
      overallSeverity,
      drifts,
      reconciliationPermissionSet,
    };
  }

  /**
   * Compare multiple profiles across two collections or directories.
   */
  public compareProfileCollections(
    baseProfiles: LoadedProfile[],
    targetProfiles: LoadedProfile[],
    options?: DriftOptions
  ): MultiProfileDriftReport {
    const targetMap = new Map<string, LoadedProfile>();
    for (const p of targetProfiles) {
      targetMap.set(p.name, p);
    }

    const reports: ProfileDriftReport[] = [];
    let totalDrifts = 0;
    let profilesWithDrift = 0;

    for (const base of baseProfiles) {
      const target = targetMap.get(base.name);
      if (!target) {
        // Entire profile missing in target
        reports.push({
          profileName: base.name,
          baseLabel: options?.baseLabel || 'Base',
          targetLabel: options?.targetLabel || 'Target',
          hasDrift: true,
          totalDrifts: 1,
          driftsByCategory: { objects: 0, fields: 0, userPermissions: 0, classes: 0, customPermissions: 0, recordTypes: 0 },
          overallSeverity: 'HIGH',
          drifts: [
            {
              category: 'Object',
              name: base.name,
              type: 'REMOVED',
              baseState: 'Present',
              targetState: 'Missing',
              severity: 'HIGH',
              details: `Profile '${base.name}' exists in ${options?.baseLabel || 'Base'} but is completely missing in ${options?.targetLabel || 'Target'}.`,
            },
          ],
        });
        profilesWithDrift++;
        totalDrifts++;
      } else {
        const rep = this.compareProfiles(base, target, options);
        reports.push(rep);
        if (rep.hasDrift) {
          profilesWithDrift++;
          totalDrifts += rep.totalDrifts;
        }
      }
    }

    // Check for profiles in target that were not in base
    const baseNames = new Set(baseProfiles.map((p) => p.name));
    for (const target of targetProfiles) {
      if (!baseNames.has(target.name)) {
        reports.push({
          profileName: target.name,
          baseLabel: options?.baseLabel || 'Base',
          targetLabel: options?.targetLabel || 'Target',
          hasDrift: true,
          totalDrifts: 1,
          driftsByCategory: { objects: 0, fields: 0, userPermissions: 0, classes: 0, customPermissions: 0, recordTypes: 0 },
          overallSeverity: 'HIGH',
          drifts: [
            {
              category: 'Object',
              name: target.name,
              type: 'ADDED',
              baseState: 'Missing',
              targetState: 'Present',
              severity: 'HIGH',
              details: `New profile '${target.name}' found in ${options?.targetLabel || 'Target'} but not in ${options?.baseLabel || 'Base'}.`,
            },
          ],
        });
        profilesWithDrift++;
        totalDrifts++;
      }
    }

    let highestSeverity: DriftSeverity = 'NONE';
    if (reports.some((r) => r.overallSeverity === 'CRITICAL')) highestSeverity = 'CRITICAL';
    else if (reports.some((r) => r.overallSeverity === 'HIGH')) highestSeverity = 'HIGH';
    else if (reports.some((r) => r.overallSeverity === 'MEDIUM')) highestSeverity = 'MEDIUM';
    else if (reports.some((r) => r.overallSeverity === 'LOW')) highestSeverity = 'LOW';

    return {
      baseSource: options?.baseLabel || 'Base',
      targetSource: options?.targetLabel || 'Target',
      totalProfilesCompared: reports.length,
      profilesWithDrift,
      totalDriftsFound: totalDrifts,
      highestSeverity,
      reports,
    };
  }

  private isObjectActive(op: ObjectPermission): boolean {
    return Boolean(
      op.allowCreate ||
      op.allowRead ||
      op.allowEdit ||
      op.allowDelete ||
      op.viewAllRecords ||
      op.modifyAllRecords
    );
  }

  private describeObjectPerm(op: ObjectPermission): string {
    const perms: string[] = [];
    if (op.allowCreate) perms.push('C');
    if (op.allowRead) perms.push('R');
    if (op.allowEdit) perms.push('E');
    if (op.allowDelete) perms.push('D');
    if (op.viewAllRecords) perms.push('ViewAll');
    if (op.modifyAllRecords) perms.push('ModifyAll');
    return perms.length > 0 ? perms.join('/') : 'None';
  }

  private diffObjectPerms(b: ObjectPermission, t: ObjectPermission): string[] {
    const diffs: string[] = [];
    if (b.allowCreate !== t.allowCreate) diffs.push(`Create: ${b.allowCreate} -> ${t.allowCreate}`);
    if (b.allowRead !== t.allowRead) diffs.push(`Read: ${b.allowRead} -> ${t.allowRead}`);
    if (b.allowEdit !== t.allowEdit) diffs.push(`Edit: ${b.allowEdit} -> ${t.allowEdit}`);
    if (b.allowDelete !== t.allowDelete) diffs.push(`Delete: ${b.allowDelete} -> ${t.allowDelete}`);
    if (b.viewAllRecords !== t.viewAllRecords) diffs.push(`ViewAll: ${b.viewAllRecords} -> ${t.viewAllRecords}`);
    if (b.modifyAllRecords !== t.modifyAllRecords) diffs.push(`ModifyAll: ${b.modifyAllRecords} -> ${t.modifyAllRecords}`);
    return diffs;
  }
}
