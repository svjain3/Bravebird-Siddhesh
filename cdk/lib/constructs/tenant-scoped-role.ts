import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface TenantScopedRoleProps {
    roleName: string;
    assumedBy?: iam.IPrincipal;
    description?: string;
}

export class TenantScopedRole extends iam.Role {
    constructor(scope: Construct, id: string, props: TenantScopedRoleProps) {
        super(scope, id, {
            roleName: props.roleName,
            assumedBy: props.assumedBy || new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: props.description,
        });
    }

    /**
     * Adds a policy statement that scopes access to resources based on the tenant_id tag.
     * The resource ARN must contain the tenant_id placeholder or be compatible with the condition.
     * Example condition: 'dynamodb:LeadingKeys': ['TENANT#${aws:PrincipalTag/tenant_id}#*']
     */
    public addTenantScopedPolicy(actions: string[], resources: string[], conditionKey?: string, conditionValuePattern?: string) {
        const conditions: { [key: string]: any } = {};

        if (conditionKey && conditionValuePattern) {
            conditions['ForAllValues:StringLike'] = {
                [conditionKey]: [conditionValuePattern]
            };
        }

        this.addToPolicy(new iam.PolicyStatement({
            actions,
            resources,
            conditions: Object.keys(conditions).length > 0 ? conditions : undefined,
        }));
    }
}
