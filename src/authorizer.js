const axios = require('axios');
const cookieManager = require('cookie');
const crypto = require('crypto');
const base64url = require('base64url');
const { AuthressClient } = require('authress-sdk');

const jwtManager = require('./jwtManager');
const { jwtVerify, importJWK } = require('jose');

const logger = require('./logger');
const { DateTime } = require('luxon');

class Authorizer {
  constructor() {
    this.publicKeysPromises = {};
  }

  async handleLoginRedirect(request) {
    const rawExpectedIssuer = request.requestContext.cloudFrontOriginConfig?.customHeaders?.['x-issuer']?.[0]?.value?.trim();
    const applicationIdentifier = request.requestContext.cloudFrontOriginConfig?.customHeaders?.['x-authress-application-id']?.[0]?.value?.trim();

    const cookies = cookieManager.parse(request.headers?.cookie || '');

    const expectedIssuer = (rawExpectedIssuer.startsWith('http') ? rawExpectedIssuer : `https://${rawExpectedIssuer}`).replace(/[/]$/, '');

    const loginClient = axios.create({ baseURL: `${expectedIssuer}/api` });
    if (request.queryStringParameters.code) {
      const codeVerifier = cookies['iap-codeVerifier'];
      try {
        const tokenResult = await loginClient.post(`/authentication/${request.queryStringParameters.nonce}/tokens`, {
          grant_type: 'authorization_code',
          redirect_uri: `https://${request.headers.host}/login/redirect`,
          client_id: applicationIdentifier,
          code: request.queryStringParameters.code,
          code_verifier: codeVerifier
        });
        return {
          statusCode: 301,
          headers: {
            'Location': cookies['iap-redirectUrl'] || `https://${request.headers.host}`,
            'Set-Cookie': [cookieManager.serialize('authorization', tokenResult.data.access_token, {
              expires: DateTime.utc().plus({ hours: 1 }).toJSDate(), domain: request.headers.host, path: '/', sameSite: 'strict', secure: true, httpOnly: true
            })]
          },
          body: {}
        };
      } catch (error) {
        logger.log({ title: 'Failed to exchange code for access token', level: 'ERROR', error, request });
        return this.authorizeRequest(request);
      }
    }

    // if the user is not logged in, send them to be authenticated:
    if (!cookies.authorization) {
      logger.log({ title: 'Code not set on login redirect handling, forcing login', level: 'INFO', request });
      return this.authorizeRequest(request);
    }
    // if the user is logged in and the redirect is set, just navigate there
    if (cookies['iap-redirectUrl'] && !cookies['iap-redirectUrl'].match('/login/redirect')) {
      return {
        statusCode: 301,
        headers: {
          location: cookies['iap-redirectUrl']
        },
        body: {}
      };
    }

    return null;
  }

  async authorizeRequest(request) {
    const rawExpectedIssuer = request.requestContext.cloudFrontOriginConfig?.customHeaders?.['x-issuer']?.[0]?.value?.trim();
    const applicationIdentifier = request.requestContext.cloudFrontOriginConfig?.customHeaders?.['x-authress-application-id']?.[0]?.value?.trim();
    const serviceName = request.requestContext.cloudFrontOriginConfig?.customHeaders?.['x-service-name']?.[0]?.value?.trim() || 'Identity-Aware-Proxy-Service';

    if (rawExpectedIssuer === 'acc-0001.login.authress.io') {
      return {
        statusCode: 400,
        body: {
          title: 'The configuration for the Authress Identity Proxy is not configured correctly. Please enter the accessTokenIssuer which should match your Authress Custom Domain for at: https://authress.io/app/#/settings?focus=domain',
          errorCode: 'InvalidConfiguration'
        }
      };
    }

    const cookies = cookieManager.parse(request.headers?.cookie || '');

    const expectedIssuer = (rawExpectedIssuer.startsWith('http') ? rawExpectedIssuer : `https://${rawExpectedIssuer}`).replace(/[/]$/, '');

    const loginClient = axios.create({ baseURL: `${expectedIssuer}/api` });
    const authorizationToken = cookies.authorization;

    try {
      // Validate the user logged in
      const identityResult = await this.getPolicy(expectedIssuer, authorizationToken);

      const authressClient = new AuthressClient({ baseUrl: expectedIssuer }, authorizationToken);
      const sanitizedPath = request.path.replace(/[^a-zA-Z0-9-_]/, '-');
      const resourceUri = `${serviceName}:${sanitizedPath}`;
      try {
        await authressClient.userPermissions.authorizeUser(identityResult.principalId, resourceUri, 'READ');
      } catch (error) {
        return {
          statusCode: 403,
          body: {
            errorCode: 'AccessDenied',
            title: `You do not have access to fetch this resource about this user. Entity ${identityResult.principalId} is missing permission 'READ' on '${resourceUri}'. Permission can be added by assigning the Role 'ReadResource' to the user in an access record: https://authress.io/app/#/settings?focus=records`
          }
        };
      }

      logger.log({ title: 'User Valid Identity', level: 'INFO', identityResult });

      // If they are logged in, then let them have the data, `null` is a passthrough
      return null;
    } catch (error) {
      logger.log({ title: 'User not authorized falling back to re-authentication', level: 'INFO', error, request });
    }

    // In case the user isn't logged in, redirect them to the authentication endpoint
    // User is unauthorized
    
    const codeVerifier = base64url.encode(crypto.randomBytes(64));
    const codeChallenge = base64url.encode(crypto.createHash('sha256').update(codeVerifier).digest());
    
    try {
      const loginResult = await loginClient.post('/authentication', {
        redirectUrl: `https://${request.headers.host}/login/redirect`,
        codeChallengeMethod: 'S256',
        codeChallenge,
        applicationId: applicationIdentifier,
        responseLocation: 'cookie'
      });

      // SameSite needs to be none, or else the redirect from the login won't send the cookie the first request thus causing a problem
      const cookieOptions = {
        expires: DateTime.utc().plus({ minutes: 5 }).toJSDate(), domain: request.headers.host, path: '/', sameSite: 'none', secure: true, httpOnly: true
      };
      
      return {
        statusCode: 301,
        headers: {
          'Location': loginResult.data.authenticationUrl,
          'Set-Cookie': [
            cookieManager.serialize('iap-codeVerifier', codeVerifier, cookieOptions),
            cookieManager.serialize('iap-redirectUrl', `https://${request.headers.host}${request.path || '/'}`, cookieOptions)
          ]
        },
        body: {}
      };
    } catch (error) {
      logger.log({ title: 'Failed to starting authentication request and generate login url', level: 'ERROR', error, request });

      return {
        statusCode: 500,
        body: {
          title: 'Failed to redirect to the authentication url. Please try again'
        }
      };
    }
  }

  async getPublicKey(jwkKeyListUrl, kid) {
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
