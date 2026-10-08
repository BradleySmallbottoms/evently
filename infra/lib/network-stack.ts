import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends StackProps {
  envName: string;
}

/** VPC with public + private subnets. NAT gives data workers a fixed egress IP. */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;

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
  }
}
