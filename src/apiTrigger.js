const { DateTime } = require('luxon');
const { cloneDeep } = require('lodash');

const logger = require('./logger');
const requestSanitizer = require('./requestSanitizer');
const domainMatcher = require('./domainMatcher');

class ApiTrigger {
  async onEvent(trigger, context, apiHandler) {
    // records are from CloudFront
    const cloudFrontData = trigger.Records[0].cf;
    const request = cloudFrontData.request;

    if (JSON.stringify(request).includes('__proto__')) {
      logger.log({ title: 'User attempted to prototype pollution attack, return a 400 immediately', level: 'INFO', request });
      return {
        status: 400,
        headers: {},
        body: Buffer.from(JSON.stringify({})).toString('base64'),
        bodyEncoding: 'base64'
      };
    }

    let body = request.body && request.body.data && Buffer.from(request.body.data, 'base64').toString() || null;
    try {
      body = body && JSON.parse(body);
    } catch (error) {
      body = [...new URLSearchParams(body).entries()].reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
    }

    const constructedRequest = {
      // used path
      path: request.uri.replace(/^\/api/, ''),
      // symbol path
      resource: '/{proxy+}',
      httpMethod: request.method,
      methodArn: '{CloudFrontRequest}',
      routeArn: '{CloudFrontRequest}',
      queryStringParameters: [...new URLSearchParams(request.querystring).entries()].reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {}),
      pathParameters: {
        proxy: request.uri.replace(/^\/api/, '').slice(1)
      },
      headers: Object.keys(request.headers).reduce((agg, h) => {
        agg[h] = request.headers[h].length === 1 ? request.headers[h][0].value : request.headers[h].map(o => o.value);
        return agg;
      }, {}),
      body,
      requestContext: {
        cloudFrontOriginConfig: request.origin && request.origin.s3,
        requestId: request.config && request.config.requestId,
        stage: null
        // authorizer: {
        //   principalId: ''
        // }
      }
    };

    // Add support for requests that don't contain an origin and usages of `same-site` sec requests
    constructedRequest.headers.origin = domainMatcher.getOrigin(constructedRequest);

    try {
      logger.trackPoint('apiTrigger.onEvent.beforeApiHandler');
      const response = await apiHandler(constructedRequest, context);

      if (!response) {
        return request;
      }

      logger.trackPoint('apiTrigger.onEvent.afterApiHandler');
      const responseHeaders = requestSanitizer.convertResponseHeaders(response);

      const cloudFrontResponse = {
        status: `${response.statusCode}`,
        // statusDescription: 'OK',
        headers: responseHeaders,
        // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-generating-http-responses-in-requests.html
        body: response.isBase64Encoded && response.body || response.body && Buffer.from(response.body).toString('base64') || undefined,
        bodyEncoding: response.body ? 'base64' : undefined
      };
      return cloudFrontResponse;
    } catch (error) {
      if (error.code === 'ERR_INVALID_URL') {
        logger.log({ title: 'Failed to handle cloud front request due to an untracked URL error', level: 'TRACK', constructedRequest, context, error });
        return {
          status: 503,
          headers: { 'access-control-allow-origin': [{ value: '*' }] },
          body: Buffer.from(JSON.stringify({ title: 'Unavailable' })).toString('base64'),
          bodyEncoding: 'base64'
        };
      }
      logger.log({ title: 'Failed to handle cloud front request, and it should have been caught', level: 'ERROR', constructedRequest, context, error });
      return {
        status: 500,
        headers: { 'access-control-allow-origin': [{ value: '*' }] },
        body: Buffer.from(JSON.stringify({ title: 'Unexpected error in with CDN', error: { code: error.code, message: error.message } })).toString('base64'),
        bodyEncoding: 'base64'
      };
    }
  }
}

module.exports = new ApiTrigger();
