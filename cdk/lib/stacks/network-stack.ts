import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface NetworkStackProps extends cdk.StackProps {
    envConfig: EnvironmentConfig;
}

export class NetworkStack extends cdk.Stack {
    public readonly vpc: ec2.Vpc;
    public readonly sgAlb: ec2.SecurityGroup;
    public readonly sgApp: ec2.SecurityGroup;
    public readonly sgCompute: ec2.SecurityGroup;
    public readonly sgRedis: ec2.SecurityGroup;
    public readonly sgVpcEndpoints: ec2.SecurityGroup;

    constructor(scope: Construct, id: string, props: NetworkStackProps) {
        super(scope, id, props);

        this.vpc = new ec2.Vpc(this, 'BravebirdVpc', {
            ipAddresses: ec2.IpAddresses.cidr(props.envConfig.vpcCidr),
            maxAzs: 3,
            subnetConfiguration: [
                { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
                { name: 'private-app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
                { name: 'private-compute', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 23 },
                { name: 'isolated-data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
            ],
            gatewayEndpoints: {
                S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
                DYNAMODB: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB },
            },
        });

        // Security Groups
        this.sgAlb = new ec2.SecurityGroup(this, 'SgAlb', { vpc: this.vpc, description: 'ALB Security Group' });
        this.sgApp = new ec2.SecurityGroup(this, 'SgApp', { vpc: this.vpc, description: 'App Security Group' });
        this.sgCompute = new ec2.SecurityGroup(this, 'SgCompute', { vpc: this.vpc, description: 'Compute Security Group' });
        this.sgRedis = new ec2.SecurityGroup(this, 'SgRedis', { vpc: this.vpc, description: 'Redis Security Group' });
        this.sgVpcEndpoints = new ec2.SecurityGroup(this, 'SgVpcEndpoints', { vpc: this.vpc, description: 'VPC Endpoints Security Group' });

        // SG Rules
        this.sgAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from anywhere');
        this.sgAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from anywhere');
        this.sgAlb.addEgressRule(this.sgApp, ec2.Port.tcp(8000), 'To App');

        this.sgApp.addIngressRule(this.sgAlb, ec2.Port.tcp(8000), 'From ALB');
        this.sgApp.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS Egress');
        this.sgApp.addEgressRule(this.sgRedis, ec2.Port.tcp(6379), 'To Redis');

        this.sgCompute.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS Egress');
        this.sgCompute.addEgressRule(this.sgRedis, ec2.Port.tcp(6379), 'To Redis');

        this.sgRedis.addIngressRule(this.sgApp, ec2.Port.tcp(6379), 'From App');
        this.sgRedis.addIngressRule(this.sgCompute, ec2.Port.tcp(6379), 'From Compute');

        this.sgVpcEndpoints.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(443), 'From VPC');

        // NACLs
        const computeNacl = new ec2.NetworkAcl(this, 'ComputeNacl', {
            vpc: this.vpc,
            subnetSelection: { subnetGroupName: 'private-compute' },
        });

        computeNacl.addEntry('DenyIMDS', {
            ruleNumber: 50,
            traffic: ec2.AclTraffic.allTraffic(),
            cidr: ec2.AclCidr.ipv4('169.254.169.254/32'),
            direction: ec2.TrafficDirection.EGRESS,
            ruleAction: ec2.Action.DENY,
        });

        computeNacl.addEntry('DenyDataSubnet', {
            ruleNumber: 60,
            traffic: ec2.AclTraffic.allTraffic(),
            cidr: ec2.AclCidr.ipv4('10.0.30.0/22'), // Adjust based on actual subnet CIDR block if needed, assuming isolated-data falls here
            direction: ec2.TrafficDirection.EGRESS,
            ruleAction: ec2.Action.DENY,
        });

        computeNacl.addEntry('AllowHTTPS', {
            ruleNumber: 100,
            traffic: ec2.AclTraffic.tcpPort(443),
            cidr: ec2.AclCidr.anyIpv4(),
            direction: ec2.TrafficDirection.EGRESS,
            ruleAction: ec2.Action.ALLOW,
        });

        // FIX: Allow Inbound traffic for Ephemeral Ports (Return traffic) and Application Port (8000)
        computeNacl.addEntry('AllowIngressTraffic', {
            ruleNumber: 100,
            traffic: ec2.AclTraffic.tcpPortRange(1024, 65535),
            cidr: ec2.AclCidr.anyIpv4(),
            direction: ec2.TrafficDirection.INGRESS,
            ruleAction: ec2.Action.ALLOW,
        });

        // Interface Endpoints
        const interfaceEndpoints = [
            'SQS', 'SECRETS_MANAGER', 'CLOUDWATCH_LOGS', 'ECR', 'ECR_DOCKER', 'ECS', 'BEDROCK_RUNTIME', 'KMS', 'SSM'
        ];

        interfaceEndpoints.forEach(svc => {
            // @ts-ignore
            const service = ec2.InterfaceVpcEndpointAwsService[svc];
            if (service) {
                this.vpc.addInterfaceEndpoint(svc, {
                    service,
                    subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
                    securityGroups: [this.sgVpcEndpoints],
                });
            }
        });
    }
}
