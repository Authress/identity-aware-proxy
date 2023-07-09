// restrictions: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-requirements-limits.html#lambda-requirements-distributions

require('error-object-polyfill');
const Api = require('openapi-factory');

process.env.AWS_NODEJS_CONNECTION_REUSE_ENABLED = 1;
require('http').globalAgent.keepAlive = true;
require('https').globalAgent.keepAlive = true;

const logger = require('./logger');
const authorizer = require('./authorizer');

try {
  // const aws = require('aws-sdk');
  // // Override stupid aws defaults, don't wait forever to connect when it isn't working.
  // aws.config.update({ maxRetries: 5, httpOptions: { connectTimeout: 1000, timeout: 10000 } });

  const api = new Api({
    requestMiddleware(request, context) {
      context.callbackWaitsForEmptyEventLoop = true;
      return request;
    },
    responseMiddleware(request, response) {
      const loggedResponse = response.statusCode >= 400 ? response : { statusCode: response.statusCode };
      response.headers = Object.assign({
        'strict-transport-security': 'max-age=31556926; includeSubDomains;',
        'vary': 'Origin, Host, Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site',
        'Cache-Control': 'no-store'
      }, response.headers || {});

      // Append errorId to the response in the body
      if (response.statusCode >= 400 && response.body && typeof response.body === 'object') {
        response.body.errorId = logger.invocationId;
      }
      logger.log({ title: 'RequestLogger', level: 'DEBUG', request, response: loggedResponse }, response.statusCode >= 400);

      return response;
    },
    errorMiddleware(request, error) {
      logger.log({ title: 'RequestLogger', level: 'ERROR', request, error, response: { statusCode: 500 } }, true);
      return {
        statusCode: 500,
        headers: {},
        body: { title: 'Unexpected error', errorId: logger.invocationId }
      };
    }
  }, () => {});
  module.exports = api;

  const apiTrigger = require('./apiTrigger');
  api.onEvent(async (trigger, context) => {
    logger.startInvocation({ version: context.functionVersion });
    try {
      const result = await apiTrigger.onEvent(trigger, context, (...args) => api.handler(...args));
      return result;
    } catch (error) {
      const level = error.code === 'ForceRetryExecution' ? 'INFO' : 'ERROR';
      logger.log({ title: 'Failed to handle event trigger in lambda', level, trigger, context, error });
      throw error;
    }
  });

  api.head('/{proxy+}', request => authorizer.authorizeRequest(request));
  api.get('/{proxy+}', request => authorizer.authorizeRequest(request));
  api.options('/{proxy+}', () => {
    return null;
  });
} catch (error) {
  logger.log({ title: 'LoaderLogger - failed to load service', level: 'ERROR', error });
  throw error;
}
