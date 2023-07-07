require('error-object-polyfill');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { config, WebIdentityCredentials, CloudFront, STS, EC2, CloudWatchLogs } = require('aws-sdk');
const AwsArchitect = require('aws-architect');
const commander = require('commander');
const { cloneDeep } = require('lodash');

const REGION = 'eu-west-1';
config.region = REGION;

async function setupAWS() {
  if (!process.env.CI_AWS_JWT) { return; }
  try {
    config.credentials = new WebIdentityCredentials({
      WebIdentityToken: process.env.CI_AWS_JWT,
      RoleArn: `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/GitlabRunnerAssumedRole`,
      RoleSessionName: `GitHubActions-${process.env.CI_PROJECT_PATH_SLUG}-${process.env.CI_PIPELINE_ID}`,
      DurationSeconds: 3600
    });

    const stsResult = await new STS().getCallerIdentity().promise();
    console.log('Configured AWS Credentials', stsResult);
  } catch (error) {
    console.log('Failed to configure AWS Credentials', error);
    process.exit(1);
  }
}

const version = `0.0.${process.env.CI_PIPELINE_ID || '0'}`;
commander.version(version);

const packageMetadataFile = path.join(__dirname, 'package.json');
const packageMetadata = require(packageMetadataFile);
packageMetadata.version = version;
packageMetadata.config = {
  version, releaseDate: new Date().toISOString(), buildNumber: process.env.CI_PIPELINE_ID, buildRef: process.env.CI_COMMIT_REF_NAME, buildCommit: process.env.CI_COMMIT_SHORT_SHA
};

commander
.command('run')
.description('Run lambda web service locally.')
.action(async () => {
  await setupAWS();
  const awsArchitect = new AwsArchitect(packageMetadata, apiOptions);

  try {
    const result = await awsArchitect.Run(8080, () => { /* Do not log from server when running locally */ });
    console.log(JSON.stringify(result.title, null, 2));
  } catch (failure) {
    console.log(JSON.stringify(failure, null, 2));
  }
});

commander
.command('deploy')
.description('Deploy to AWS.')
.action(async () => {
  /* Local Configuration */
  // process.env.CI_COMMIT_REF_SLUG = 'main';
  // const { v4 } = require('uuid');
  // process.env.CI_PIPELINE_ID = v4();
  /***********************/
  if (!process.env.CI_COMMIT_REF_SLUG) {
    console.log('Deployment should not be done locally.');
    return;
  }
  // await setupAWS();

  // await fs.writeJson(packageMetadataFile, packageMetadata, { spaces: 2 });

  // const awsArchitect = new AwsArchitect(packageMetadata, apiOptions);

  // try {
  //   const isMainBranch = process.env.CI_COMMIT_REF_SLUG === 'main';
  //   const globalStackTemplateProvider = require('./cloudFormationGlobalTemplate');
  //   const globalStackTemplate = globalStackTemplateProvider.getStack(authressRegions);
  //   await awsArchitect.validateTemplate(globalStackTemplate);

  //   // Handle MR deployments correctly, publishing will happen for the main region below
  //   if (!isMainBranch) {
  //     await awsArchitect.publishLambdaArtifactPromise();
  //     const publicResult = await awsArchitect.publishAndDeployStagePromise({
  //       stage: isMainBranch ? 'production' : process.env.CI_COMMIT_REF_SLUG,
  //       functionName: packageMetadata.name,
  //       deploymentKeyName: `${packageMetadata.name}/${version}/lambda.zip`
  //     });

  //     console.log(JSON.stringify(publicResult, null, 2));
  //     return;
  //   }
  // } catch (failure) {
  //   console.log(JSON.stringify(failure, null, 2));
  //   process.exit(1);
  // }
});

commander.on('*', () => {
  if (commander.args.join(' ') === 'tests/**/*.js') { return; }
  console.log(`Unknown Command: ${commander.args.join(' ')}`);
  commander.help();
  process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));
