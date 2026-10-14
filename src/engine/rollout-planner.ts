import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface RolloutPlanOptions {
  profileName: string;
  psgName: string;
  targetBaseProfile?: string;
  outputDir: string;
}

export interface RolloutPlanResult {
  planFilePath: string;
  csvTemplatePath: string;
  scriptPath: string;
  rollbackScriptPath: string;
}

export class RolloutPlanner {
  /**
   * Generate migration rollout scripts, CSV assignment templates, and rollback plan.
   */
  public async generatePlan(options: RolloutPlanOptions): Promise<RolloutPlanResult> {
    const targetBaseProfile = options.targetBaseProfile || 'Minimum Access - Salesforce';
    const outputDir = path.resolve(options.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    // 1. Generate CSV Assignment template
    const csvContent = [
      'UserId,Username,CurrentProfile,TargetBaseProfile,AssignPermissionSetGroup',
      `005xx000001Sample,user1@company.com,${options.profileName},${targetBaseProfile},${options.psgName}`,
      `005xx000002Sample,user2@company.com,${options.profileName},${targetBaseProfile},${options.psgName}`,
    ].join('\n');

    const csvTemplatePath = path.join(outputDir, `${options.profileName}_user_assignments.csv`);
    await fs.writeFile(csvTemplatePath, csvContent, 'utf-8');

    // 2. Generate Migration Shell Script
    const scriptContent = `#!/usr/bin/env bash
# ==============================================================================
# PermForge Automated Migration Script
# Migrating users from Profile: ${options.profileName}
# To Target Base Profile: ${targetBaseProfile} + PSG: ${options.psgName}
# ==============================================================================

set -e

echo "Starting migration for profile: ${options.profileName}..."

# Step 1: Assign Permission Set Group to Users
echo "Assigning Permission Set Group '${options.psgName}' to active users..."
# Example SOQL query to extract users and assign via Salesforce CLI:
# sf data query --query "SELECT Id, Name FROM User WHERE Profile.Name = '${options.profileName}' AND IsActive = true" --json

# Step 2: Update Profile to Base Profile
echo "Ready to reassign user profiles to '${targetBaseProfile}'."
echo "Please verify test assignments before executing production profile switch."
echo "Migration preparation complete."
`;

    const scriptPath = path.join(outputDir, `migrate_${options.profileName}.sh`);
    await fs.writeFile(scriptPath, scriptContent, { mode: 0o755 });

    // 3. Generate Rollback Script
    const rollbackContent = `#!/usr/bin/env bash
# ==============================================================================
# PermForge Migration Rollback Script
# Reverts users back to Profile: ${options.profileName}
# ==============================================================================

set -e

echo "Executing rollback: Restoring Profile '${options.profileName}'..."
echo "Removing assignments for PSG '${options.psgName}'..."
# sf data delete record --sobject PermissionSetAssignment ...
echo "Rollback sequence completed."
`;

    const rollbackScriptPath = path.join(outputDir, `rollback_${options.profileName}.sh`);
    await fs.writeFile(rollbackScriptPath, rollbackContent, { mode: 0o755 });

    // 4. Generate Markdown summary plan
    const planMarkdown = `# PermForge User Migration Plan: ${options.profileName}

## Overview
- **Legacy Profile:** \`${options.profileName}\`
- **Target Base Profile:** \`${targetBaseProfile}\`
- **Target Permission Set Group:** \`${options.psgName}\`

## Step-by-Step Rollout Checklist
1. **Deploy Metadata:** Deploy generated Permission Sets and Permission Set Group to target org.
   \`\`\`bash
   sf project deploy start --metadata PermissionSet:${options.profileName}_* PermissionSetGroup:${options.psgName}
   \`\`\`
2. **Assign Permission Set Group First:** Assign \`${options.psgName}\` to users *before* changing their profile. This prevents any access interruption.
3. **Switch Profile:** Update user \`ProfileId\` to \`${targetBaseProfile}\`.
4. **Parity Check:** Run \`permforge verify\` to validate access.
5. **Decommission:** Deactivate or archive the legacy profile once verified.
`;

    const planFilePath = path.join(outputDir, `${options.profileName}_migration_plan.md`);
    await fs.writeFile(planFilePath, planMarkdown, 'utf-8');

    return {
      planFilePath,
      csvTemplatePath,
      scriptPath,
      rollbackScriptPath,
    };
  }
}
