#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { ComputeStack } from '../lib/stacks/compute-stack';
import { QueueStack } from '../lib/stacks/queue-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack'; // Import FrontendStack
import { environments } from '../lib/config/environments';

const app = new cdk.App();

// Choose environment (default to dev)
const envName = app.node.tryGetContext('env') || 'dev';
// @ts-ignore
const envConfig = environments[envName];

if (!envConfig) {
    throw new Error(`Invalid environment: ${envName}`);
}

const env = { account: envConfig.account, region: envConfig.region };

// Network Stack
const networkStack = new NetworkStack(app, 'NetworkStack', {
    env,
    // @ts-ignore
    envConfig
});

// Auth Stack
const authStack = new AuthStack(app, 'AuthStack', {
    env,
    // @ts-ignore
    networkStack
});

// Data Stack
const dataStack = new DataStack(app, 'DataStack', {
    env,
    // @ts-ignore
    networkStack
});

// Compute Stack
const computeStack = new ComputeStack(app, 'ComputeStack', {
    env,
    networkStack,
    authStack,
    dataStack
});

// Queue Stack
const queueStack = new QueueStack(app, 'QueueStack', {
    env,
    networkStack,
    computeStack,
    dataStack
});

// Monitoring Stack
const monitoringStack = new MonitoringStack(app, 'MonitoringStack', {
    env,
    queueStack,
    computeStack
});

// Frontend Stack (S3 + CloudFront)
// Note: Requires 'frontend/out' to be built before deployment
const frontendStack = new FrontendStack(app, 'FrontendStack', {
    env,
    apiEndpoint: cdk.Fn.importValue('BravebirdApiDns'),
});
frontendStack.addDependency(computeStack);

// Add Tags
cdk.Tags.of(app).add('Project', 'Bravebird');
cdk.Tags.of(app).add('Environment', envName);
