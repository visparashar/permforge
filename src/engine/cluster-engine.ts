import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { XmlEngine } from '../parser/xml-engine.js';
import { LoadedProfile } from '../parser/profile-reader.js';
import {
  PermissionSetMetadata,
  PermissionSetGroupMetadata,
  ObjectPermission,
  FieldPermission,
  UserPermission,
  ClassAccess,
  TabSetting,
  CustomPermission,
} from '../types/metadata.js';
import {
  ClusterOptions,
  ClusterResult,
  ProfileDelta,
  GeneratedPermissionSet,
  GeneratedPermissionSetGroup,
} from '../types/decomposition.js';

export class ClusterEngine {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
  }

  /**
   * Analyze multiple profiles and extract a shared baseline permission set
   * plus individual delta permission sets and Permission Set Groups.
   */
  public async clusterProfiles(
    profiles: LoadedProfile[],
    options: ClusterOptions
  ): Promise<ClusterResult> {
    if (profiles.length === 0) {
      throw new Error('At least one profile must be provided for clustering.');
    }

    const threshold = options.threshold ?? 0.75;
    const minCount = Math.max(1, Math.ceil(profiles.length * threshold));
    const baseName = options.baselineName || 'Standard_Employee_Baseline';
    const totalProfiles = profiles.length;

    // 1. Frequency counters
    const objectFreq = new Map<string, { [perm: string]: number }>();
    const fieldFreq = new Map<string, { readable: number; editable: number }>();
    const userPermFreq = new Map<string, number>();
    const classFreq = new Map<string, number>();
    const tabFreq = new Map<string, number>();
    const customPermFreq = new Map<string, number>();

    for (const p of profiles) {
      const meta = p.metadata;

      // Objects
      for (const obj of meta.objectPermissions || []) {
        if (!objectFreq.has(obj.object)) {
          objectFreq.set(obj.object, {
            allowRead: 0,
            allowCreate: 0,
            allowEdit: 0,
            allowDelete: 0,
            viewAllRecords: 0,
            modifyAllRecords: 0,
          });
        }
        const counts = objectFreq.get(obj.object)!;
        if (obj.allowRead) counts.allowRead++;
        if (obj.allowCreate) counts.allowCreate++;
        if (obj.allowEdit) counts.allowEdit++;
        if (obj.allowDelete) counts.allowDelete++;
        if (obj.viewAllRecords) counts.viewAllRecords++;
        if (obj.modifyAllRecords) counts.modifyAllRecords++;
      }

      // Fields
      for (const f of meta.fieldPermissions || []) {
        if (!fieldFreq.has(f.field)) {
          fieldFreq.set(f.field, { readable: 0, editable: 0 });
        }
        const counts = fieldFreq.get(f.field)!;
        if (f.readable) counts.readable++;
        if (f.editable) counts.editable++;
      }

      // User permissions
      for (const u of meta.userPermissions || []) {
        if (u.enabled) {
          userPermFreq.set(u.name, (userPermFreq.get(u.name) || 0) + 1);
        }
      }

      // Class accesses
      for (const c of meta.classAccesses || []) {
        if (c.enabled) {
          classFreq.set(c.apexClass, (classFreq.get(c.apexClass) || 0) + 1);
        }
      }

      // Tabs
      for (const t of meta.tabVisibilities || []) {
        if (t.visibility === 'DefaultOn' || t.visibility === 'DefaultOff') {
          tabFreq.set(t.tab, (tabFreq.get(t.tab) || 0) + 1);
        }
      }

      // Custom permissions
      for (const cp of meta.customPermissions || []) {
        if (cp.enabled) {
          customPermFreq.set(cp.name, (customPermFreq.get(cp.name) || 0) + 1);
        }
      }
    }

    // 2. Build the Baseline Permission Set
    const baselineObjects: ObjectPermission[] = [];
    for (const [objName, counts] of objectFreq.entries()) {
      const allowRead = counts.allowRead >= minCount;
      const allowCreate = counts.allowCreate >= minCount;
      const allowEdit = counts.allowEdit >= minCount;
      const allowDelete = counts.allowDelete >= minCount;
      const viewAllRecords = counts.viewAllRecords >= minCount;
      const modifyAllRecords = counts.modifyAllRecords >= minCount;

      if (
        allowRead ||
        allowCreate ||
        allowEdit ||
        allowDelete ||
        viewAllRecords ||
        modifyAllRecords
      ) {
        baselineObjects.push({
          object: objName,
          allowRead,
          allowCreate,
          allowEdit,
          allowDelete,
          viewAllRecords,
          modifyAllRecords,
        });
      }
    }

    const baselineFields: FieldPermission[] = [];
    for (const [fieldName, counts] of fieldFreq.entries()) {
      const readable = counts.readable >= minCount;
      const editable = counts.editable >= minCount;
      if (readable || editable) {
        baselineFields.push({
          field: fieldName,
          readable,
          editable,
        });
      }
    }

    const baselineUserPerms: UserPermission[] = [];
    for (const [permName, count] of userPermFreq.entries()) {
      if (count >= minCount) {
        baselineUserPerms.push({ name: permName, enabled: true });
      }
    }

    const baselineClasses: ClassAccess[] = [];
    for (const [className, count] of classFreq.entries()) {
      if (count >= minCount) {
        baselineClasses.push({ apexClass: className, enabled: true });
      }
    }

    const baselineTabs: TabSetting[] = [];
    for (const [tabName, count] of tabFreq.entries()) {
      if (count >= minCount) {
        baselineTabs.push({ tab: tabName, visibility: 'Visible' });
      }
    }

    const baselineCustomPerms: CustomPermission[] = [];
    for (const [cpName, count] of customPermFreq.entries()) {
      if (count >= minCount) {
        baselineCustomPerms.push({ name: cpName, enabled: true });
      }
    }

    const baselineMeta: PermissionSetMetadata = {
      label: this.formatLabel(baseName),
      description: `Baseline permissions shared across ${minCount}/${totalProfiles} profiles (${Math.round(
        threshold * 100
      )}% threshold). Generated by PermForge.`,
      hasActivationRequired: false,
      objectPermissions: baselineObjects.length > 0 ? baselineObjects : undefined,
      fieldPermissions: baselineFields.length > 0 ? baselineFields : undefined,
      userPermissions: baselineUserPerms.length > 0 ? baselineUserPerms : undefined,
      classAccesses: baselineClasses.length > 0 ? baselineClasses : undefined,
      customPermissions: baselineCustomPerms.length > 0 ? baselineCustomPerms : undefined,
      tabSettings: baselineTabs.length > 0 ? baselineTabs : undefined,
    };

    const baselinePermSet: GeneratedPermissionSet = {
      apiName: baseName,
      fileName: `${baseName}.permissionset-meta.xml`,
      metadata: baselineMeta,
      category: 'base',
    };

    // Helper maps for quick subtraction
    const baseObjMap = new Map(baselineObjects.map((o) => [o.object, o]));
    const baseFieldMap = new Map(baselineFields.map((f) => [f.field, f]));
    const baseUserSet = new Set(baselineUserPerms.map((u) => u.name));
    const baseClassSet = new Set(baselineClasses.map((c) => c.apexClass));
    const baseCustomSet = new Set(baselineCustomPerms.map((cp) => cp.name));

    // 3. For each profile, calculate delta and generate Delta Permission Sets
    const profileDeltas: ProfileDelta[] = [];
    let totalDeltasCreated = 0;

    for (const p of profiles) {
      const meta = p.metadata;
      const deltaObjects: ObjectPermission[] = [];
      const deltaFields: FieldPermission[] = [];
      const deltaUserPerms: UserPermission[] = [];
      const deltaClasses: ClassAccess[] = [];

      // SObject deltas
      for (const obj of meta.objectPermissions || []) {
        const base = baseObjMap.get(obj.object);
        const allowRead = Boolean(obj.allowRead) && !(base && base.allowRead);
        const allowCreate = Boolean(obj.allowCreate) && !(base && base.allowCreate);
        const allowEdit = Boolean(obj.allowEdit) && !(base && base.allowEdit);
        const allowDelete = Boolean(obj.allowDelete) && !(base && base.allowDelete);
        const viewAll = Boolean(obj.viewAllRecords) && !(base && base.viewAllRecords);
        const modifyAll = Boolean(obj.modifyAllRecords) && !(base && base.modifyAllRecords);

        if (allowRead || allowCreate || allowEdit || allowDelete || viewAll || modifyAll) {
          deltaObjects.push({
            object: obj.object,
            allowRead,
            allowCreate,
            allowEdit,
            allowDelete,
            viewAllRecords: viewAll,
            modifyAllRecords: modifyAll,
          });
        }
      }

      // Field deltas
      for (const f of meta.fieldPermissions || []) {
        const base = baseFieldMap.get(f.field);
        const readable = Boolean(f.readable) && !(base && base.readable);
        const editable = Boolean(f.editable) && !(base && base.editable);

        if (readable || editable) {
          deltaFields.push({
            field: f.field,
            readable,
            editable,
          });
        }
      }

      // User permission deltas
      for (const u of meta.userPermissions || []) {
        if (u.enabled && !baseUserSet.has(u.name)) {
          deltaUserPerms.push(u);
        }
      }

      // Class deltas
      for (const c of meta.classAccesses || []) {
        if (c.enabled && !baseClassSet.has(c.apexClass)) {
          deltaClasses.push(c);
        }
      }

      // Custom permission deltas
      const deltaCustomPerms: CustomPermission[] = [];
      for (const cp of meta.customPermissions || []) {
        if (cp.enabled && !baseCustomSet.has(cp.name)) {
          deltaCustomPerms.push(cp);
        }
      }

      const generatedDeltas: GeneratedPermissionSet[] = [];

      // Create Delta Object/Field Permission Set if any
      if (deltaObjects.length > 0 || deltaFields.length > 0) {
        const apiName = `${p.name}_Delta_Data_Access`;
        generatedDeltas.push({
          apiName,
          fileName: `${apiName}.permissionset-meta.xml`,
          metadata: {
            label: `${this.formatLabel(p.name)} - Delta Data Access`,
            description: `Unique object and field permissions for ${p.name} on top of ${baseName}.`,
            hasActivationRequired: false,
            objectPermissions: deltaObjects.length > 0 ? deltaObjects : undefined,
            fieldPermissions: deltaFields.length > 0 ? deltaFields : undefined,
          },
          category: 'domain',
        });
      }

      // Create Delta System Permission Set if any
      if (deltaUserPerms.length > 0) {
        const apiName = `${p.name}_Delta_System_Permissions`;
        generatedDeltas.push({
          apiName,
          fileName: `${apiName}.permissionset-meta.xml`,
          metadata: {
            label: `${this.formatLabel(p.name)} - Delta System Permissions`,
            description: `Unique user and administrative permissions for ${p.name} on top of ${baseName}.`,
            hasActivationRequired: false,
            userPermissions: deltaUserPerms,
          },
          category: 'admin',
        });
      }

      // Create Delta Code Permission Set if any
      if (deltaClasses.length > 0) {
        const apiName = `${p.name}_Delta_Apex_Access`;
        generatedDeltas.push({
          apiName,
          fileName: `${apiName}.permissionset-meta.xml`,
          metadata: {
            label: `${this.formatLabel(p.name)} - Delta Apex Access`,
            description: `Unique Apex class access for ${p.name} on top of ${baseName}.`,
            hasActivationRequired: false,
            classAccesses: deltaClasses,
          },
          category: 'apex',
        });
      }

      // Create Delta Custom Permissions Set if any
      if (deltaCustomPerms.length > 0) {
        const apiName = `${p.name}_Delta_Custom_Permissions`;
        generatedDeltas.push({
          apiName,
          fileName: `${apiName}.permissionset-meta.xml`,
          metadata: {
            label: `${this.formatLabel(p.name)} - Delta Custom Permissions`,
            description: `Unique custom permissions for ${p.name} on top of ${baseName}.`,
            hasActivationRequired: false,
            customPermissions: deltaCustomPerms,
          },
          category: 'custom',
        });
      }

      // Build PSG for the profile combining Baseline + Deltas
      let psg: GeneratedPermissionSetGroup | undefined;
      if (options.createGroups !== false) {
        const psgApiName = `${p.name}_PSG`;
        const memberPermSets = [baselinePermSet.apiName, ...generatedDeltas.map((d) => d.apiName)];

        psg = {
          apiName: psgApiName,
          fileName: `${psgApiName}.permissionsetgroup-meta.xml`,
          metadata: {
            label: `${this.formatLabel(p.name)} Group`,
            description: `Permission Set Group replacing ${p.name}, combining ${baseName} with persona deltas.`,
            hasActivationRequired: false,
            status: 'Updated',
            permissionSets: memberPermSets,
          },
        };
      }

      totalDeltasCreated += generatedDeltas.length;

      profileDeltas.push({
        profileName: p.name,
        deltaPermissionSets: generatedDeltas,
        permissionSetGroup: psg,
        stats: {
          basePermissionsUsed:
            baselineObjects.length + baselineFields.length + baselineUserPerms.length,
          deltaPermissionsCount:
            deltaObjects.length + deltaFields.length + deltaUserPerms.length + deltaClasses.length,
        },
      });
    }

    // Write all artifacts to target directories if outputDir provided
    if (options.outputDir) {
      await this.writeClusteredOutputs(options.outputDir, baselinePermSet, profileDeltas);
    }

    return {
      totalProfilesAnalyzed: totalProfiles,
      thresholdUsed: threshold,
      baselinePermissionSet: baselinePermSet,
      profileDeltas,
      stats: {
        baselineObjectsCount: baselineObjects.length,
        baselineFieldsCount: baselineFields.length,
        baselineUserPermsCount: baselineUserPerms.length,
        totalDeltasCreated,
      },
    };
  }

  private async writeClusteredOutputs(
    outputDir: string,
    baseline: GeneratedPermissionSet,
    deltas: ProfileDelta[]
  ): Promise<void> {
    const permSetDir = path.join(outputDir, 'permissionsets');
    const psgDir = path.join(outputDir, 'permissionsetgroups');

    await fs.mkdir(permSetDir, { recursive: true });
    await fs.mkdir(psgDir, { recursive: true });

    // Write baseline
    const baseFile = path.join(permSetDir, baseline.fileName);
    await fs.writeFile(baseFile, this.xmlEngine.serializePermissionSet(baseline.metadata), 'utf-8');

    // Write deltas & PSGs
    for (const delta of deltas) {
      for (const ps of delta.deltaPermissionSets) {
        const psFile = path.join(permSetDir, ps.fileName);
        await fs.writeFile(psFile, this.xmlEngine.serializePermissionSet(ps.metadata), 'utf-8');
      }

      if (delta.permissionSetGroup) {
        const psgFile = path.join(psgDir, delta.permissionSetGroup.fileName);
        await fs.writeFile(
          psgFile,
          this.xmlEngine.serializePermissionSetGroup(delta.permissionSetGroup.metadata),
          'utf-8'
        );
      }
    }
  }

  private formatLabel(str: string): string {
    return str
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
