import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends StackProps {
  envName: string;
}

/** VPC with public + private subnets. NAT gives data workers a fixed egress IP. */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  /** Shared SG for ECS tasks (API, admin-api, worker, data-workers). */
  readonly appSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: props.envName === 'prod' ? 3 : 2,
      natGateways: props.envName === 'prod' ? 2 : 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    this.appSecurityGroup = new ec2.SecurityGroup(this, 'AppSg', {
      vpc: this.vpc,
      description: 'ECS Fargate application tasks',
      allowAllOutbound: true,
    });
    // ALBs live in the services stack; allow VPC-internal traffic to app ports so we
    // don't create a cross-stack cycle by referencing ALB security groups here.
    this.appSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(3000),
      'VPC to public API',
    );
    this.appSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(3001),
      'VPC to admin API',
    );
  }
}
