import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { XMLBuilder } from 'fast-xml-parser';

export interface UapPredicate {
  field: string;
  operator: 'Equals' | 'NotEquals' | 'Contains' | 'StartsWith';
  value: string;
}

export interface UapOptions {
  name: string;
  label?: string;
  description?: string;
  psgName: string;
  predicates?: UapPredicate[];
  status?: 'Active' | 'Draft';
  triggerType?: 'CreateUpdate' | 'CreateOnly' | 'Manual';
  outputDir: string;
}

export interface UapResult {
  fileName: string;
  filePath: string;
  developerName: string;
  targetGroup: string;
}

export class UapBuilder {
  private builder: XMLBuilder;

  constructor() {
    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '    ',
      suppressEmptyNode: false,
    });
  }

  /**
   * Generate a standard Salesforce UserAccessPolicy metadata file.
   */
  public async generateUap(options: UapOptions): Promise<UapResult> {
    const devName = options.name.replace(/[^a-zA-Z0-9_]/g, '_');
    const label = options.label || devName.replace(/_/g, ' ');
    const outputDir = path.resolve(options.outputDir, 'userAccessPolicies');
    await fs.mkdir(outputDir, { recursive: true });

    const predicates = options.predicates || [
      {
        field: 'Profile.Name',
        operator: 'Equals',
        value: 'Minimum Access - Salesforce',
      },
    ];

    const uapObj = {
      UserAccessPolicy: {
        '@_xmlns': 'http://soap.sforce.com/2006/04/metadata',
        actions: [
          {
            actionType: 'Grant',
            target: options.psgName,
            type: 'PermissionSetGroup',
          },
        ],
        description:
          options.description ||
          `Automated User Access Policy auto-assigning ${options.psgName} on user creation or update.`,
        developerName: devName,
        masterLabel: label,
        predicates: predicates.map((p) => ({
          field: p.field,
          operator: p.operator,
          value: p.value,
        })),
        status: options.status || 'Active',
        triggerType: options.triggerType || 'CreateUpdate',
      },
    };

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${this.builder.build(uapObj)}\n`;
    const fileName = `${devName}.userAccessPolicy-meta.xml`;
    const filePath = path.join(outputDir, fileName);

    await fs.writeFile(filePath, xml, 'utf-8');

    return {
      fileName,
      filePath,
      developerName: devName,
      targetGroup: options.psgName,
    };
  }
}
