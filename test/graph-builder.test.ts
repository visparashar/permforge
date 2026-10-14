import { describe, it, expect } from 'vitest';
import { GraphBuilder, GraphData } from '../src/engine/graph-builder.js';

describe('GraphBuilder', () => {
  const builder = new GraphBuilder();

  const sampleData: GraphData = {
    groups: [
      {
        name: 'Sales_PSG',
        metadata: {
          label: 'Sales PSG',
          permissionSets: ['Sales_Account_CRUD', 'Sales_Opp_CRUD'],
        },
      },
    ],
    permSets: [
      {
        name: 'Sales_Account_CRUD',
        metadata: {
          label: 'Sales Account CRUD',
          objectPermissions: [
            {
              object: 'Account',
              allowRead: true,
              allowCreate: true,
              allowEdit: true,
              allowDelete: false,
            },
          ],
        },
      },
      {
        name: 'Sales_Opp_CRUD',
        metadata: {
          label: 'Sales Opp CRUD',
          objectPermissions: [
            {
              object: 'Opportunity',
              allowRead: true,
              allowCreate: true,
              allowEdit: true,
              allowDelete: false,
            },
          ],
        },
      },
    ],
  };

  it('should generate Mermaid diagram properly', () => {
    const mermaid = builder.generateMermaid(sampleData);
    expect(mermaid).toContain('flowchart TD');
    expect(mermaid).toContain('Sales_PSG');
    expect(mermaid).toContain('Sales_Account_CRUD');
    expect(mermaid).toContain('Account');
    expect(mermaid).toContain('Opportunity');
    expect(mermaid).toContain('G_Sales_PSG --> PS_Sales_Account_CRUD');
    expect(mermaid).toContain('PS_Sales_Account_CRUD --> OBJ_Account');
  });

  it('should generate ASCII tree correctly', () => {
    const tree = builder.generateAsciiTree(sampleData);
    expect(tree).toContain('📦 [PSG] Sales_PSG');
    expect(tree).toContain('🔑 [PS] Sales_Account_CRUD');
    expect(tree).toContain('📄 Account');
  });
});
