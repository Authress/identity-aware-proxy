require('error-object-polyfill');
const fs = require('fs-extra');
const path = require('path');
const { config } = require('aws-sdk');
const AwsArchitect = require('aws-architect');
const commander = require('commander');

const REGION = 'eu-west-1';
config.region = REGION;

function getVersion() {
  let release_version = '0.0';
  const pull_request = '';
  const branch = process.env.GITHUB_REF;
  const build_number = `${process.env.GITHUB_RUN_NUMBER}`;

  // Builds of pull requests
  if (pull_request && !pull_request.match(/false/i)) {
    release_version = `0.${pull_request}`;
  } else if (!branch || !branch.match(/^(refs\/heads\/)?release[/-]/i)) {
    // Builds of branches that aren't master or release
    release_version = '0.0';
  } else {
    // Builds of release branches (or locally or on server)
    release_version = branch.match(/^(?:refs\/heads\/)?release[/-](\d+(?:\.\d+){0,3})$/i)[1];
  }
  return `${release_version}.${(build_number || '0')}.0.0.0.0`.split('.').slice(0, 3).join('.');
}
const version = getVersion();
commander.version(version);

const packageMetadata = require('./package.json');
packageMetadata.version = version;

const apiOptions = {
  deploymentBucket: `authress-identity-aware-proxy-artifacts`,
  sourceDirectory: path.join(__dirname, 'src'),
  description: packageMetadata.description,
  regions: [REGION]
};

commander
.command('run')
.description('Run lambda web service locally.')
.action(async () => {
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
  try {
    const awsArchitect = new AwsArchitect(packageMetadata, apiOptions);
    await awsArchitect.publishLambdaArtifactPromise();
    console.log(`***** S3 Package Path: ${packageMetadata.name}/${version}/lambda.zip`);

  } catch (failure) {
    console.log(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
});

commander.on('*', () => {
  if (commander.args.join(' ') === 'tests/**/*.js') { return; }
  console.log(`Unknown Command: ${commander.args.join(' ')}`);
  commander.help();
  process.exit(0);
});
commander.parse(process.argv[2] ? process.argv : process.argv.concat(['build']));
