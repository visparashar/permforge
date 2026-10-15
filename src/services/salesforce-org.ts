import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { Connection } from 'jsforce';
import { LoadedProfile } from '../parser/profile-reader.js';
import { ProfileMetadata } from '../types/metadata.js';
import { XmlEngine } from '../parser/xml-engine.js';
import { GeneratedPermissionSet, GeneratedPermissionSetGroup } from '../types/decomposition.js';

export interface OrgAuthResult {
  instanceUrl: string;
  accessToken: string;
  username: string;
  orgId?: string;
  alias?: string;
}

export interface RemoteProfileSummary {
  id: string;
  name: string;
  userType: string;
  custom: boolean;
  createdDate?: string;
  lastModifiedDate?: string;
}

export interface UserAssignmentTarget {
  id: string;
  name: string;
  label?: string;
  type: 'PermissionSetGroup' | 'PermissionSet';
}

export interface UserToAssign {
  id: string;
  username: string;
  name: string;
  email: string;
  isActive: boolean;
  profileId: string;
  profileName: string;
  alreadyAssigned?: boolean;
}

export interface AssignmentPlan {
  profileName: string;
  target: UserAssignmentTarget;
  totalUsersFound: number;
  activeUsersCount: number;
  inactiveUsersCount: number;
  alreadyAssignedCount: number;
  usersToAssign: UserToAssign[];
  skippedUsers: UserToAssign[];
}

export interface AssignmentResult {
  success: boolean;
  plan: AssignmentPlan;
  assignedCount: number;
  failedCount: number;
  assignments: {
    userId: string;
    username: string;
    assignmentId?: string;
    success: boolean;
    error?: string;
  }[];
  rollbackFile?: string;
}

export interface RollbackResult {
  success: boolean;
  deletedCount: number;
  failedCount: number;
  errors: string[];
}

export interface AssignmentRollbackManifest {
  version: string;
  timestamp: string;
  targetOrg: string;
  profileName: string;
  target: UserAssignmentTarget;
  createdAssignmentIds: string[];
  assignments: {
    userId: string;
    username: string;
    assignmentId: string;
  }[];
}

export class SalesforceOrgService {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
  }

  /**
   * List all authorized Salesforce orgs known to the CLI or ~/.sfdx
   */
  public listAuthorizedOrgs(): { username: string; alias?: string; isDefault?: boolean }[] {
    const orgs: { username: string; alias?: string; isDefault?: boolean }[] = [];
    const seen = new Set<string>();

    // 1. Try sf org list --json
    try {
      const raw = execSync('sf org list --json', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const data = JSON.parse(raw);
      const allOrgs = [
        ...(data?.result?.nonScratchOrgs || []),
        ...(data?.result?.sandboxes || []),
        ...(data?.result?.scratchOrgs || []),
      ];
      for (const org of allOrgs) {
        if (org.username && !seen.has(org.username)) {
          seen.add(org.username);
          orgs.push({
            username: org.username,
            alias: org.alias || (org.name && org.name !== 'Developer Edition' ? org.name : undefined),
            isDefault: !!org.isDefaultUsername,
          });
        }
      }
      if (orgs.length > 0) return orgs;
    } catch {
      // ignore
    }

    // 2. Fallback: inspect ~/.sfdx
    try {
      const homedir = os.homedir();
      const sfdxDir = path.join(homedir, '.sfdx');
      let aliasMap: Record<string, string> = {};
      if (fs.existsSync(path.join(sfdxDir, 'alias.json'))) {
        const aliasData = JSON.parse(fs.readFileSync(path.join(sfdxDir, 'alias.json'), 'utf-8'));
        aliasMap = aliasData?.orgs || {};
      }
      let defaultUser: string | undefined;
      if (fs.existsSync(path.join(sfdxDir, 'sfdx-config.json'))) {
        const configData = JSON.parse(fs.readFileSync(path.join(sfdxDir, 'sfdx-config.json'), 'utf-8'));
        defaultUser = configData['defaultusername'];
      }
      const userToAlias: Record<string, string> = {};
      for (const [alias, user] of Object.entries(aliasMap)) {
        userToAlias[user] = alias;
      }

      if (fs.existsSync(sfdxDir)) {
        const files = fs.readdirSync(sfdxDir);
        for (const file of files) {
          if (file.endsWith('.json') && file !== 'alias.json' && file !== 'sfdx-config.json') {
            const user = file.replace('.json', '');
            if (!seen.has(user)) {
              seen.add(user);
              orgs.push({
                username: user,
                alias: userToAlias[user],
                isDefault: user === defaultUser,
              });
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return orgs;
  }

  /**
   * Resolve authentication credentials for a target org from:
   * 1. Environment variables (SF_ACCESS_TOKEN, SF_INSTANCE_URL)
   * 2. Salesforce CLI (`sf org auth show-access-token` / `sf org display`)
   * 3. Local ~/.sfdx or ~/.sf auth files
   */
  public resolveAuth(targetOrg?: string): OrgAuthResult {
    // 1. Check environment variables
    if (process.env.SF_ACCESS_TOKEN && process.env.SF_INSTANCE_URL) {
      return {
        instanceUrl: process.env.SF_INSTANCE_URL,
        accessToken: process.env.SF_ACCESS_TOKEN,
        username: process.env.SF_USERNAME || 'env-authenticated-user',
      };
    }

    // 2. Try sf CLI if available (handles token refresh automatically)
    try {
      const orgFlag = targetOrg ? `--target-org "${targetOrg}"` : '';
      const tokenCmd = `sf org auth show-access-token ${orgFlag} --json`;
      const dispCmd = `sf org display ${orgFlag} --json`;

      const tokenRaw = execSync(tokenCmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const dispRaw = execSync(dispCmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

      const tokenData = JSON.parse(tokenRaw);
      const dispData = JSON.parse(dispRaw);

      if (tokenData?.result?.accessToken && dispData?.result?.instanceUrl) {
        return {
          instanceUrl: dispData.result.instanceUrl,
          accessToken: tokenData.result.accessToken,
          username: dispData.result.username || targetOrg || 'default-user',
          orgId: dispData.result.id,
        };
      }
    } catch {
      // sf CLI invocation failed or not in PATH, fallback to direct file inspection
    }

    // 3. Fallback: Inspect local ~/.sfdx and ~/.sf directories
    const homedir = os.homedir();
    const sfdxDir = path.join(homedir, '.sfdx');
    const sfDir = path.join(homedir, '.sf');

    let resolvedUsername = targetOrg;

    // Check alias mapping if targetOrg is an alias
    if (targetOrg && fs.existsSync(path.join(sfdxDir, 'alias.json'))) {
      try {
        const aliasData = JSON.parse(fs.readFileSync(path.join(sfdxDir, 'alias.json'), 'utf-8'));
        if (aliasData?.orgs?.[targetOrg]) {
          resolvedUsername = aliasData.orgs[targetOrg];
        }
      } catch {
        // ignore
      }
    }

    // If no targetOrg specified, find default org
    if (!resolvedUsername && fs.existsSync(path.join(sfdxDir, 'sfdx-config.json'))) {
      try {
        const configData = JSON.parse(fs.readFileSync(path.join(sfdxDir, 'sfdx-config.json'), 'utf-8'));
        resolvedUsername = configData['defaultusername'];
      } catch {
        // ignore
      }
    }

    if (!resolvedUsername && fs.existsSync(path.join(sfDir, 'config.json'))) {
      try {
        const configData = JSON.parse(fs.readFileSync(path.join(sfDir, 'config.json'), 'utf-8'));
        resolvedUsername = configData['target-org'];
      } catch {
        // ignore
      }
    }

    if (resolvedUsername) {
      const sfdxFile = path.join(sfdxDir, `${resolvedUsername}.json`);
      if (fs.existsSync(sfdxFile)) {
        try {
          const authData = JSON.parse(fs.readFileSync(sfdxFile, 'utf-8'));
          if (authData.accessToken && authData.instanceUrl) {
            return {
              instanceUrl: authData.instanceUrl,
              accessToken: authData.accessToken,
              username: authData.username || resolvedUsername,
              orgId: authData.orgId,
            };
          }
        } catch {
          // ignore
        }
      }
    }

    throw new Error(
      `Could not resolve Salesforce credentials for org '${targetOrg || 'default'}'.\n` +
      `Ensure you have logged in via 'sf org login web' or set SF_ACCESS_TOKEN and SF_INSTANCE_URL.`
    );
  }

  /**
   * Instantiate an authenticated jsforce Connection
   */
  public getConnection(targetOrg?: string): Connection {
    const auth = this.resolveAuth(targetOrg);
    return new Connection({
      instanceUrl: auth.instanceUrl,
      accessToken: auth.accessToken,
      version: '60.0',
    });
  }

  /**
   * Query the live org for profiles
   */
  public async listProfiles(
    targetOrg?: string,
    options?: { customOnly?: boolean }
  ): Promise<RemoteProfileSummary[]> {
    const conn = this.getConnection(targetOrg);
    let query = 'SELECT Id, Name, UserType, CreatedDate, LastModifiedDate FROM Profile ORDER BY Name ASC';
    if (options?.customOnly) {
      // In SOQL on Profile, custom profiles have UserType != 'Guest' and can be queried or filtered
      // Standard profiles generally have standard names or UserLicense mappings
      query = "SELECT Id, Name, UserType, CreatedDate, LastModifiedDate FROM Profile WHERE UserType != 'Guest' ORDER BY Name ASC";
    }

    const result = await conn.query<any>(query);
    return result.records.map((r: any) => ({
      id: r.Id,
      name: r.Name,
      userType: r.UserType,
      custom: !r.Name.startsWith('Standard') && r.Name !== 'System Administrator' && r.Name !== 'Read Only',
      createdDate: r.CreatedDate,
      lastModifiedDate: r.LastModifiedDate,
    }));
  }

  /**
   * Retrieve profiles from the live org via Metadata API and convert to LoadedProfile[]
   */
  public async retrieveProfiles(
    profileNames: string[],
    targetOrg?: string,
    options?: { saveToDir?: string }
  ): Promise<LoadedProfile[]> {
    if (profileNames.length === 0) {
      return [];
    }

    const conn = this.getConnection(targetOrg);
    const chunkSize = 10;
    const rawProfiles: any[] = [];

    for (let i = 0; i < profileNames.length; i += chunkSize) {
      const chunk = profileNames.slice(i, i + chunkSize);
      const chunkResult = await conn.metadata.read('Profile', chunk);
      const arrayResult = Array.isArray(chunkResult) ? chunkResult : [chunkResult];
      rawProfiles.push(...arrayResult);
    }

    const loadedProfiles: LoadedProfile[] = [];

    for (const raw of rawProfiles) {
      if (!raw || !raw.fullName) continue;

      const metadata: ProfileMetadata = {
        custom: Boolean(raw.custom),
        userLicense: raw.userLicense || undefined,
        description: raw.description || undefined,
        objectPermissions: this.ensureArray(raw.objectPermissions).map((o: any) => ({
          object: o.object,
          allowCreate: Boolean(o.allowCreate),
          allowRead: Boolean(o.allowRead),
          allowEdit: Boolean(o.allowEdit),
          allowDelete: Boolean(o.allowDelete),
          viewAllRecords: Boolean(o.viewAllRecords),
          modifyAllRecords: Boolean(o.modifyAllRecords),
        })),
        fieldPermissions: this.ensureArray(raw.fieldPermissions).map((f: any) => ({
          field: f.field,
          readable: Boolean(f.readable),
          editable: Boolean(f.editable),
        })),
        userPermissions: this.ensureArray(raw.userPermissions).map((u: any) => ({
          name: u.name,
          enabled: Boolean(u.enabled),
        })),
        classAccesses: this.ensureArray(raw.classAccesses).map((c: any) => ({
          apexClass: c.apexClass,
          enabled: Boolean(c.enabled),
        })),
        customPermissions: this.ensureArray(raw.customPermissions).map((cp: any) => ({
          name: cp.name,
          enabled: Boolean(cp.enabled),
        })),
        tabVisibilities: this.ensureArray(raw.tabVisibilities).map((t: any) => ({
          tab: t.tab,
          visibility: t.visibility || 'DefaultOn',
        })),
        recordTypeVisibilities: this.ensureArray(raw.recordTypeVisibilities).map((rt: any) => ({
          recordType: rt.recordType,
          visible: Boolean(rt.visible),
          default: Boolean(rt.default),
        })),
        loginHours: (raw.loginHours as any) || undefined,
        loginIpRanges: this.ensureArray(raw.loginIpRanges),
        layoutAssignments: this.ensureArray(raw.layoutAssignments),
      };

      const profileName = raw.fullName;
      const fileName = `${profileName}.profile-meta.xml`;

      // Optionally save XML to local disk
      let localPath = `live-org://${profileName}`;
      if (options?.saveToDir) {
        fs.mkdirSync(options.saveToDir, { recursive: true });
        const filePath = path.join(options.saveToDir, fileName);
        const xml = this.xmlEngine.serializeProfile(metadata);
        fs.writeFileSync(filePath, xml, 'utf-8');
        localPath = filePath;
      }

      loadedProfiles.push({
        name: profileName,
        filePath: localPath,
        metadata,
      });
    }

    return loadedProfiles;
  }

  /**
   * Deploy generated Permission Sets to the target org via Metadata API
   */
  public async deployPermissionSets(
    permissionSets: GeneratedPermissionSet[],
    targetOrg?: string
  ): Promise<{ success: boolean; created: string[]; errors: string[] }> {
    if (permissionSets.length === 0) {
      return { success: true, created: [], errors: [] };
    }

    const conn = this.getConnection(targetOrg);
    const created: string[] = [];
    const errors: string[] = [];

    // Salesforce metadata.create accepts up to 10 items at a time
    const chunkSize = 10;
    for (let i = 0; i < permissionSets.length; i += chunkSize) {
      const chunk = permissionSets.slice(i, i + chunkSize);
      const metadatas = chunk.map((ps) => ({
        fullName: ps.apiName,
        label: ps.metadata.label,
        description: ps.metadata.description,
        hasActivationRequired: Boolean(ps.metadata.hasActivationRequired),
        objectPermissions: ps.metadata.objectPermissions,
        fieldPermissions: ps.metadata.fieldPermissions,
        userPermissions: ps.metadata.userPermissions,
        classAccesses: ps.metadata.classAccesses,
        customPermissions: ps.metadata.customPermissions,
        tabSettings: ps.metadata.tabSettings,
      }));

      try {
        const results = await conn.metadata.create('PermissionSet', metadatas);
        const resultArray = Array.isArray(results) ? results : [results];

        for (let j = 0; j < resultArray.length; j++) {
          const res = resultArray[j];
          if (res.success) {
            created.push(res.fullName);
          } else {
            const errs = Array.isArray(res.errors) ? res.errors : [res.errors];
            const msg = errs.map((e: any) => e.message).join(', ');
            errors.push(`${res.fullName}: ${msg}`);
          }
        }
      } catch (err: any) {
        errors.push(`Chunk deploy error: ${err.message}`);
      }
    }

    return {
      success: errors.length === 0,
      created,
      errors,
    };
  }

  /**
   * Deploy generated Permission Set Groups to the target org via Metadata API
   */
  public async deployPermissionSetGroups(
    groups: GeneratedPermissionSetGroup[],
    targetOrg?: string
  ): Promise<{ success: boolean; created: string[]; errors: string[] }> {
    if (groups.length === 0) {
      return { success: true, created: [], errors: [] };
    }

    const conn = this.getConnection(targetOrg);
    const created: string[] = [];
    const errors: string[] = [];

    const metadatas = groups.map((g) => ({
      fullName: g.apiName,
      label: g.metadata.label,
      description: g.metadata.description,
      hasActivationRequired: Boolean(g.metadata.hasActivationRequired),
      status: g.metadata.status || 'Updated',
      permissionSets: g.metadata.permissionSets,
    }));

    try {
      const results = await conn.metadata.create('PermissionSetGroup', metadatas);
      const resultArray = Array.isArray(results) ? results : [results];

      for (const res of resultArray) {
        if (res.success) {
          created.push(res.fullName);
        } else {
          const errs = Array.isArray(res.errors) ? res.errors : [res.errors];
          const msg = errs.map((e: any) => e.message).join(', ');
          errors.push(`${res.fullName}: ${msg}`);
        }
      }
    } catch (err: any) {
      errors.push(`PSG deploy error: ${err.message}`);
    }

    return {
      success: errors.length === 0,
      created,
      errors,
    };
  }

  /**
   * Resolve whether a target name is a PermissionSetGroup or PermissionSet and return its ID
   */
  public async resolveAssignmentTarget(
    targetName: string,
    targetOrg?: string
  ): Promise<UserAssignmentTarget> {
    const conn = this.getConnection(targetOrg);
    const sanitizedName = targetName.replace(/'/g, "\\'");

    // 1. Try PermissionSetGroup first
    try {
      const psgResult = await conn.query<any>(
        `SELECT Id, DeveloperName, MasterLabel FROM PermissionSetGroup WHERE DeveloperName = '${sanitizedName}' OR Id = '${sanitizedName}' LIMIT 1`
      );
      if (psgResult.records && psgResult.records.length > 0) {
        const r = psgResult.records[0];
        return {
          id: r.Id,
          name: r.DeveloperName,
          label: r.MasterLabel,
          type: 'PermissionSetGroup',
        };
      }
    } catch {
      // ignore, fall back to PermissionSet
    }

    // 2. Try PermissionSet
    try {
      const psResult = await conn.query<any>(
        `SELECT Id, Name, Label FROM PermissionSet WHERE Name = '${sanitizedName}' OR Id = '${sanitizedName}' LIMIT 1`
      );
      if (psResult.records && psResult.records.length > 0) {
        const r = psResult.records[0];
        return {
          id: r.Id,
          name: r.Name,
          label: r.Label,
          type: 'PermissionSet',
        };
      }
    } catch (err: any) {
      throw new Error(`Failed to query PermissionSet in target org: ${err.message}`);
    }

    throw new Error(
      `Target '${targetName}' was not found as a Permission Set Group or Permission Set in org '${targetOrg || 'default'}'.\n` +
      `Ensure the target has been deployed or created before assigning users.`
    );
  }

  /**
   * Query users assigned to a specific Salesforce profile
   */
  public async getProfileUsers(
    profileName: string,
    targetOrg?: string,
    options?: { activeOnly?: boolean; userFilter?: string[] }
  ): Promise<UserToAssign[]> {
    const conn = this.getConnection(targetOrg);
    const sanitizedProfile = profileName.replace(/'/g, "\\'");

    let query = `SELECT Id, Username, Name, Email, IsActive, ProfileId, Profile.Name FROM User WHERE Profile.Name = '${sanitizedProfile}'`;
    if (options?.activeOnly !== false) {
      query += ' AND IsActive = true';
    }

    if (options?.userFilter && options.userFilter.length > 0) {
      const escapedUsers = options.userFilter.map((u) => `'${u.replace(/'/g, "\\'")}'`).join(',');
      query += ` AND (Username IN (${escapedUsers}) OR Id IN (${escapedUsers}))`;
    }

    query += ' ORDER BY Name ASC LIMIT 2000';

    const result = await conn.query<any>(query);
    return result.records.map((r: any) => ({
      id: r.Id,
      username: r.Username,
      name: r.Name,
      email: r.Email,
      isActive: Boolean(r.IsActive),
      profileId: r.ProfileId,
      profileName: r.Profile?.Name || profileName,
    }));
  }

  /**
   * Plan user assignments from a Profile to a target PermissionSetGroup or PermissionSet
   */
  public async planUserAssignments(
    profileName: string,
    targetName: string,
    targetOrg?: string,
    options?: { activeOnly?: boolean; userFilter?: string[] }
  ): Promise<AssignmentPlan> {
    const target = await this.resolveAssignmentTarget(targetName, targetOrg);
    const allUsers = await this.getProfileUsers(profileName, targetOrg, {
      activeOnly: false,
      userFilter: options?.userFilter,
    });

    const activeUsers = allUsers.filter((u) => u.isActive);
    const inactiveUsers = allUsers.filter((u) => !u.isActive);

    const candidates = options?.activeOnly === false ? allUsers : activeUsers;

    if (candidates.length === 0) {
      return {
        profileName,
        target,
        totalUsersFound: allUsers.length,
        activeUsersCount: activeUsers.length,
        inactiveUsersCount: inactiveUsers.length,
        alreadyAssignedCount: 0,
        usersToAssign: [],
        skippedUsers: [],
      };
    }

    // Check existing assignments in target org
    const conn = this.getConnection(targetOrg);
    const assignedUserIds = new Set<string>();

    const chunkSize = 500;
    for (let i = 0; i < candidates.length; i += chunkSize) {
      const chunk = candidates.slice(i, i + chunkSize);
      const userIdsList = chunk.map((u) => `'${u.id}'`).join(',');
      const fieldCondition =
        target.type === 'PermissionSetGroup'
          ? `PermissionSetGroupId = '${target.id}'`
          : `PermissionSetId = '${target.id}'`;

      const checkQuery = `SELECT Id, AssigneeId FROM PermissionSetAssignment WHERE AssigneeId IN (${userIdsList}) AND ${fieldCondition}`;
      try {
        const checkResult = await conn.query<any>(checkQuery);
        for (const record of checkResult.records) {
          assignedUserIds.add(record.AssigneeId);
        }
      } catch {
        // ignore if query fails on older API
      }
    }

    const usersToAssign: UserToAssign[] = [];
    const skippedUsers: UserToAssign[] = [];

    for (const user of candidates) {
      if (assignedUserIds.has(user.id)) {
        skippedUsers.push({ ...user, alreadyAssigned: true });
      } else {
        usersToAssign.push({ ...user, alreadyAssigned: false });
      }
    }

    return {
      profileName,
      target,
      totalUsersFound: allUsers.length,
      activeUsersCount: activeUsers.length,
      inactiveUsersCount: inactiveUsers.length,
      alreadyAssignedCount: skippedUsers.length,
      usersToAssign,
      skippedUsers,
    };
  }

  /**
   * Execute planned user assignments against the live Salesforce org and generate a rollback manifest
   */
  public async executeUserAssignments(
    plan: AssignmentPlan,
    targetOrg?: string,
    options?: { rollbackDir?: string }
  ): Promise<AssignmentResult> {
    if (plan.usersToAssign.length === 0) {
      return {
        success: true,
        plan,
        assignedCount: 0,
        failedCount: 0,
        assignments: [],
      };
    }

    const conn = this.getConnection(targetOrg);
    const assignments: {
      userId: string;
      username: string;
      assignmentId?: string;
      success: boolean;
      error?: string;
    }[] = [];

    const createdIds: string[] = [];
    const createdForManifest: { userId: string; username: string; assignmentId: string }[] = [];

    // Salesforce allows up to 200 records per DML create
    const chunkSize = 200;
    for (let i = 0; i < plan.usersToAssign.length; i += chunkSize) {
      const chunk = plan.usersToAssign.slice(i, i + chunkSize);
      const recordsToInsert = chunk.map((user) => {
        if (plan.target.type === 'PermissionSetGroup') {
          return {
            AssigneeId: user.id,
            PermissionSetGroupId: plan.target.id,
          };
        }
        return {
          AssigneeId: user.id,
          PermissionSetId: plan.target.id,
        };
      });

      try {
        const dmlResults = await conn.sobject('PermissionSetAssignment').create(recordsToInsert as any, {
          allowRecursive: true,
        });
        const resultArray = Array.isArray(dmlResults) ? dmlResults : [dmlResults];

        for (let j = 0; j < resultArray.length; j++) {
          const res = resultArray[j];
          const user = chunk[j];

          if (res.success && res.id) {
            createdIds.push(res.id);
            createdForManifest.push({
              userId: user.id,
              username: user.username,
              assignmentId: res.id,
            });
            assignments.push({
              userId: user.id,
              username: user.username,
              assignmentId: res.id,
              success: true,
            });
          } else {
            const errs = Array.isArray(res.errors) ? res.errors : [res.errors];
            const msg = errs.map((e: any) => e.message || String(e)).join(', ');
            assignments.push({
              userId: user.id,
              username: user.username,
              success: false,
              error: msg || 'Unknown DML error',
            });
          }
        }
      } catch (err: any) {
        for (const user of chunk) {
          assignments.push({
            userId: user.id,
            username: user.username,
            success: false,
            error: err.message,
          });
        }
      }
    }

    const assignedCount = assignments.filter((a) => a.success).length;
    const failedCount = assignments.filter((a) => !a.success).length;

    // Write rollback manifest if any assignments succeeded
    let rollbackFile: string | undefined;
    if (createdIds.length > 0) {
      const rollbackDir = options?.rollbackDir || path.join(process.cwd(), 'output', 'rollbacks');
      fs.mkdirSync(rollbackDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      rollbackFile = path.join(rollbackDir, `assignment-rollback-${timestamp}.json`);

      const manifest: AssignmentRollbackManifest = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        targetOrg: targetOrg || 'default',
        profileName: plan.profileName,
        target: plan.target,
        createdAssignmentIds: createdIds,
        assignments: createdForManifest,
      };

      fs.writeFileSync(rollbackFile, JSON.stringify(manifest, null, 2), 'utf-8');
    }

    return {
      success: failedCount === 0,
      plan,
      assignedCount,
      failedCount,
      assignments,
      rollbackFile,
    };
  }

  /**
   * Roll back previously created user assignments using a rollback manifest file
   */
  public async rollbackUserAssignments(
    rollbackFilePath: string,
    targetOrg?: string
  ): Promise<RollbackResult> {
    if (!fs.existsSync(rollbackFilePath)) {
      throw new Error(`Rollback file not found at: ${rollbackFilePath}`);
    }

    const raw = fs.readFileSync(rollbackFilePath, 'utf-8');
    let manifest: AssignmentRollbackManifest;
    try {
      manifest = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON format in rollback file: ${rollbackFilePath}`);
    }

    if (!manifest.createdAssignmentIds || !Array.isArray(manifest.createdAssignmentIds)) {
      throw new Error('Rollback file does not contain valid createdAssignmentIds array.');
    }

    if (manifest.createdAssignmentIds.length === 0) {
      return { success: true, deletedCount: 0, failedCount: 0, errors: [] };
    }

    const conn = this.getConnection(targetOrg || manifest.targetOrg);
    let deletedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    const chunkSize = 200;
    for (let i = 0; i < manifest.createdAssignmentIds.length; i += chunkSize) {
      const chunk = manifest.createdAssignmentIds.slice(i, i + chunkSize);
      try {
        const destroyResults = await conn.sobject('PermissionSetAssignment').destroy(chunk);
        const resultArray = Array.isArray(destroyResults) ? destroyResults : [destroyResults];

        for (const res of resultArray) {
          if (res.success) {
            deletedCount++;
          } else {
            failedCount++;
            const errs = Array.isArray(res.errors) ? res.errors : [res.errors];
            const msg = errs.map((e: any) => e.message || String(e)).join(', ');
            errors.push(msg);
          }
        }
      } catch (err: any) {
        failedCount += chunk.length;
        errors.push(`Rollback batch error: ${err.message}`);
      }
    }

    return {
      success: failedCount === 0,
      deletedCount,
      failedCount,
      errors,
    };
  }

  private ensureArray<T>(val: T | T[] | undefined): T[] {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  }
}
