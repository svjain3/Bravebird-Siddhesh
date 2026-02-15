import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Duration, Stack, RemovalPolicy } from 'aws-cdk-lib';

export interface FargateWorkerProps {
    cpu: number;
    memoryLimitMiB: number;
    image: ecs.ContainerImage;
    environment?: { [key: string]: string };
    secrets?: { [key: string]: ecs.Secret };
    stopTimeout?: Duration;
    workerRole: iam.IRole;
    executionRole: iam.IRole;
    logGroupName: string;
}

export class FargateWorker extends Construct {
    public readonly taskDefinition: ecs.FargateTaskDefinition;
    public readonly logGroup: logs.LogGroup;

    constructor(scope: Construct, id: string, props: FargateWorkerProps) {
        super(scope, id);

        this.logGroup = new logs.LogGroup(this, 'LogGroup', {
            logGroupName: props.logGroupName,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
            cpu: props.cpu,
            memoryLimitMiB: props.memoryLimitMiB,
            taskRole: props.workerRole,
            executionRole: props.executionRole,
        });

        // Firelens sidecar
        this.taskDefinition.addFirelensLogRouter('firelens', {
            image: ecs.ContainerImage.fromRegistry('amazon/aws-for-fluent-bit:latest'),
            essential: true,
            firelensConfig: { type: ecs.FirelensLogRouterType.FLUENTBIT },
            memoryReservationMiB: 50,
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'firelens',
                logGroup: this.logGroup,
            }),
        });

        this.taskDefinition.addContainer('agent', {
            image: props.image,
            startTimeout: Duration.seconds(120),
            stopTimeout: props.stopTimeout || Duration.seconds(120),
            logging: ecs.LogDrivers.firelens({
                options: {
                    Name: 'cloudwatch',
                    region: Stack.of(this).region,
                    log_group_name: props.logGroupName,
                    auto_create_group: 'true',
                    log_stream_prefix: 'agent-',
                },
            }),
            environment: props.environment,
            secrets: props.secrets,
        });
    }
}
