import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cert from "aws-cdk-lib/aws-certificatemanager";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

import { SSMParameterReader } from "./ssm-parameter-reader";

interface StackProps extends cdk.StackProps {
  domainName: string;
  acmCertParameterName: string;
  secretHeaderValue: string;
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "InfraBucket", {
      bucketName: `${props.domainName}`,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "404.html",
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [`${bucket.bucketArn}`, `${bucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "aws:Referer": props.secretHeaderValue,
          },
        },
      })
    );

    const acmCertArn = new SSMParameterReader(this, "InfraAcmCertificateArn", {
      parameterName: props.acmCertParameterName,
      region: "us-east-1",
    }).getParameterValue();

    const acmCert = cert.Certificate.fromCertificateArn(
      this,
      "InfraCert",
      acmCertArn
    );

    const s3Origin = new origins.S3Origin(bucket, {
      customHeaders: {
        Referer: props.secretHeaderValue,
      },
    });

    const distribution = new cf.Distribution(this, "InfraCloudfront", {
      defaultBehavior: { origin: s3Origin },
      certificate: acmCert,
      domainNames: [`${props.domainName}`],
      comment: `${props.domainName}`,
      priceClass: cf.PriceClass.PRICE_CLASS_100,
    });

    ["fonts", "images", "icons", "css", "js", "*"].forEach((path) => {
      distribution.addBehavior(`/${path}/*`, s3Origin, {
        compress: true,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
      });
    });

    const hostedZone = route53.HostedZone.fromLookup(this, "InfraHostedZone", {
      domainName: props.domainName,
    });

    new route53.ARecord(this, "ARecord", {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
    });
    new route53.AaaaRecord(this, "AAAARecord", {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      ),
    });
  }
}
