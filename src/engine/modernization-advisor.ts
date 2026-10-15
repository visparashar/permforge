import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoadedProfile } from '../parser/profile-reader.js';
import {
  RecordTypeVisibility,
  PermissionSetMetadata,
  FieldPermission,
} from '../types/metadata.js';
import { GeneratedPermissionSet } from '../types/decomposition.js';
import { XmlEngine } from '../parser/xml-engine.js';

export interface DecoupledRecordType {
  recordType: string;
  objectName: string;
  developerName: string;
  isDefault: boolean;
  visible: boolean;
  decoupledIntoPermissionSet: boolean;
}

export interface DecoupledRecordTypesResult {
  profileName: string;
  totalRecordTypes: number;
  defaultsKeptOnProfile: DecoupledRecordType[];
  decoupledRecordTypes: DecoupledRecordType[];
  generatedPermissionSets: GeneratedPermissionSet[];
  retainedProfileRecordTypes: RecordTypeVisibility[];
}

export interface DynamicFormsFieldCandidate {
  field: string;
  objectName: string;
  fieldName: string;
  isReadOnlyInProfile: boolean;
  isEditableInProfile: boolean;
  recommendation: string;
  suggestedVisibilityRule?: string;
}

export interface DynamicFormsObjectAnalysis {
  objectName: string;
  totalFields: number;
  readOnlyFieldsCount: number;
  editableFieldsCount: number;
  readinessScore: number; // 0 - 100%
  status: 'Ready' | 'Partial' | 'LegacyLayoutRecommended';
  candidates: DynamicFormsFieldCandidate[];
}

export interface DynamicFormsAdvisory {
  profileName: string;
  overallReadinessScore: number; // 0 - 100%
  analyzedObjects: DynamicFormsObjectAnalysis[];
  keyRecommendations: string[];
  decouplingSummary: DecoupledRecordTypesResult;
}

export class ModernizationAdvisor {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
  }

  /**
   * Decouple non-default Record Types from a Profile into modular Permission Sets.
   * In Salesforce 2026 architecture, only default record type assignments remain on the Profile;
   * visibility access is decoupled into Permission Sets.
   */
  public decoupleRecordTypes(
    profile: LoadedProfile,
    options?: { outputDir?: string; separateByObject?: boolean }
  ): DecoupledRecordTypesResult {
    const rawRts = profile.metadata.recordTypeVisibilities || [];
    const defaultsKept: DecoupledRecordType[] = [];
    const decoupled: DecoupledRecordType[] = [];

    for (const rt of rawRts) {
      const parts = rt.recordType.split('.');
      const objectName = parts[0] || 'Unknown';
      const developerName = parts[1] || rt.recordType;
      const isDefault = Boolean(rt.default);
      const isVisible = Boolean(rt.visible);

      const record: DecoupledRecordType = {
        recordType: rt.recordType,
        objectName,
        developerName,
        isDefault,
        visible: isVisible,
        decoupledIntoPermissionSet: !isDefault && isVisible,
      };

      if (isDefault) {
        defaultsKept.push(record);
      } else if (isVisible) {
        decoupled.push(record);
      }
    }

    const generatedPermissionSets: GeneratedPermissionSet[] = [];

    if (decoupled.length > 0) {
      if (options?.separateByObject) {
        // Group by SObject
        const byObject = new Map<string, DecoupledRecordType[]>();
        for (const item of decoupled) {
          const list = byObject.get(item.objectName) || [];
          list.push(item);
          byObject.set(item.objectName, list);
        }

        for (const [objName, items] of byObject.entries()) {
          const apiName = `${profile.name}_RT_${objName}`.replace(/[^a-zA-Z0-9_]/g, '_');
          const meta: PermissionSetMetadata = {
            label: `${profile.name} - ${objName} Record Types`,
            description: `Decoupled ${objName} Record Type visibility for ${profile.name} (Salesforce 2026 Modernization)`,
            hasActivationRequired: false,
            recordTypeVisibilities: items.map((i) => ({
              recordType: i.recordType,
              visible: true,
            })),
          };

          const fileName = `${apiName}.permissionset-meta.xml`;
          generatedPermissionSets.push({
            fileName,
            apiName,
            category: 'domain',
            metadata: meta,
          });
        }
      } else {
        // Single consolidated Permission Set for decoupled record types
        const apiName = `${profile.name}_RecordTypes`.replace(/[^a-zA-Z0-9_]/g, '_');
        const fileName = `${apiName}.permissionset-meta.xml`;
        const meta: PermissionSetMetadata = {
          label: `${profile.name} - Record Types`,
          description: `Decoupled Record Type visibility for ${profile.name} (Salesforce 2026 Modernization)`,
          hasActivationRequired: false,
          recordTypeVisibilities: decoupled.map((i) => ({
            recordType: i.recordType,
            visible: true,
          })),
        };

        generatedPermissionSets.push({
          fileName,
          apiName,
          category: 'domain',
          metadata: meta,
        });
      }
    }

    // Save generated permission sets to disk if outputDir is specified
    if (options?.outputDir && generatedPermissionSets.length > 0) {
      const psDir = path.join(options.outputDir, 'permissionsets');
      fs.mkdirSync(psDir, { recursive: true });
      for (const ps of generatedPermissionSets) {
        const outPath = path.join(psDir, ps.fileName);
        const xml = this.xmlEngine.serializePermissionSet(ps.metadata);
        fs.writeFileSync(outPath, xml, 'utf-8');
      }
    }

    const retainedProfileRecordTypes: RecordTypeVisibility[] = defaultsKept.map((d) => ({
      recordType: d.recordType,
      default: true,
      visible: d.visible,
    }));

    return {
      profileName: profile.name,
      totalRecordTypes: rawRts.length,
      defaultsKeptOnProfile: defaultsKept,
      decoupledRecordTypes: decoupled,
      generatedPermissionSets,
      retainedProfileRecordTypes,
    };
  }

  /**
   * Analyze profile field permissions and layouts to generate a Dynamic Forms Modernization Advisory.
   */
  public analyzeDynamicFormsReadiness(
    profile: LoadedProfile,
    options?: { outputDir?: string }
  ): DynamicFormsAdvisory {
    const decouplingSummary = this.decoupleRecordTypes(profile, options);
    const fieldPerms = profile.metadata.fieldPermissions || [];
    const customPerms = (profile.metadata.customPermissions || []).map((cp) => cp.name);

    // Group field permissions by object
    const byObject = new Map<string, FieldPermission[]>();
    for (const fp of fieldPerms) {
      const [obj, fld] = fp.field.split('.');
      if (!obj || !fld) continue;
      const list = byObject.get(obj) || [];
      list.push(fp);
      byObject.set(obj, list);
    }

    const analyzedObjects: DynamicFormsObjectAnalysis[] = [];
    const keyRecommendations: string[] = [];

    for (const [objName, fperms] of byObject.entries()) {
      const candidates: DynamicFormsFieldCandidate[] = [];
      let readOnlyCount = 0;
      let editableCount = 0;

      for (const fp of fperms) {
        const parts = fp.field.split('.');
        const fieldName = parts[1] || fp.field;
        const isReadOnly = fp.readable && !fp.editable;
        const isEditable = fp.readable && fp.editable;

        if (isReadOnly) readOnlyCount++;
        if (isEditable) editableCount++;

        if (isReadOnly) {
          let suggestedRule: string | undefined;
          if (customPerms.length > 0) {
            suggestedRule = `$Permission.${customPerms[0]} = false`;
          } else {
            suggestedRule = `$User.Profile.Name = '${profile.name}'`;
          }

          candidates.push({
            field: fp.field,
            objectName: objName,
            fieldName,
            isReadOnlyInProfile: true,
            isEditableInProfile: false,
            recommendation: `Migrate '${fp.field}' UI behavior to Dynamic Forms Read-Only rule.`,
            suggestedVisibilityRule: suggestedRule,
          });
        }
      }

      // Calculate object readiness score (0 - 100%)
      // If an object has clean editable fields or a moderate number of read-only fields, it's highly suitable for Dynamic Forms.
      const totalFields = fperms.length;
      let readinessScore = 100;
      if (totalFields > 50) {
        readinessScore -= 15; // very large objects require section splitting
      }
      if (readOnlyCount > 20) {
        readinessScore -= 10;
      }
      readinessScore = Math.max(50, Math.min(100, readinessScore));

      let status: 'Ready' | 'Partial' | 'LegacyLayoutRecommended' = 'Ready';
      if (readinessScore < 70) {
        status = 'Partial';
      }

      analyzedObjects.push({
        objectName: objName,
        totalFields,
        readOnlyFieldsCount: readOnlyCount,
        editableFieldsCount: editableCount,
        readinessScore,
        status,
        candidates,
      });

      if (readOnlyCount > 0) {
        keyRecommendations.push(
          `Object '${objName}': ${readOnlyCount} read-only field(s) can be set directly via Dynamic Forms Field Section UI rules instead of profile FLS.`
        );
      }
    }

    if (decouplingSummary.decoupledRecordTypes.length > 0) {
      keyRecommendations.push(
        `Record Types: Decouple ${decouplingSummary.decoupledRecordTypes.length} non-default Record Type(s) into Permission Sets; retain only defaults on '${profile.name}'.`
      );
    }

    // Overall readiness score
    const avgScore =
      analyzedObjects.length > 0
        ? Math.round(analyzedObjects.reduce((acc, o) => acc + o.readinessScore, 0) / analyzedObjects.length)
        : 100;

    return {
      profileName: profile.name,
      overallReadinessScore: avgScore,
      analyzedObjects,
      keyRecommendations,
      decouplingSummary,
    };
  }
}
