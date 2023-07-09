const axios = require('axios');
const cookieManager = require('cookie');
const crypto = require('crypto');
const base64url = require('base64url');

const jwtManager = require('./jwtManager');
const { jwtVerify, importJWK } = require('jose');

const logger = require('./logger');

class Authorizer {
  constructor() {
    this.publicKeysPromises = {};
  }

  async authorizeRequest(request) {
    const rawExpectedIssuer = request.requestContext.cloudFrontOriginConfig?.customHeaders?.['X-ISSUER']?.trim();
    const applicationIdentifier = request.requestContext.cloudFrontOriginConfig?.customHeaders?.['X-AUTHRESS-APPLICATION-ID']?.trim();

    const expectedIssuer = (rawExpectedIssuer.startsWith('http') ? rawExpectedIssuer : `https://${rawExpectedIssuer}`).replace(/[/]$/, '');

    const authorizationToken = cookieManager.parse(request.headers?.cookie || '').authorization;

    try {
      const identityResult = await this.getPolicy(expectedIssuer, authorizationToken);
      logger.log({ title: 'User Valid Identity', level: 'INFO', identityResult });

      // If they are logged in, then let them have the data, `null` is a passthrough
      return null;
    } catch (error) {
      logger.log({ title: 'User not authorized falling back to re-authentication', level: 'INFO',error });
    }

    // In case the user isn't logged in, redirect them to the authentication endpoint
    // User is unauthorized

    const loginClient = axios.create({ baseURL: `${expectedIssuer}/api` });
    
    const codeVerifier = base64url.encode(crypto.randomBytes(64));;
    const codeChallenge = base64url.encode(crypto.createHash('sha256').update(codeVerifier).digest());
    const redirectUrl = `https://${request.headers.host}${request.path || '/'}`;

    try {
      const loginResult = await loginClient.post('/authentication', {
        redirectUrl,
        codeChallengeMethod: 'S256',
        codeChallenge,
        applicationId: applicationIdentifier,
        responseLocation: 'cookie'
      });

      return {
        statusCode: 301,
        headers: {
          location: loginResult.data.authenticationUrl
        },
        body: {}
      };
    } catch (error) {
      logger.log({ title: 'Failed to get login url', level: 'ERROR', error });

      return {
        statusCode: 500,
        body: {
          title: 'Failed to redirect to the authentication url. Please try again'
        }
      };
    }
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

  async getPolicy(expectedIssuer, authorizationToken) {
    if (!authorizationToken) {
      logger.log({ title: 'Unauthorized', level: 'WARN', details: 'no token specified' });
      throw Error.create('Unauthorized');
    }

    let unverifiedToken = jwtManager.decodeFull(authorizationToken);
    let kid = unverifiedToken && unverifiedToken.header && unverifiedToken.header.kid;
    if (!kid) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Kid not in token', token: unverifiedToken || authorizationToken || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    let rawIssuer = unverifiedToken && unverifiedToken.payload && unverifiedToken.payload.iss;
    if (!rawIssuer) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Issuer not in token', token: unverifiedToken || authorizationToken || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    const issuer = rawIssuer.startsWith('http') ? rawIssuer : `https://${rawIssuer}`;

    if (issuer.replace(/[/]$/, '') !== expectedIssuer.replace(/[/]$/, '')) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Issuer mismatch', token: unverifiedToken || authorizationToken || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    const key = await this.getPublicKey(`${rawIssuer}/.well-known/openid-configuration/jwks`, kid, authorizationToken);

    let identity;
    try {
      const verifiedToken = await jwtVerify(authorizationToken, await importJWK(key), { algorithms: ['EdDSA'], issuer: rawIssuer });
      identity = verifiedToken.payload;
    } catch (exception) {
      logger.log({ title: 'Unauthorized', level: 'INFO', details: 'Invalid Token', error: exception, token: authorizationToken || '<NO TOKEN>' });
      throw Error.create('Unauthorized');
    }

    return {
      principalId: identity.sub,
      context: {}
    };
  }
}

module.exports = new Authorizer();
