import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpAlbIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';
import { NetworkStack } from './network-stack';
import { AuthStack } from './auth-stack';
import { DataStack } from './data-stack';
import { FargateWorker } from '../constructs/fargate-worker';
import { TenantScopedRole } from '../constructs/tenant-scoped-role';

export interface ComputeStackProps extends cdk.StackProps {
    networkStack: NetworkStack;
    authStack: AuthStack;
    dataStack: DataStack;
}

export class ComputeStack extends cdk.Stack {
    public readonly cluster: ecs.Cluster;
    public readonly fastApiService: ecsPatterns.ApplicationLoadBalancedFargateService;
    public readonly cuaWorker: FargateWorker;
    public readonly voiceWorker: FargateWorker;

    constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

        this.cluster = new ecs.Cluster(this, 'BravebirdCluster', {
            vpc: props.networkStack.vpc,
            // enable container insights for monitoring
            containerInsights: true,
        });

        // 1. Roles
        const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
        });

        const fastApiTaskRole = new TenantScopedRole(this, 'FastApiTaskRole', {
            roleName: 'bravebird-fastapi-role',
        });
        // Allow API to access DynamoDB
        fastApiTaskRole.addToPolicy(new iam.PolicyStatement({
            actions: ['dynamodb:*'],
            resources: [props.dataStack.jobsTable.tableArn, props.dataStack.sessionsTable.tableArn],
        }));

        // Allow Bedrock access
        fastApiTaskRole.addToPolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: ['*'],
        }));

        // Allow SQS, S3 and DynamoDB list permissions for health checks
        fastApiTaskRole.addToPolicy(new iam.PolicyStatement({
            actions: ['sqs:ListQueues', 's3:ListAllMyBuckets', 'dynamodb:ListTables'],
            resources: ['*'],
        }));

        // 2. ALB (created manually to avoid cyclic dependency with NetworkStack SG)
        const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ApiAlb', {
            vpc: props.networkStack.vpc,
            internetFacing: true,
            securityGroup: props.networkStack.sgAlb,
        });

        // 3. API Service (FastAPI) - Built from Dockerfile
        const apiImage = ecs.ContainerImage.fromAsset(path.join(__dirname, '../../../'), {
            file: 'docker/Dockerfile.api',
            platform: ecr_assets.Platform.LINUX_AMD64,
        });

        this.fastApiService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'FastApiService', {
            cluster: this.cluster,
            cpu: 1024,
            memoryLimitMiB: 2048,
            desiredCount: 1, // Start with 1 to stabilize, scale later
            taskImageOptions: {
                image: apiImage,
                containerPort: 8000,
                taskRole: fastApiTaskRole,
                executionRole: taskExecutionRole,
                environment: {
                    DYNAMODB_JOBS_TABLE: props.dataStack.jobsTable.tableName,
                    DYNAMODB_SESSIONS_TABLE: props.dataStack.sessionsTable.tableName,
                    EPHEMERAL_SQS_QUEUE_HIGH: 'bravebird-cua-high.fifo',
                    EPHEMERAL_SQS_QUEUE_NORMAL: 'bravebird-cua-normal.fifo',
                    EPHEMERAL_SQS_QUEUE_LOW: 'bravebird-cua-low.fifo',
                    EPHEMERAL_SQS_DLQ: 'bravebird-cua-high-dlq.fifo',
                    EPHEMERAL_S3_BUCKET: 'bravebird-artifacts',
                },
            },
            loadBalancer,
            openListener: false,
            securityGroups: [props.networkStack.sgApp],
            assignPublicIp: true, // Ensures tasks can reach ECR/internet even without NAT
            taskSubnets: { subnetGroupName: 'public' }, // Place in public subnet for direct internet access
        });

        // Configure ALB health check to match FastAPI /health endpoint
        this.fastApiService.targetGroup.configureHealthCheck({
            path: '/health',
            healthyHttpCodes: '200',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(10),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 3,
        });

        // 4. API Gateway Integration
        const albIntegration = new HttpAlbIntegration('AlbIntegration', this.fastApiService.listener);

        props.authStack.httpApi.addRoutes({
            path: '/get_eligibility',
            methods: [apigwv2.HttpMethod.POST],
            integration: albIntegration,
            authorizer: props.authStack.authorizer,
        });

        props.authStack.httpApi.addRoutes({
            path: '/get_eligibility_chat',
            methods: [apigwv2.HttpMethod.POST],
            integration: albIntegration,
            authorizer: props.authStack.authorizer,
        });

        // 5. Workers
        // Agent Image - Sharing the same image for agent-based tasks
        const agentImage = ecs.ContainerImage.fromAsset(path.join(__dirname, '../../../'), {
            file: 'docker/Dockerfile.agent',
            platform: ecr_assets.Platform.LINUX_AMD64,
        });

        // CUA Worker
        const cuaWorkerRole = new TenantScopedRole(this, 'CuaWorkerRole', { roleName: 'bravebird-cua-worker' });
        this.cuaWorker = new FargateWorker(this, 'CuaWorker', {
            cpu: 2048,
            memoryLimitMiB: 4096,
            image: agentImage,
            workerRole: cuaWorkerRole,
            executionRole: taskExecutionRole,
            logGroupName: '/bravebird/ecs/cua-worker',
            environment: {
                DYNAMODB_JOBS_TABLE: props.dataStack.jobsTable.tableName,
            }
        });

        // Voice Worker
        const voiceWorkerRole = new TenantScopedRole(this, 'VoiceWorkerRole', { roleName: 'bravebird-voice-worker' });
        this.voiceWorker = new FargateWorker(this, 'VoiceWorker', {
            cpu: 1024,
            memoryLimitMiB: 2048,
            image: agentImage,
            workerRole: voiceWorkerRole,
            executionRole: taskExecutionRole,
            logGroupName: '/bravebird/ecs/voice-worker',
            stopTimeout: cdk.Duration.seconds(120), // Max allowed for Fargate is 120s
            environment: {
                DYNAMODB_JOBS_TABLE: props.dataStack.jobsTable.tableName,
            }
        });

        // 6. Outputs
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: `http://${loadBalancer.loadBalancerDnsName}`,
            description: 'API Endpoint URL',
            exportName: 'ApiEndpoint',
        });

        new cdk.CfnOutput(this, 'ApiDns', {
            value: loadBalancer.loadBalancerDnsName,
            description: 'API Load Balancer DNS',
            exportName: 'BravebirdApiDns',
        });
    }
}
