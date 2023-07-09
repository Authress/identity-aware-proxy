const { cloneDeep } = require('lodash');
const logger = require('./logger');

class RequestSanitizer {
  convertResponseHeaders(response) {
    const responseHeaders = cloneDeep(response.headers || {});
    Object.keys(responseHeaders).forEach(h => {
      responseHeaders[h] = responseHeaders[h] ? [{ value: responseHeaders[h] }] : [];
    });
    const multiValueHeaders = cloneDeep(response.multiValueHeaders || {});
    Object.keys(multiValueHeaders).filter(h => multiValueHeaders[h]).forEach(h => {
      responseHeaders[h] = multiValueHeaders[h].filter(v => v).map(value => ({ value }));
    });

    // CloudFront can't handle header responses that are objects
    Object.keys(responseHeaders).map(h => {
      if (responseHeaders[h].some(headerValueObject => typeof headerValueObject.value === 'object')) {
        logger.log({ title: 'Invalid header value found, it is an object when it must be a primitive', level: 'CRITICAL', responseHeaders });
        delete responseHeaders[h];
      }
    });
    return responseHeaders;
  }
}

module.exports = new RequestSanitizer();
