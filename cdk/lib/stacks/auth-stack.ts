import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2auth from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';

export interface AuthStackProps extends cdk.StackProps {
    networkStack: NetworkStack;
}

export class AuthStack extends cdk.Stack {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly httpApi: apigwv2.HttpApi;
    public readonly authorizer: apigwv2auth.HttpUserPoolAuthorizer;

    constructor(scope: Construct, id: string, props: AuthStackProps) {
        super(scope, id, props);

        this.userPool = new cognito.UserPool(this, 'BravebirdUsers', {
            selfSignUpEnabled: false,
            signInAliases: { email: true },
            mfa: cognito.Mfa.REQUIRED,
            mfaSecondFactor: { sms: true, otp: true },
            customAttributes: {
                tenant_id: new cognito.StringAttribute({ mutable: false }),
                hospital_id: new cognito.StringAttribute({ mutable: false }),
                role: new cognito.StringAttribute({ mutable: true }),
            },
            passwordPolicy: { minLength: 12, requireSymbols: true },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.userPoolClient = this.userPool.addClient('WebClient', {
            authFlows: { userSrp: true },
            accessTokenValidity: cdk.Duration.hours(1),
            idTokenValidity: cdk.Duration.hours(1),
        });

        this.authorizer = new apigwv2auth.HttpUserPoolAuthorizer('CognitoAuth', this.userPool, {
            userPoolClients: [this.userPoolClient],
        });

        this.httpApi = new apigwv2.HttpApi(this, 'BravebirdApi', {
            corsPreflight: {
                allowOrigins: ['https://app.bravebird.com', '*'], // Allow specific domain in prod
                allowMethods: [apigwv2.CorsHttpMethod.ANY],
                allowHeaders: ['Authorization', 'Content-Type'],
            },
        });

        // Routes will be added in Compute Stack where integrations are defined, or here if integration targets are available
        // But since integration targets (ALB) are in ComputeStack, maybe we should export the API and add routes there
        // OR pass the integration to this stack.
        // The plan says "integration: albIntegration" in auth-stack.ts but ALB is in ComputeStack.
        // To avoid circular dependency (Compute depends on Network, Auth depends on ?), 
        // ComputeStack should probably add the routes to this API or we pass the integration here.
        // Network -> Auth -> Queue -> Compute?
        // Let's see dependencies:
        // Compute needs Auth (for API), Network (for VPC).
        // It's better to create API in ComputeStack or have a separate ApiStack?
        // The plan says AuthStack contains API Gateway.
        // So ComputeStack will depend on AuthStack and add the integration.
    }
}
