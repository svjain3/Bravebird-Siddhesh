import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';

export interface DataStackProps extends cdk.StackProps {
    networkStack: NetworkStack;
}

export class DataStack extends cdk.Stack {
    public readonly jobsTable: dynamodb.Table;
    public readonly sessionsTable: dynamodb.Table;
    public readonly botConfigTable: dynamodb.Table;
    public readonly eligibilityCacheTable: dynamodb.Table;
    public readonly voiceLogsTable: dynamodb.Table;
    public readonly artifactsBucket: s3.Bucket;
    public readonly redisReplicationGroup: elasticache.CfnReplicationGroup;
    public readonly redisSecret: string; // Ideally secret value comes from SecretsManager

    constructor(scope: Construct, id: string, props: DataStackProps) {
        super(scope, id, props);

        this.artifactsBucket = new s3.Bucket(this, 'Artifacts', {
            bucketName: `bravebird-artifacts-${this.account}-${this.region}`,
            encryption: s3.BucketEncryption.KMS_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true,
            lifecycleRules: [
                {
                    transitions: [
                        { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(30) },
                        { storageClass: s3.StorageClass.GLACIER, transitionAfter: cdk.Duration.days(90) },
                    ]
                }
            ],
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // DynamoDB Tables
        this.jobsTable = new dynamodb.Table(this, 'Jobs', {
            tableName: 'bravebird-jobs',
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            timeToLiveAttribute: 'ttl',
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        this.jobsTable.addGlobalSecondaryIndex({
            indexName: 'tenant-created',
            partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'created_at', type: dynamodb.AttributeType.NUMBER },
        });
        this.jobsTable.addGlobalSecondaryIndex({
            indexName: 'status-updated',
            partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'updated_at', type: dynamodb.AttributeType.NUMBER },
        });
        this.jobsTable.addGlobalSecondaryIndex({
            indexName: 'patient-created',
            partitionKey: { name: 'patient_id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'created_at', type: dynamodb.AttributeType.NUMBER },
        });

        this.sessionsTable = new dynamodb.Table(this, 'Sessions', {
            tableName: 'bravebird-sessions',
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.botConfigTable = new dynamodb.Table(this, 'BotConfig', {
            tableName: 'bravebird-bot-config',
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.eligibilityCacheTable = new dynamodb.Table(this, 'EligibilityCache', {
            tableName: 'bravebird-eligibility-cache',
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.voiceLogsTable = new dynamodb.Table(this, 'VoiceLogs', {
            tableName: 'bravebird-voice-logs',
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Redis Subnet Group
        const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            description: 'Subnet group for Redis',
            subnetIds: props.networkStack.vpc.selectSubnets({ subnetGroupName: 'isolated-data' }).subnetIds,
        });

        // Redis
        // For local dev with CDK it's hard to inject secrets directly without creating them dynamically
        // In production, use SecretsManager. Here using a dummy token or parameter store reference would be better
        // But for simplicity following LLD structure to create the resource concept.
        this.redisReplicationGroup = new elasticache.CfnReplicationGroup(this, 'Redis', { // LLD used CfnReplicationGroup
            replicationGroupDescription: 'Bravebird session cache',
            engine: 'redis',
            cacheNodeType: 'cache.r6g.large',
            numCacheClusters: 2,
            transitEncryptionEnabled: true,
            atRestEncryptionEnabled: true,
            authToken: 'auth-token-should-be-secret-123', // INSECURE: Placeholder
            cacheSubnetGroupName: subnetGroup.ref,
            securityGroupIds: [props.networkStack.sgRedis.securityGroupId],
        });
    }
}
