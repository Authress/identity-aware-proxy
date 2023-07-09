const logger = require('./logger');

class DomainMatcher {
  getOrigin(request) {
    if (request.headers.origin) {
      return request.headers.origin;
    }
    if (!request.headers.referer && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-site'] === 'none'
      || request.headers['sec-fetch-site'] === 'same-origin' || request.headers['sec-fetch-site'] === 'same-site') {
      return `https://${request.headers.host}`;
    }

    try {
      return request.headers.referer && new URL(request.headers.referer).origin;
    } catch (error) {
      logger.log({ title: 'Failed to resolve referer for origin in request - getOrigin', level: 'TRACK', request });
      return null;
    }
  }
}

module.exports = new DomainMatcher();
