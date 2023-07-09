const axios = require('axios');
const jwtManager = require('./jwtManager');
const { jwtVerify, importJWK } = require('jose');

const logger = require('./logger');

class Authorizer {
  constructor() {
    this.publicKeysPromises = {};
  }

  async getPublicKey(jwkKeyListUrl, kid, token) {
    if (!this.publicKeysPromises[jwkKeyListUrl]) {
      this.publicKeysPromises[jwkKeyListUrl] = axios.get(jwkKeyListUrl);
    }

    try {
      let result = await this.publicKeysPromises[jwkKeyListUrl];
      let jwk = result.data.keys.find(key => key.kid === kid);
      if (jwk) {
        return jwk;
      }

      this.publicKeysPromises[jwkKeyListUrl] = null;
      logger.log({ title: 'PublicKey-Resolution-Failure', level: 'ERROR', kid: kid || 'NO_KID_SPECIFIED', keys: result.data.keys });
      throw Error.create('Unauthorized');
    } catch (error) {
      logger.log({ title: 'Unauthorized', level: 'ERROR', details: 'Failed to get public key', kid: kid || 'NO_KID_SPECIFIED', error: error });
      this.publicKeysPromises[jwkKeyListUrl] = null;
      throw Error.create('Unauthorized');
    }
  }

  async getPolicy(request) {
    const expectedIssuer = request.requestContext.cloudFrontOriginConfig
      && request.requestContext.cloudFrontOriginConfig.customHeaders && request.requestContext.cloudFrontOriginConfig.customHeaders['X-ISSUER'];

    const authorizationHeaderName = Object.keys(request.headers).find(key => {
      return key.match(/^Authorization$/i);
    });

    let token = request.headers[authorizationHeaderName] ? request.headers[authorizationHeaderName].split(' ')[1] : null;
    if (!token) {
      logger.log({ title: 'Unauthorized', level: 'WARN', details: 'no token specified' });
      throw Error.create('Unauthorized');
    }

    let unverifiedToken = jwtManager.decodeFull(token);
    let kid = unverifiedToken && unverifiedToken.header && unverifiedToken.header.kid;
    if (!kid) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Kid not in token', token: unverifiedToken || token || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    let issuer = unverifiedToken && unverifiedToken.payload && unverifiedToken.payload.iss;
    if (!issuer) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Issuer not in token', token: unverifiedToken || token || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    if (issuer !== process.env.ISSUER) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Issuer mismatch', token: unverifiedToken || token || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    if (!issuerData) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Issuer not in token', token: unverifiedToken || token || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    let key = await this.getPublicKey(`${issuer}/.well-known/openid-configuration/jwks`, kid, token);

    let identity;
    try {
      const verifiedToken = await jwtVerify(token, await importJWK(key), { algorithms: ['EdDSA'], issuer, audience: issuerData.audience });
      identity = verifiedToken.payload;
    } catch (exception) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Invalid Token', error: exception, token: token || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    return {
      principalId: identity.sub,
      context: {}
    };
  }
}

module.exports = new Authorizer();
