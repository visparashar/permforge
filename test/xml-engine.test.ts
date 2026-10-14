import { describe, it, expect } from 'vitest';
import { XmlEngine } from '../src/parser/xml-engine.js';
import { PermissionSetMetadata, PermissionSetGroupMetadata } from '../src/types/metadata.js';

describe('XmlEngine', () => {
  const engine = new XmlEngine();

  it('should parse Profile XML correctly', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>true</custom>
    <userLicense>Salesforce</userLicense>
    <objectPermissions>
        <allowCreate>true</allowCreate>
        <allowRead>true</allowRead>
        <allowEdit>false</allowEdit>
        <allowDelete>false</allowDelete>
        <object>Account</object>
    </objectPermissions>
    <fieldPermissions>
        <editable>false</editable>
        <field>Account.AnnualRevenue</field>
        <readable>true</readable>
    </fieldPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ApiEnabled</name>
    </userPermissions>
</Profile>`;

    const profile = engine.parseProfile(xml);
    expect(profile.custom).toBe(true);
    expect(profile.userLicense).toBe('Salesforce');
    expect(profile.objectPermissions).toHaveLength(1);
    expect(profile.objectPermissions![0].object).toBe('Account');
    expect(profile.objectPermissions![0].allowCreate).toBe(true);
    expect(profile.objectPermissions![0].allowEdit).toBe(false);
    expect(profile.fieldPermissions).toHaveLength(1);
    expect(profile.fieldPermissions![0].field).toBe('Account.AnnualRevenue');
    expect(profile.fieldPermissions![0].readable).toBe(true);
    expect(profile.userPermissions).toHaveLength(1);
    expect(profile.userPermissions![0].name).toBe('ApiEnabled');
  });

  it('should serialize PermissionSet metadata canonically', () => {
    const permSet: PermissionSetMetadata = {
      label: 'Test Permission Set',
      description: 'Test description',
      hasActivationRequired: false,
      objectPermissions: [
        {
          object: 'Opportunity',
          allowCreate: true,
          allowRead: true,
          allowEdit: true,
          allowDelete: false,
        },
        {
          object: 'Account',
          allowCreate: true,
          allowRead: true,
          allowEdit: false,
          allowDelete: false,
        },
      ],
      fieldPermissions: [
        { field: 'Opportunity.Amount', readable: true, editable: true },
        { field: 'Account.AnnualRevenue', readable: true, editable: false },
      ],
    };

    const xml = engine.serializePermissionSet(permSet);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<label>Test Permission Set</label>');

    // Check alphabetical canonical sorting: Account must appear before Opportunity
    const accountIndex = xml.indexOf('<object>Account</object>');
    const oppIndex = xml.indexOf('<object>Opportunity</object>');
    expect(accountIndex).toBeGreaterThan(-1);
    expect(oppIndex).toBeGreaterThan(-1);
    expect(accountIndex).toBeLessThan(oppIndex);
  });

  it('should serialize PermissionSetGroup metadata correctly', () => {
    const psg: PermissionSetGroupMetadata = {
      label: 'Sales Persona Group',
      description: 'Replaces legacy profile',
      hasActivationRequired: false,
      status: 'Updated',
      permissionSets: ['Sales_Account_CRUD', 'Sales_Opportunity_CRUD'],
    };

    const xml = engine.serializePermissionSetGroup(psg);
    expect(xml).toContain('<PermissionSetGroup xmlns="http://soap.sforce.com/2006/04/metadata">');
    expect(xml).toContain('<permissionSets>Sales_Account_CRUD</permissionSets>');
    expect(xml).toContain('<status>Updated</status>');
  });
});
