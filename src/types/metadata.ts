/**
 * Salesforce Metadata Types for Profiles, Permission Sets, and Permission Set Groups.
 */

export interface ObjectPermission {
  object: string;
  allowCreate: boolean;
  allowRead: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  viewAllRecords?: boolean;
  modifyAllRecords?: boolean;
}

export interface FieldPermission {
  field: string;
  readable: boolean;
  editable: boolean;
}

export interface UserPermission {
  name: string;
  enabled: boolean;
}

export interface ClassAccess {
  apexClass: string;
  enabled: boolean;
}

export interface PageAccess {
  apexPage: string;
  enabled: boolean;
}

export interface CustomPermission {
  name: string;
  enabled: boolean;
}

export interface TabVisibility {
  tab: string;
  visibility: 'DefaultOn' | 'DefaultOff' | 'Hidden';
}

export interface TabSetting {
  tab: string;
  visibility: 'None' | 'Available' | 'Visible';
}

export interface RecordTypeVisibility {
  recordType: string;
  visible: boolean;
  default?: boolean;
  personAccountDefault?: boolean;
}

export interface ApplicationVisibility {
  application: string;
  default: boolean;
  visible: boolean;
}

export interface ProfileMetadata {
  custom?: boolean;
  description?: string;
  userLicense?: string;
  applicationVisibilities?: ApplicationVisibility[];
  classAccesses?: ClassAccess[];
  customPermissions?: CustomPermission[];
  fieldPermissions?: FieldPermission[];
  objectPermissions?: ObjectPermission[];
  pageAccesses?: PageAccess[];
  recordTypeVisibilities?: RecordTypeVisibility[];
  tabVisibilities?: TabVisibility[];
  userPermissions?: UserPermission[];
  // Profile settings that remain profile-only
  loginHours?: Record<string, unknown>;
  loginIpRanges?: Record<string, unknown>[];
  layoutAssignments?: Record<string, unknown>[];
}

export interface PermissionSetMetadata {
  label: string;
  description?: string;
  hasActivationRequired?: boolean;
  license?: string;
  applicationVisibilities?: ApplicationVisibility[];
  classAccesses?: ClassAccess[];
  customPermissions?: CustomPermission[];
  fieldPermissions?: FieldPermission[];
  objectPermissions?: ObjectPermission[];
  pageAccesses?: PageAccess[];
  recordTypeVisibilities?: RecordTypeVisibility[];
  tabSettings?: TabSetting[];
  userPermissions?: UserPermission[];
}

export interface PermissionSetGroupMetadata {
  label: string;
  description?: string;
  hasActivationRequired?: boolean;
  status?: 'Updated' | 'Outdated' | 'Updating';
  permissionSets: string[];
}
