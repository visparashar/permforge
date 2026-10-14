import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  ProfileMetadata,
  PermissionSetMetadata,
  PermissionSetGroupMetadata,
  ObjectPermission,
  FieldPermission,
  UserPermission,
  ClassAccess,
  PageAccess,
  CustomPermission,
  TabSetting,
  RecordTypeVisibility,
} from '../types/metadata.js';

const ARRAY_TAGS = new Set([
  'objectPermissions',
  'fieldPermissions',
  'userPermissions',
  'classAccesses',
  'pageAccesses',
  'customPermissions',
  'tabVisibilities',
  'tabSettings',
  'recordTypeVisibilities',
  'applicationVisibilities',
  'permissionSets',
  'loginIpRanges',
  'layoutAssignments',
]);

export class XmlEngine {
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ARRAY_TAGS.has(name),
      tagValueProcessor: (_tagName, tagValue) => {
        if (tagValue === 'true') return true;
        if (tagValue === 'false') return false;
        return tagValue;
      },
      trimValues: true,
    });

    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '    ',
      suppressEmptyNode: false,
    });
  }

  /**
   * Parse a raw XML string into a ProfileMetadata object.
   */
  public parseProfile(xmlContent: string): ProfileMetadata {
    const parsed = this.parser.parse(xmlContent);
    const root = parsed.Profile;
    if (!root) {
      throw new Error('Invalid Profile XML: Root element <Profile> not found');
    }
    return this.normalizeProfile(root);
  }

  /**
   * Parse a raw XML string into a PermissionSetMetadata object.
   */
  public parsePermissionSet(xmlContent: string): PermissionSetMetadata {
    const parsed = this.parser.parse(xmlContent);
    const root = parsed.PermissionSet;
    if (!root) {
      throw new Error('Invalid PermissionSet XML: Root element <PermissionSet> not found');
    }
    return this.normalizePermissionSet(root);
  }

  /**
   * Parse a raw XML string into a PermissionSetGroupMetadata object.
   */
  public parsePermissionSetGroup(xmlContent: string): PermissionSetGroupMetadata {
    const parsed = this.parser.parse(xmlContent);
    const root = parsed.PermissionSetGroup;
    if (!root) {
      throw new Error(
        'Invalid PermissionSetGroup XML: Root element <PermissionSetGroup> not found'
      );
    }
    const permissionSets = root.permissionSets
      ? Array.isArray(root.permissionSets)
        ? root.permissionSets
        : [root.permissionSets]
      : [];

    return {
      label: root.label || '',
      description: root.description,
      hasActivationRequired: Boolean(root.hasActivationRequired),
      status: root.status,
      permissionSets,
    };
  }

  /**
   * Serialize a PermissionSetMetadata object into standard Salesforce XML.
   */
  public serializePermissionSet(permSet: PermissionSetMetadata): string {
    const sortedObj: Record<string, unknown> = {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
    };

    if (permSet.description) sortedObj.description = permSet.description;
    sortedObj.hasActivationRequired = permSet.hasActivationRequired ?? false;
    sortedObj.label = permSet.label;
    if (permSet.license) sortedObj.license = permSet.license;

    if (permSet.applicationVisibilities && permSet.applicationVisibilities.length > 0) {
      sortedObj.applicationVisibilities = [...permSet.applicationVisibilities].sort((a, b) =>
        a.application.localeCompare(b.application)
      );
    }

    if (permSet.classAccesses && permSet.classAccesses.length > 0) {
      sortedObj.classAccesses = [...permSet.classAccesses].sort((a, b) =>
        a.apexClass.localeCompare(b.apexClass)
      );
    }

    if (permSet.customPermissions && permSet.customPermissions.length > 0) {
      sortedObj.customPermissions = [...permSet.customPermissions].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    }

    if (permSet.fieldPermissions && permSet.fieldPermissions.length > 0) {
      sortedObj.fieldPermissions = [...permSet.fieldPermissions].sort((a, b) =>
        a.field.localeCompare(b.field)
      );
    }

    if (permSet.objectPermissions && permSet.objectPermissions.length > 0) {
      sortedObj.objectPermissions = [...permSet.objectPermissions].sort((a, b) =>
        a.object.localeCompare(b.object)
      );
    }

    if (permSet.pageAccesses && permSet.pageAccesses.length > 0) {
      sortedObj.pageAccesses = [...permSet.pageAccesses].sort((a, b) =>
        a.apexPage.localeCompare(b.apexPage)
      );
    }

    if (permSet.recordTypeVisibilities && permSet.recordTypeVisibilities.length > 0) {
      sortedObj.recordTypeVisibilities = [...permSet.recordTypeVisibilities].sort((a, b) =>
        a.recordType.localeCompare(b.recordType)
      );
    }

    if (permSet.tabSettings && permSet.tabSettings.length > 0) {
      sortedObj.tabSettings = [...permSet.tabSettings].sort((a, b) => a.tab.localeCompare(b.tab));
    }

    if (permSet.userPermissions && permSet.userPermissions.length > 0) {
      sortedObj.userPermissions = [...permSet.userPermissions].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    }

    const xml = this.builder.build({ PermissionSet: sortedObj });
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`;
  }

  /**
   * Serialize a PermissionSetGroupMetadata object into standard Salesforce XML.
   */
  public serializePermissionSetGroup(group: PermissionSetGroupMetadata): string {
    const sortedObj: Record<string, unknown> = {
      '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
    };

    if (group.description) sortedObj.description = group.description;
    sortedObj.hasActivationRequired = group.hasActivationRequired ?? false;
    sortedObj.label = group.label;

    if (group.permissionSets && group.permissionSets.length > 0) {
      sortedObj.permissionSets = [...group.permissionSets].sort();
    }
    sortedObj.status = group.status || 'Updated';

    const xml = this.builder.build({ PermissionSetGroup: sortedObj });
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`;
  }

  private normalizeProfile(raw: Record<string, any>): ProfileMetadata {
    return {
      custom: raw.custom === true || raw.custom === 'true',
      description: raw.description,
      userLicense: raw.userLicense,
      applicationVisibilities: this.ensureArray(raw.applicationVisibilities),
      classAccesses: this.ensureArray(raw.classAccesses).map((c: any) => ({
        apexClass: c.apexClass,
        enabled: Boolean(c.enabled),
      })),
      customPermissions: this.ensureArray(raw.customPermissions).map((c: any) => ({
        name: c.name,
        enabled: Boolean(c.enabled),
      })),
      fieldPermissions: this.ensureArray(raw.fieldPermissions).map((f: any) => ({
        field: f.field,
        readable: Boolean(f.readable),
        editable: Boolean(f.editable),
      })),
      objectPermissions: this.ensureArray(raw.objectPermissions).map((o: any) => ({
        object: o.object,
        allowCreate: Boolean(o.allowCreate),
        allowRead: Boolean(o.allowRead),
        allowEdit: Boolean(o.allowEdit),
        allowDelete: Boolean(o.allowDelete),
        viewAllRecords: Boolean(o.viewAllRecords),
        modifyAllRecords: Boolean(o.modifyAllRecords),
      })),
      pageAccesses: this.ensureArray(raw.pageAccesses).map((p: any) => ({
        apexPage: p.apexPage,
        enabled: Boolean(p.enabled),
      })),
      recordTypeVisibilities: this.ensureArray(raw.recordTypeVisibilities).map((r: any) => ({
        recordType: r.recordType,
        visible: Boolean(r.visible),
        default: r.default !== undefined ? Boolean(r.default) : undefined,
        personAccountDefault:
          r.personAccountDefault !== undefined ? Boolean(r.personAccountDefault) : undefined,
      })),
      tabVisibilities: this.ensureArray(raw.tabVisibilities).map((t: any) => ({
        tab: t.tab,
        visibility: t.visibility,
      })),
      userPermissions: this.ensureArray(raw.userPermissions).map((u: any) => ({
        name: u.name,
        enabled: Boolean(u.enabled),
      })),
      loginHours: raw.loginHours,
      loginIpRanges: this.ensureArray(raw.loginIpRanges),
      layoutAssignments: this.ensureArray(raw.layoutAssignments),
    };
  }

  private normalizePermissionSet(raw: Record<string, any>): PermissionSetMetadata {
    return {
      label: raw.label || '',
      description: raw.description,
      hasActivationRequired: Boolean(raw.hasActivationRequired),
      license: raw.license,
      applicationVisibilities: this.ensureArray(raw.applicationVisibilities),
      classAccesses: this.ensureArray(raw.classAccesses),
      customPermissions: this.ensureArray(raw.customPermissions),
      fieldPermissions: this.ensureArray(raw.fieldPermissions),
      objectPermissions: this.ensureArray(raw.objectPermissions),
      pageAccesses: this.ensureArray(raw.pageAccesses),
      recordTypeVisibilities: this.ensureArray(raw.recordTypeVisibilities),
      tabSettings: this.ensureArray(raw.tabSettings),
      userPermissions: this.ensureArray(raw.userPermissions),
    };
  }

  private ensureArray<T>(val: T | T[] | undefined): T[] {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  }
}
