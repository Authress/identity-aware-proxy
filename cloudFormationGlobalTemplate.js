module.exports = {
  getStack() {
    const template = {
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'Identity Aware Proxy',
      Parameters: {
        serviceName: {
          Type: 'String',
          Description: 'The name of the microservice',
          Default: 'IdentityAwareProxy'
        },
        serviceDescription: {
          Type: 'String',
          Description: 'Description for service resources',
          Default: 'Identity Aware Proxy'
        },
        s3BucketName: {
          Type: 'String',
          Description: 'Your S3 Bucket that contains your private static website.'
        }
      },

      Resources: {
        LambdaFunction: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            FunctionName: { Ref: 'serviceName' },
            Description: { Ref: 'serviceDescription' },
            Handler: 'index.handler',
            Runtime: 'nodejs18.x',
            Code: {
              ZipFile: 'exports.handler = async() => Promise.resolve()'
            },
            // https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html => 1 vCPU
            MemorySize: 1769,
            /// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html#limits-lambda-at-edge
            Timeout: 30,
            Role: { 'Fn::GetAtt': ['LambdaRole', 'Arn'] }
          }
        },
        LambdaFunctionVersion: {
          Type: 'AWS::Lambda::Version',
          Properties: {
            FunctionName: { Ref: 'LambdaFunction' },
            Description: 'Initial Production Deployed Version'
          }
        },
        ProductionAlias: {
          Type: 'AWS::Lambda::Alias',
          Properties: {
            Description: 'The production alias',
            FunctionName: { 'Fn::GetAtt': ['LambdaFunction', 'Arn'] },
            FunctionVersion: { 'Fn::GetAtt': ['LambdaFunctionVersion', 'Version'] },
            Name: 'production'
          }
        },
        LambdaRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: { 'Fn::Sub': '${serviceName}LambdaRole-${AWS::Region}' },
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: {
                    Service: ['lambda.amazonaws.com', 'edgelambda.amazonaws.com']
                  },
                  Action: ['sts:AssumeRole']
                }
              ]
            },
            ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole', 'arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess'],
            Path: '/'
          }
        },

        CloudFrontOriginAccessIdentity: {
          Type: 'AWS::CloudFront::CloudFrontOriginAccessIdentity',
          Properties: {
            CloudFrontOriginAccessIdentityConfig: {
              Comment: 'Identity Aware Proxy'
            }
          }
        },

        S3BucketPolicy: {
          Type: 'AWS::S3::BucketPolicy',
          Properties: {
            Bucket: { Ref: 's3BucketName' },
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Sid: 'Grant a CloudFront Origin Identity access to support private content',
                  Effect: 'Allow',
                  Principal: {
                    CanonicalUser: { 'Fn::GetAtt': ['CloudFrontOriginAccessIdentity', 'S3CanonicalUserId'] }
                  },
                  Action: 's3:GetObject',
                  Resource: { 'Fn::Sub': 'arn:aws:s3:::${s3BucketName}/*' }
                }
              ]
            }
          }
        },

        CloudFrontDistribution: {
          Type: 'AWS::CloudFront::Distribution',
          Properties: {
            DistributionConfig: {
              Comment: 'Identity Aware Proxy',
              Enabled: true,
              DefaultRootObject: 'index.html',
              HttpVersion: 'http2and3',
              PriceClass: 'PriceClass_All',
              Origins: [{
                OriginPath: '/v1',
                DomainName: { 'Fn::Sub': '${s3BucketName}.s3.amazonaws.com' },
                Id: 'S3',
                S3OriginConfig: {
                  OriginAccessIdentity: { 'Fn::Sub': 'origin-access-identity/cloudfront/${CloudFrontOriginAccessIdentity}' }
                }
              }],
              CacheBehaviors: [],
              DefaultCacheBehavior: {
                AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
                Compress: true,
                CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
                OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf',
                TargetOriginId: 'S3',
                ViewerProtocolPolicy: 'redirect-to-https',
                LambdaFunctionAssociations: [{
                  EventType: 'origin-request',
                  FunctionARN: { 'Ref': 'LambdaFunctionVersion' }
                }]
              }
            }
          }
        }
      },

      Outputs: {
        IdentityAwareProxyDomain: {
          Description: 'The domain generated for the Identity Aware Proxy.',
          Value: { 'Fn::GetAtt': ['CloudFrontDistribution', 'DomainName'] },
          Export: {
            Name: 'IdentityAwareProxyDomain'
          }
        }
      }
    };

    return template;
  }
};
