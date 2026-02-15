import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { QueueStack } from './queue-stack';
import { ComputeStack } from './compute-stack';

export interface MonitoringStackProps extends cdk.StackProps {
    queueStack: QueueStack;
    computeStack: ComputeStack;
}

export class MonitoringStack extends cdk.Stack {
    public readonly alertsTopic: sns.Topic;

    constructor(scope: Construct, id: string, props: MonitoringStackProps) {
        super(scope, id, props);

        this.alertsTopic = new sns.Topic(this, 'AlertsTopic', {
            displayName: 'Bravebird Alerts',
        });

        // DLQ Alarm
        const dlqAlarm = new cloudwatch.Alarm(this, 'CuaDlqAlarm', {
            alarmName: 'bravebird-cua-dlq-depth',
            metric: props.queueStack.cuaQueueHigh.dlq.metricApproximateNumberOfMessagesVisible(),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        dlqAlarm.addAlarmAction(new cw_actions.SnsAction(this.alertsTopic));

        // Recovery Rule (Voice Crash)
        const rule = new events.Rule(this, 'VoiceTaskStopped', {
            eventPattern: {
                source: ['aws.ecs'],
                detailType: ['ECS Task State Change'],
                detail: {
                    clusterArn: [props.computeStack.cluster.clusterArn],
                    lastStatus: ['STOPPED'],
                    containers: {
                        exitCode: [{ "anything-but": 0 }] // Catch non-zero exit codes (crashes)
                    }
                },
            },
        });

        rule.addTarget(new targets.LambdaFunction(props.queueStack.recoveryLambda));
    }
}
