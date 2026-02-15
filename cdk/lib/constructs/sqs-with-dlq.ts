import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

export interface SqsWithDlqProps {
    queueName: string;
    fifo?: boolean;
    visibilityTimeout?: Duration;
    retentionPeriod?: Duration;
}

export class SqsWithDlq extends Construct {
    public readonly queue: sqs.Queue;
    public readonly dlq: sqs.Queue;

    constructor(scope: Construct, id: string, props: SqsWithDlqProps) {
        super(scope, id);

        const isFifo = props.fifo || false;

        let dlqName: string;
        let queueName: string;

        if (isFifo) {
            const baseName = props.queueName.endsWith('.fifo')
                ? props.queueName.substring(0, props.queueName.length - 5)
                : props.queueName;

            queueName = `${baseName}.fifo`;
            dlqName = `${baseName}-dlq.fifo`;
        } else {
            queueName = props.queueName;
            dlqName = `${props.queueName}-dlq`;
        }

        this.dlq = new sqs.Queue(this, 'Dlq', {
            queueName: dlqName,
            fifo: isFifo,
            retentionPeriod: Duration.days(14),
            contentBasedDeduplication: isFifo ? true : undefined,
        });

        this.queue = new sqs.Queue(this, 'Queue', {
            queueName: queueName,
            fifo: isFifo,
            contentBasedDeduplication: isFifo ? true : undefined,
            visibilityTimeout: props.visibilityTimeout || Duration.minutes(5),
            retentionPeriod: props.retentionPeriod || Duration.days(4),
            deadLetterQueue: {
                queue: this.dlq,
                maxReceiveCount: 3,
            },
        });
    }
}
