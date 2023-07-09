const stringify = require('json-stringify-safe');
const shortUuid = require('short-uuid');

// Remove unnecessary strings from logging
function replacer(key, value) {
  if (key === 'body' && typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }
  if (value && typeof value === 'string' && key && (key.match(/authorization(?!result)/i) || value.match(/^bearer/i))
    && !value.match(/(eyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,})\.[a-zA-Z0-9_-]*/gi)) {
    return '{AUTHORIZATION}';
  }

  if (key?.match(/(secret|signature|refreshToken|refresh_token|password)/i) && value) {
    return '{SECRET}';
  }

  if (key?.match(/(identity|profile)/i) && value && typeof value === 'object' && (value.sub || value.userId)) {
    return `{${value.sub || value.userId}}`;
  }

  if (key?.match(/(identity|profile)/i) && value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'cognitoIdentityPoolId')) {
    return '{-}';
  }

  if (key === 'multiValueHeaders') {
    return undefined;
  }
  if (typeof value === 'string' && value.startsWith('<!DOCTYPE html>')) {
    return '<HTML DOCUMENT></HTML>';
  }
  return value;
}

class RequestLogger {
  constructor(loggerFunc) {
    this.loggerFunc = loggerFunc || console.log;
    this.logDebug = true;

    this.invocationId = null;
    this.version = 'LOCAL';
    this.metadata = {};
    this.startTime = null;
    this.trackPoints = [];
    this.errorLoggedDuringInvocation = false;
  }

  startInvocation(metadata, timeoutOverride) {
    this.invocationId = shortUuid.generate();
    this.metadata = metadata || {};
    this.startTime = Date.now();
    this.trackPoints = [{ Start: { time: this.startTime } }];
    this.errorLoggedDuringInvocation = false;

    try {
      // eslint-disable-next-line node/no-missing-require
      const packageMetadata = require('./package.json');
      this.versionData = packageMetadata.config;
    } catch (error) { /* */ }

    const capturedInvocationId = this.invocationId;
    const capturedStartTime = this.startTime;
    setTimeout(() => {
      if (this.invocationId !== capturedInvocationId) {
        return;
      }

      // Wait 5 seconds, and then kick off the background process. If the background process has been frozen, then more time should have passed other than was is recorded in this lambda.
      // * If it is frozen for over 10 seconds, even though only "5 seconds" has passed for the lambda, then don't log anything
      if (Date.now() - capturedStartTime > 10 * 1000) {
        return;
      }

      // If less than 10 seconds has passed, that means the lambda wasn't frozen, and we should fire off the real timeout track capture log.
      setTimeout(() => {
        if (this.invocationId === capturedInvocationId) {
          // This can't be TRACK, because AWS frequently will keep running our lambda even after it has returned, so leave it as INFO, and only evaluate the log message if it makes sense.
          // * "Request is still executing after 55 seconds, logging all track points in case request times out, this message itself does NOT mean there was a timeout."
          this.log({ title: '(See code comment)', level: 'INFO', trackPoints: this.trackPoints });
        }
      }, timeoutOverride || 20000);
    }, 5000);
  }

  log(message, exposeFullLogMessage) {
    let type = typeof message;
    let messageAsObject = message;
    if (type === 'undefined' || (type === 'string' && message === '')) {
      console.error('Empty message string.');
      return;
    } else if (type === 'string') {
      messageAsObject = {
        title: message
      };
    } else if (type === 'object' && Object.keys(message).length === 0) {
      console.error('Empty message object.');
      return;
    }

    if (!messageAsObject.level) {
      messageAsObject.level = 'INFO';
    }

    if (messageAsObject.level === 'DEBUG' && !this.logDebug) {
      return;
    }

    messageAsObject.invocationId = this.invocationId;
    const payload = {
      message: messageAsObject,
      metadata: Object.assign({ nodejs: process.version, versionData: this.versionData }, this.metadata)
    };

    if (messageAsObject.level === 'ERROR' || messageAsObject.level === 'CRITICAL') {
      const stackTrace = new Error();
      Error.captureStackTrace(stackTrace);
      payload.stack = stackTrace.stack;
    }

    this.errorLoggedDuringInvocation = this.errorLoggedDuringInvocation || messageAsObject.level === 'ERROR' || messageAsObject.level === 'CRITICAL';
    if (this.errorLoggedDuringInvocation && exposeFullLogMessage) {
      payload.trackPoints = this.trackPoints;
    }

    let truncateToken = innerPayload => {
      return innerPayload.replace(/(eyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,})\.[a-zA-Z0-9_-]*/gi, (m, p1) => `${p1}.<sig>`);
    };

    let stringifiedPayload = truncateToken(stringify(payload, replacer, 2));
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html 256KB => 131072 2-byte characters
    if (stringifiedPayload.length >= 131072) {
      const replacementPayload = {
        invocationId: this.invocationId,
        message: {
          title: 'Payload too large',
          level: 'ERROR',
          originalInfo: {
            level: messageAsObject.level,
            title: messageAsObject.title,
            fields: Object.keys(messageAsObject)
          },
          truncatedPayload: truncateToken(stringify(payload, replacer)).substring(0, 40000)
        }
      };
      stringifiedPayload = stringify(replacementPayload, replacer, 2);
    }
    this.loggerFunc(stringifiedPayload);
  }

  trackPoint(pointName, pointData) {
    this.trackPoints.push({ [pointName]: { time: Date.now() - this.startTime, pointData } });
  }
}

module.exports = new RequestLogger();
