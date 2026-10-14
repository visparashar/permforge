import { PermissionSetMetadata, PermissionSetGroupMetadata } from './metadata.js';

export type DecompositionStrategy = 'by-domain' | 'by-object' | 'consolidated' | 'tiered';

export interface DecomposeOptions {
  strategy?: DecompositionStrategy;
  prefix?: string;
  outputDir: string;
  createGroup?: boolean;
  groupName?: string;
  includeLicense?: boolean;
  cleanObsolete?: boolean;
}

export interface GeneratedPermissionSet {
  fileName: string;
  apiName: string;
  metadata: PermissionSetMetadata;
  category: 'domain' | 'admin' | 'apex' | 'custom' | 'base';
}

export interface GeneratedPermissionSetGroup {
  fileName: string;
  apiName: string;
  metadata: PermissionSetGroupMetadata;
}

export interface DecompositionResult {
  sourceProfile: string;
  strategy: DecompositionStrategy;
  permissionSets: GeneratedPermissionSet[];
  permissionSetGroup?: GeneratedPermissionSetGroup;
  stats: {
    totalPermissionSets: number;
    totalObjectsCovered: number;
    totalFieldsCovered: number;
    totalUserPermissionsCovered: number;
    totalApexClassesCovered: number;
  };
}

export interface ProfileAnalysis {
  name: string;
  filePath: string;
  userLicense?: string;
  custom: boolean;
  metrics: {
    objectPermissionsCount: number;
    fieldPermissionsCount: number;
    userPermissionsCount: number;
    classAccessesCount: number;
    customPermissionsCount: number;
    tabVisibilitiesCount: number;
    recordTypeVisibilitiesCount: number;
  };
  highRiskPermissions: string[];
  suggestedPermissionSets: {
    name: string;
    description: string;
    itemCount: number;
  }[];
  complexityScore: number; // 0 - 100
}

export interface ParityMismatch {
  type: 'object' | 'field' | 'userPermission' | 'classAccess' | 'customPermission' | 'tab';
  identifier: string;
  detail: string;
  severity: 'missing' | 'surplus' | 'divergent';
}

export interface ParityReport {
  profileName: string;
  targetGroupName?: string;
  targetPermissionSets: string[];
  is100PercentMatch: boolean;
  parityScore: number; // 0.0 to 100.0%
  totalOriginalPermissions: number;
  totalTargetPermissions: number;
  mismatches: ParityMismatch[];
  summary: {
    objectsMatch: boolean;
    fieldsMatch: boolean;
    userPermissionsMatch: boolean;
    apexMatch: boolean;
    tabsMatch: boolean;
  };
}

export interface ClusterOptions {
  threshold?: number; // e.g. 0.75 for 75%
  baselineName?: string;
  outputDir: string;
  createGroups?: boolean;
}

export interface ProfileDelta {
  profileName: string;
  deltaPermissionSets: GeneratedPermissionSet[];
  permissionSetGroup?: GeneratedPermissionSetGroup;
  stats: {
    basePermissionsUsed: number;
    deltaPermissionsCount: number;
  };
}

export interface ClusterResult {
  totalProfilesAnalyzed: number;
  thresholdUsed: number;
  baselinePermissionSet: GeneratedPermissionSet;
  profileDeltas: ProfileDelta[];
  stats: {
    baselineObjectsCount: number;
    baselineFieldsCount: number;
    baselineUserPermsCount: number;
    totalDeltasCreated: number;
  };
}
