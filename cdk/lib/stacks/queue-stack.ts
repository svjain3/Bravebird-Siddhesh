import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';
import { ComputeStack } from './compute-stack';
import { DataStack } from './data-stack';
import { SqsWithDlq } from '../constructs/sqs-with-dlq';

export interface QueueStackProps extends cdk.StackProps {
    networkStack: NetworkStack;
    computeStack: ComputeStack;
    dataStack: DataStack;
}

export class QueueStack extends cdk.Stack {
    public readonly cuaQueueHigh: SqsWithDlq;
    public readonly cuaQueueNormal: SqsWithDlq;
    public readonly cuaQueueLow: SqsWithDlq;
    public readonly voiceQueue: SqsWithDlq;
    public readonly dispatcherLambda: lambda.Function;
    public readonly recoveryLambda: lambda.Function;

    constructor(scope: Construct, id: string, props: QueueStackProps) {
        super(scope, id, props);

        // CUA FIFO Queues
        this.cuaQueueHigh = new SqsWithDlq(this, 'CuaQueueHigh', {
            queueName: 'bravebird-cua-high',
            fifo: true,
            visibilityTimeout: cdk.Duration.minutes(20),
        });

        this.cuaQueueNormal = new SqsWithDlq(this, 'CuaQueueNormal', {
            queueName: 'bravebird-cua-normal',
            fifo: true,
            visibilityTimeout: cdk.Duration.minutes(20),
        });

        this.cuaQueueLow = new SqsWithDlq(this, 'CuaQueueLow', {
            queueName: 'bravebird-cua-low',
            fifo: true,
            visibilityTimeout: cdk.Duration.minutes(20),
        });

        // Voice Standard Queue
        this.voiceQueue = new SqsWithDlq(this, 'VoiceQueue', {
            queueName: 'bravebird-voice',
            fifo: false,
            visibilityTimeout: cdk.Duration.minutes(15),
        });

        // Lambda Dispatcher Role
        const dispatcherRole = new iam.Role(this, 'DispatcherRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        });

        // Grant permissions
        // Grant permissions
        // props.computeStack.cluster.grantTaskExecute(dispatcherRole); // Removed invalid call as Cluster does not support this method
        dispatcherRole.addToPolicy(new iam.PolicyStatement({
            actions: ['ecs:RunTask'],
            resources: [props.computeStack.cuaWorker.taskDefinition.taskDefinitionArn, props.computeStack.voiceWorker.taskDefinition.taskDefinitionArn],
        }));
        dispatcherRole.addToPolicy(new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: ['*'], // Needs refinement to specifically pass execution/task roles
        }));
        props.dataStack.jobsTable.grantReadWriteData(dispatcherRole);

        // Lambda Dispatcher Function
        this.dispatcherLambda = new lambda.Function(this, 'Dispatcher', {
            functionName: 'bravebird-dispatcher',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'dispatcher.handler',
            code: lambda.Code.fromAsset('lambda/dispatcher'),
            role: dispatcherRole,
            // reservedConcurrentExecutions removed - account limit too low
            timeout: cdk.Duration.seconds(30),
            environment: {
                ECS_CLUSTER: props.computeStack.cluster.clusterArn,
                CUA_TASK_DEF: props.computeStack.cuaWorker.taskDefinition.taskDefinitionArn,
                VOICE_TASK_DEF: props.computeStack.voiceWorker.taskDefinition.taskDefinitionArn,
                COMPUTE_SUBNETS: props.networkStack.vpc.selectSubnets({ subnetGroupName: 'private-compute' }).subnetIds.join(','),
                COMPUTE_SG: props.networkStack.sgCompute.securityGroupId,
                JOBS_TABLE: props.dataStack.jobsTable.tableName,
            },
        });

        // Event Sources
        this.dispatcherLambda.addEventSource(new SqsEventSource(this.cuaQueueHigh.queue, { batchSize: 1 }));
        this.dispatcherLambda.addEventSource(new SqsEventSource(this.cuaQueueNormal.queue, { batchSize: 1 }));
        this.dispatcherLambda.addEventSource(new SqsEventSource(this.cuaQueueLow.queue, { batchSize: 1 }));
        this.dispatcherLambda.addEventSource(new SqsEventSource(this.voiceQueue.queue, { batchSize: 1 }));

        // Recovery Lambda Role
        const recoveryRole = new iam.Role(this, 'RecoveryRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        });
        props.dataStack.jobsTable.grantReadWriteData(recoveryRole);
        this.voiceQueue.queue.grantSendMessages(recoveryRole);

        // Recovery Lambda Function
        this.recoveryLambda = new lambda.Function(this, 'RecoveryLambda', {
            functionName: 'bravebird-recovery',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'recovery.handler',
            code: lambda.Code.fromAsset('lambda/recovery'),
            role: recoveryRole,
            timeout: cdk.Duration.seconds(30),
            environment: {
                JOBS_TABLE: props.dataStack.jobsTable.tableName,
                VOICE_QUEUE_URL: this.voiceQueue.queue.queueUrl,
            },
        });
    }
}
