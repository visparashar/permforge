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

export class SalesforceOrgService {
  private xmlEngine: XmlEngine;

  constructor(xmlEngine?: XmlEngine) {
    this.xmlEngine = xmlEngine || new XmlEngine();
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

  private ensureArray<T>(val: T | T[] | undefined): T[] {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  }
}
