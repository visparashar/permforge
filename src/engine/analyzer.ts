import { LoadedProfile } from '../parser/profile-reader.js';
import { ProfileAnalysis } from '../types/decomposition.js';

const HIGH_RISK_PERMISSIONS = new Set([
  'ModifyAllData',
  'ViewAllData',
  'AuthorApex',
  'ManageUsers',
  'CustomizeApplication',
  'ModifyMetadata',
  'ManageRoles',
  'ManageProfilesPermissionsets',
  'PasswordNeverExpires',
  'ResetUserPasswords',
  'ManageAuthProviders',
  'ManageConnectedApps',
  'ManageCertificates',
]);

export class ProfileAnalyzer {
  /**
   * Analyze a single profile.
   */
  public analyzeProfile(loadedProfile: LoadedProfile): ProfileAnalysis {
    const meta = loadedProfile.metadata;

    const objectPermissions = meta.objectPermissions || [];
    const fieldPermissions = meta.fieldPermissions || [];
    const userPermissions = meta.userPermissions || [];
    const classAccesses = meta.classAccesses || [];
    const customPermissions = meta.customPermissions || [];
    const tabVisibilities = meta.tabVisibilities || [];
    const recordTypeVisibilities = meta.recordTypeVisibilities || [];

    // Filter enabled items
    const enabledUserPerms = userPermissions.filter((p) => p.enabled);
    const activeObjectPerms = objectPermissions.filter(
      (o) => o.allowCreate || o.allowRead || o.allowEdit || o.allowDelete || o.viewAllRecords || o.modifyAllRecords
    );
    const activeFieldPerms = fieldPermissions.filter((f) => f.readable || f.editable);
    const enabledClassAccesses = classAccesses.filter((c) => c.enabled);
    const enabledCustomPerms = customPermissions.filter((c) => c.enabled);

    // Identify high risk permissions
    const highRisk = enabledUserPerms
      .filter((p) => HIGH_RISK_PERMISSIONS.has(p.name))
      .map((p) => p.name);

    // Check for ModifyAllRecords or ViewAllRecords in objects
    for (const obj of activeObjectPerms) {
      if (obj.modifyAllRecords) {
        highRisk.push(`ModifyAllRecords:${obj.object}`);
      }
      if (obj.viewAllRecords) {
        highRisk.push(`ViewAllRecords:${obj.object}`);
      }
    }

    // Complexity score computation (0-100)
    const rawComplexity =
      activeObjectPerms.length * 2 +
      activeFieldPerms.length * 0.1 +
      enabledUserPerms.length * 3 +
      highRisk.length * 5 +
      enabledClassAccesses.length * 1.5;

    const complexityScore = Math.min(100, Math.round(rawComplexity));

    // Calculate suggested modular groupings
    const domainGroups = new Map<string, number>();
    for (const obj of activeObjectPerms) {
      const domain = this.extractDomain(obj.object);
      domainGroups.set(domain, (domainGroups.get(domain) || 0) + 1);
    }

    // Also count field permissions towards domain
    for (const field of activeFieldPerms) {
      const parts = field.field.split('.');
      const domain = this.extractDomain(parts[0]);
      domainGroups.set(domain, (domainGroups.get(domain) || 0) + 1);
    }

    const suggestedPermissionSets = Array.from(domainGroups.entries()).map(([domain, count]) => ({
      name: `${loadedProfile.name}_${domain}`,
      description: `Permission set covering ${domain} object and field security permissions`,
      itemCount: count,
    }));

    if (enabledUserPerms.length > 0) {
      suggestedPermissionSets.push({
        name: `${loadedProfile.name}_System_Permissions`,
        description: 'Administrative and system user capabilities',
        itemCount: enabledUserPerms.length,
      });
    }

    if (enabledClassAccesses.length > 0) {
      suggestedPermissionSets.push({
        name: `${loadedProfile.name}_Apex_Access`,
        description: 'Apex class execution grants',
        itemCount: enabledClassAccesses.length,
      });
    }

    return {
      name: loadedProfile.name,
      filePath: loadedProfile.filePath,
      userLicense: meta.userLicense,
      custom: Boolean(meta.custom),
      metrics: {
        objectPermissionsCount: activeObjectPerms.length,
        fieldPermissionsCount: activeFieldPerms.length,
        userPermissionsCount: enabledUserPerms.length,
        classAccessesCount: enabledClassAccesses.length,
        customPermissionsCount: enabledCustomPerms.length,
        tabVisibilitiesCount: tabVisibilities.length,
        recordTypeVisibilitiesCount: recordTypeVisibilities.length,
      },
      highRiskPermissions: highRisk,
      suggestedPermissionSets,
      complexityScore,
    };
  }

  private extractDomain(sobjectName: string): string {
    // Map standard salesforce objects to business domains
    const standardDomains: Record<string, string> = {
      Account: 'Account_Management',
      Contact: 'Account_Management',
      Lead: 'Sales_Lead',
      Opportunity: 'Sales_Opportunity',
      OpportunityLineItem: 'Sales_Opportunity',
      Case: 'Service_Case',
      CaseComment: 'Service_Case',
      Campaign: 'Marketing_Campaign',
      CampaignMember: 'Marketing_Campaign',
      Contract: 'Sales_Contract',
      Order: 'Sales_Order',
      OrderItem: 'Sales_Order',
      Product2: 'Product_Catalog',
      Pricebook2: 'Product_Catalog',
      PricebookEntry: 'Product_Catalog',
      Task: 'Activity_Management',
      Event: 'Activity_Management',
    };

    if (standardDomains[sobjectName]) {
      return standardDomains[sobjectName];
    }

    // Custom object clean domain name
    return sobjectName.replace(/__c$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
  }
}
