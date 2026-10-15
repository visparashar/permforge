import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoadedProfile } from '../parser/profile-reader.js';
import {
  PermissionSetMetadata,
  ObjectPermission,
  FieldPermission,
  UserPermission,
  ClassAccess,
} from '../types/metadata.js';
import { GeneratedPermissionSet } from '../types/decomposition.js';
import { XmlEngine } from '../parser/xml-engine.js';
import { MuteBuilder, MuteResult, MuteObjectOptions } from './mute-builder.js';

export interface UsageEvent {
  timestamp: string;
  eventType: string;
  userId?: string;
  entityName?: string;
  apexName?: string;
  actionType?: string;
  raw?: Record<string, string>;
}

export interface ActivityFootprint {
  accessedObjects: Set<string>;
  accessedObjectActions: Map<string, Set<string>>;
  accessedFields: Set<string>;
  executedApexClasses: Set<string>;
  exercisedUserPermissions: Set<string>;
  totalEventsCount: number;
}

export interface DormantPermissionSummary {
  category: 'Object' | 'Field' | 'Apex' | 'UserPermission';
  name: string;
  grantedAccess: string;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: string;
}

export interface LeastPrivilegeAuditReport {
  profileName: string;
  totalPermissionsGranted: number;
  exercisedPermissionsCount: number;
  dormantPermissionsCount: number;
  utilizationRatePercent: number;
  overPrivilegeScore: number;
  dormantRiskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  dormantPermissions: DormantPermissionSummary[];
  exercisedPermissions: {
    category: string;
    name: string;
    observedActions: string[];
  }[];
  generatedPrunedPermissionSet?: GeneratedPermissionSet;
  generatedMutingPermissionSet?: MuteResult;
}

export interface LeastPrivilegeOptions {
  mode?: 'audit-only' | 'prune' | 'mute';
  outputDir?: string;
  prunedName?: string;
  mutingName?: string;
  safeRetentionObjects?: string[];
}

const CRITICAL_SYSTEM_PERMS = new Set([
  'ModifyAllData',
  'ViewAllData',
  'AuthorApex',
  'ManageUsers',
  'BulkApiHardDelete',
  'CustomizeApplication',
  'ModifyMetadata',
  'ManageRoles',
]);

export class LeastPrivilegeEngine {
  private xmlEngine: XmlEngine;
  private muteBuilder: MuteBuilder;

  constructor(xmlEngine?: XmlEngine, muteBuilder?: MuteBuilder) {
    this.xmlEngine = xmlEngine || new XmlEngine();
    this.muteBuilder = muteBuilder || new MuteBuilder();
  }

  /**
   * Parse usage telemetry logs (CSV content, JSON array, or event list) into an ActivityFootprint.
   */
  public parseEvents(rawContent: string | UsageEvent[]): ActivityFootprint {
    const footprint: ActivityFootprint = {
      accessedObjects: new Set<string>(),
      accessedObjectActions: new Map<string, Set<string>>(),
      accessedFields: new Set<string>(),
      executedApexClasses: new Set<string>(),
      exercisedUserPermissions: new Set<string>(),
      totalEventsCount: 0,
    };

    let events: UsageEvent[] = [];

    if (Array.isArray(rawContent)) {
      events = rawContent;
    } else {
      const trimmed = rawContent.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          events = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          events = [];
        }
      } else {
        events = this.parseCsvEvents(trimmed);
      }
    }

    footprint.totalEventsCount = events.length;

    for (const evt of events) {
      const entity = evt.entityName?.trim();
      const apex = evt.apexName?.trim();
      const action = evt.actionType?.trim();

      if (entity) {
        if (entity.includes('.')) {
          // Field reference: e.g. "Account.AnnualRevenue"
          footprint.accessedFields.add(entity);
          const [objName] = entity.split('.');
          if (objName) {
            footprint.accessedObjects.add(objName);
            this.recordObjectAction(footprint, objName, (action || 'READ').toUpperCase());
          }
        } else {
          // Object reference: e.g. "Account"
          footprint.accessedObjects.add(entity);
          this.recordObjectAction(footprint, entity, (action || 'READ').toUpperCase());
        }
      }

      if (apex) {
        footprint.executedApexClasses.add(apex);
      }

      if (action) {
        // Record user permissions
        const normalizedAction = action.toUpperCase();
        if (
          normalizedAction === 'APIENABLED' ||
          normalizedAction === 'EXPORTREPORT' ||
          normalizedAction === 'RUNREPORTS' ||
          normalizedAction === 'MODIFYALLDATA' ||
          normalizedAction === 'VIEWALLDATA' ||
          normalizedAction === 'AUTHORAPEX' ||
          normalizedAction === 'MANAGEUSERS' ||
          normalizedAction === 'VIEWSETUP'
        ) {
          footprint.exercisedUserPermissions.add(action);
        }
      }
    }

    return footprint;
  }

  /**
   * Audit profile permissions against actual activity telemetry and generate least-privilege recommendations.
   */
  public async auditProfile(
    profile: LoadedProfile,
    footprint: ActivityFootprint,
    options?: LeastPrivilegeOptions
  ): Promise<LeastPrivilegeAuditReport> {
    const dormant: DormantPermissionSummary[] = [];
    const exercised: { category: string; name: string; observedActions: string[] }[] = [];

    let totalGranted = 0;
    let exercisedCount = 0;

    // 1. Audit SObject Permissions (only consider those where some CRUD is granted)
    const activeObjectPerms = (profile.metadata.objectPermissions || []).filter(
      (o) =>
        o.allowCreate ||
        o.allowRead ||
        o.allowEdit ||
        o.allowDelete ||
        o.viewAllRecords ||
        o.modifyAllRecords
    );

    const exercisedObjectPerms: ObjectPermission[] = [];
    const mutedObjectOptions: MuteObjectOptions[] = [];

    for (const op of activeObjectPerms) {
      totalGranted++;
      const isExercised = footprint.accessedObjects.has(op.object);
      const actions = footprint.accessedObjectActions.get(op.object) || new Set<string>();

      if (isExercised) {
        exercisedCount++;
        exercised.push({
          category: 'Object',
          name: op.object,
          observedActions: Array.from(actions),
        });

        // Retain for pruned permission set
        exercisedObjectPerms.push({ ...op });

        // If high-risk modify/delete was granted but never observed
        if (op.modifyAllRecords && !actions.has('MODIFYALL') && !actions.has('DELETE')) {
          dormant.push({
            category: 'Object',
            name: `${op.object} (ModifyAllRecords)`,
            grantedAccess: 'ModifyAllRecords=true',
            riskLevel: 'CRITICAL',
            recommendation: `Mute ModifyAllRecords on '${op.object}'; users only exercised standard ${Array.from(actions).join('/')} access.`,
          });
          mutedObjectOptions.push({
            object: op.object,
            muteModifyAll: true,
          });
        }
      } else {
        const isCritical = Boolean(op.modifyAllRecords || op.viewAllRecords);
        const isHigh = Boolean(op.allowDelete);
        const riskLevel = isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : 'MEDIUM';

        dormant.push({
          category: 'Object',
          name: op.object,
          grantedAccess: `CRUD: C=${op.allowCreate}, R=${op.allowRead}, E=${op.allowEdit}, D=${op.allowDelete}`,
          riskLevel,
          recommendation: `Remove dormant object access on '${op.object}'; zero activity observed in telemetry.`,
        });

        mutedObjectOptions.push({
          object: op.object,
          muteDelete: op.allowDelete,
          muteEdit: op.allowEdit,
          muteCreate: op.allowCreate,
          muteRead: op.allowRead,
          muteViewAll: op.viewAllRecords,
          muteModifyAll: op.modifyAllRecords,
        });
      }
    }

    // 2. Audit Field Permissions (only consider those where read or edit is granted)
    const activeFieldPerms = (profile.metadata.fieldPermissions || []).filter(
      (f) => f.readable || f.editable
    );

    const exercisedFieldPerms: FieldPermission[] = [];
    for (const fp of activeFieldPerms) {
      totalGranted++;
      const isFieldDirectlyExercised = footprint.accessedFields.has(fp.field);
      const [objName] = fp.field.split('.');
      const isObjectExercised = objName ? footprint.accessedObjects.has(objName) : false;

      if (isFieldDirectlyExercised || (isObjectExercised && footprint.accessedFields.size === 0)) {
        exercisedCount++;
        exercisedFieldPerms.push({ ...fp });
      } else {
        dormant.push({
          category: 'Field',
          name: fp.field,
          grantedAccess: fp.editable ? 'Read/Edit' : 'Read-Only',
          riskLevel: 'LOW',
          recommendation: `Dormant FLS: Field '${fp.field}' was never queried or updated.`,
        });
      }
    }

    // 3. Audit Apex Class Accesses (only enabled ones)
    const activeClassAccesses = (profile.metadata.classAccesses || []).filter((c) => c.enabled);
    const exercisedClasses: ClassAccess[] = [];
    for (const ca of activeClassAccesses) {
      totalGranted++;
      if (footprint.executedApexClasses.has(ca.apexClass)) {
        exercisedCount++;
        exercisedClasses.push({ ...ca });
        exercised.push({
          category: 'Apex',
          name: ca.apexClass,
          observedActions: ['EXECUTE'],
        });
      } else {
        dormant.push({
          category: 'Apex',
          name: ca.apexClass,
          grantedAccess: 'Enabled',
          riskLevel: 'MEDIUM',
          recommendation: `Dormant Apex: Class '${ca.apexClass}' was never executed by users on this profile.`,
        });
      }
    }

    // 4. Audit User Permissions (only enabled ones)
    const activeUserPerms = (profile.metadata.userPermissions || []).filter((u) => u.enabled);
    const exercisedUserPerms: UserPermission[] = [];
    const mutedUserPerms: string[] = [];

    const exercisedLower = new Set(
      Array.from(footprint.exercisedUserPermissions).map((p) => p.toLowerCase())
    );

    for (const up of activeUserPerms) {
      totalGranted++;
      if (exercisedLower.has(up.name.toLowerCase())) {
        exercisedCount++;
        exercisedUserPerms.push({ ...up });
        exercised.push({
          category: 'UserPermission',
          name: up.name,
          observedActions: ['ACTIVE'],
        });
      } else {
        const isCritical = CRITICAL_SYSTEM_PERMS.has(up.name);
        dormant.push({
          category: 'UserPermission',
          name: up.name,
          grantedAccess: 'Enabled',
          riskLevel: isCritical ? 'CRITICAL' : 'LOW',
          recommendation: isCritical
            ? `CRITICAL RISK: System permission '${up.name}' is granted but never exercised. Prune or mute immediately.`
            : `Dormant User Permission: '${up.name}' was not detected in telemetry.`,
        });
        if (isCritical) {
          mutedUserPerms.push(up.name);
        }
      }
    }

    const totalPermissions = Math.max(1, totalGranted);
    const utilizationRatePercent = Math.round((exercisedCount / totalPermissions) * 100);
    const overPrivilegeScore = 100 - utilizationRatePercent;

    let overallRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    if (dormant.some((d) => d.riskLevel === 'CRITICAL')) overallRisk = 'CRITICAL';
    else if (dormant.some((d) => d.riskLevel === 'HIGH')) overallRisk = 'HIGH';
    else if (dormant.some((d) => d.riskLevel === 'MEDIUM')) overallRisk = 'MEDIUM';

    let generatedPrunedPermissionSet: GeneratedPermissionSet | undefined;
    let generatedMutingPermissionSet: MuteResult | undefined;

    const outDir = options?.outputDir || path.join(process.cwd(), 'force-app/main/default');

    // 5. Remediation Generation
    if (options?.mode === 'prune') {
      const apiName = (options.prunedName || `${profile.name}_LeastPrivilege`).replace(
        /[^a-zA-Z0-9_]/g,
        '_'
      );
      const meta: PermissionSetMetadata = {
        label: `${profile.name} - Least Privilege`,
        description: `Least-privilege permission set pruned based on Salesforce Event Monitoring telemetry`,
        hasActivationRequired: false,
        objectPermissions: exercisedObjectPerms,
        fieldPermissions: exercisedFieldPerms,
        classAccesses: exercisedClasses,
        userPermissions: exercisedUserPerms,
      };

      const psDir = path.join(outDir, 'permissionsets');
      fs.mkdirSync(psDir, { recursive: true });
      const fileName = `${apiName}.permissionset-meta.xml`;
      const filePath = path.join(psDir, fileName);
      const xml = this.xmlEngine.serializePermissionSet(meta);
      fs.writeFileSync(filePath, xml, 'utf-8');

      generatedPrunedPermissionSet = {
        fileName,
        apiName,
        category: 'domain',
        metadata: meta,
      };
    } else if (options?.mode === 'mute') {
      const muteName = (options.mutingName || `${profile.name}_Mute_Dormant`).replace(
        /[^a-zA-Z0-9_]/g,
        '_'
      );
      generatedMutingPermissionSet = await this.muteBuilder.generateMutingPermissionSet({
        name: muteName,
        label: `${profile.name} Mute Dormant Access`,
        description: `Muting Permission Set silencing dormant high-risk permissions detected via telemetry`,
        mutedObjects: mutedObjectOptions,
        mutedUserPerms,
        outputDir: outDir,
      });
    }

    return {
      profileName: profile.name,
      totalPermissionsGranted: totalGranted,
      exercisedPermissionsCount: exercisedCount,
      dormantPermissionsCount: dormant.length,
      utilizationRatePercent,
      overPrivilegeScore,
      dormantRiskLevel: overallRisk,
      dormantPermissions: dormant,
      exercisedPermissions: exercised,
      generatedPrunedPermissionSet,
      generatedMutingPermissionSet,
    };
  }

  private recordObjectAction(
    footprint: ActivityFootprint,
    objectName: string,
    action: string
  ): void {
    const existing = footprint.accessedObjectActions.get(objectName) || new Set<string>();
    existing.add(action);
    footprint.accessedObjectActions.set(objectName, existing);
  }

  private parseCsvEvents(csvContent: string): UsageEvent[] {
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headerLine = lines[0];
    const headers = headerLine.split(',').map((h) => h.trim().toUpperCase());

    const timeIdx = headers.findIndex((h) => h.includes('TIME') || h === 'TIMESTAMP');
    const typeIdx = headers.findIndex((h) => h.includes('TYPE') || h === 'EVENT_TYPE');
    const userIdx = headers.findIndex((h) => h.includes('USER'));
    const entityIdx = headers.findIndex(
      (h) => h.includes('ENTITY') || h.includes('OBJECT') || h.includes('URI')
    );
    const apexIdx = headers.findIndex((h) => h.includes('APEX') || h.includes('CLASS'));
    const actionIdx = headers.findIndex((h) => h.includes('ACTION') || h.includes('METHOD'));

    const events: UsageEvent[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (cols.length === 0) continue;

      let entityName = entityIdx >= 0 ? cols[entityIdx] : undefined;
      // If URI format: /services/data/v60.0/sobjects/Account
      if (entityName && entityName.includes('/sobjects/')) {
        const match = entityName.match(/\/sobjects\/([a-zA-Z0-9_]+)/);
        if (match) entityName = match[1];
      }

      events.push({
        timestamp: timeIdx >= 0 ? cols[timeIdx] : new Date().toISOString(),
        eventType: typeIdx >= 0 ? cols[typeIdx] : 'EventLog',
        userId: userIdx >= 0 ? cols[userIdx] : undefined,
        entityName,
        apexName: apexIdx >= 0 ? cols[apexIdx] : undefined,
        actionType: actionIdx >= 0 ? cols[actionIdx] : undefined,
      });
    }

    return events;
  }
}
