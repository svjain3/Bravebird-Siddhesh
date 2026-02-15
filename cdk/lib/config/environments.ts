export interface EnvironmentConfig {
    account: string;
    region: string;
    vpcCidr: string;
}

export const environments: { [key: string]: EnvironmentConfig } = {
    dev: {
        account: process.env.CDK_DEFAULT_ACCOUNT || '111111111111',
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
        vpcCidr: '10.0.0.0/16'
    },
    staging: {
        account: '111111111111',
        region: 'us-east-1',
        vpcCidr: '10.1.0.0/16'
    },
    prod: {
        account: '222222222222',
        region: 'us-east-1',
        vpcCidr: '10.2.0.0/16'
    },
};
