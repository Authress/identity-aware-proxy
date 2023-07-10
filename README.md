# Authress Identity Aware Proxy + Private Website Authentication

<p align="center">
    <a href="https://github.com/Authress/identity-aware-proxy/actions" alt="Authress build">
      <img src="https://github.com/authress/identity-aware-proxy/actions/workflows/build.yml/badge.svg">
    </a>
    <a href="./LICENSE" alt="apache 2.0 license">
      <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg">
    </a>
    <a href="https://authress.io" alt="AWS Serverless Application">
        <img src="https://img.shields.io/badge/AWS%20Serverless%20Application-Identity%20Aware%20Proxy-623CE4">
    </a>
    <a href="https://authress.io/community" alt="Authress build">
      <img src="https://img.shields.io/badge/community-Authress-fbaf0b.svg">
    </a>
</p>

This repository provides a proxy which enables adding Authentication and security to existing applications and platforms without changing any code in those services.

There are specifically two different configurations that enable:

* Service Identity Aware Proxy (IAP)
* Private Website

## Identity Aware Proxy

* [IAP Proxy Stack Template](./templates/privateWebsiteStackTemplate.json)

(Note: Stacks must be deployed in the AWS US-EAST-1 Region)

The IAP enables adding globally redundant and fault tolerant authentication to an existing service being run. After deploying the stack, your service will automatically receive user identity tokens that can be verified. These tokens are automatically verified by the proxy to ensure all requests to the services themselves are secured.

## Private Website

* [S3 Private Website Stack Template](./templates/privateWebsiteStackTemplate.json)

(Note: Stacks must be deployed in the AWS US-EAST-1 Region)

Parameters:
* `accessTokenIssuer` - Set this to be your [Authress configured custom domain](https://authress.io/app/#/settings?focus=domain).
* `applicationIdentifier` - The application identifier used to securely log users in via the hosted login page. Use the default application or create a new [Authress application](https://authress.io/app/#/settings?focus=applications).
* `bucketWebsiteS3Name` - Your S3 Bucket that contains your private static website. This is necessary to configure the CloudFront to proxy your S3 bucket.
* `identityAwareProxyCustomName` - Provide a custom name of the proxy microservice, is used in the naming of various created resources.
* `identityAwareProxyVersion` - The version of the proxy to deploy. [Available Releases](https://github.com/Authress/identity-aware-proxy/tags)
* `proxyCustomDomain` - [Optional] Specify a domain to host the proxy on. This is where your users will connect to, and will forward the requests to your bucket.
* `proxyRoute53HostedZoneId` - [Optional] Specify the Route53 hosted zone that will be used to connect your custom domain to the CloudFront. This will also be used to request a Certificate for that domain.

The private website configuration is a AWS Stack which creates a CloudFront. The CloudFront is configured with a Lambda@Edge function which requires the user to login before accessing any assets in your S3 bucket or website.

When your users end up at your website, if they are not already logged in, they will be automatically redirected to your [Authress hosted login page](https://authress.io/knowledge-base/docs/authentication/user-authentication) asking them to login to gain access. Additionally, the assets in your bucket will be checked against Authress to ensure that the user has access to the exact resource they are attempting to view. This is done using [Authress authorization](https://authress.io/knowledge-base/docs/category/authorization).

### Enabled behavior

The follow path patterns have been created to enable your website:
* `/index.html` - The root of your website is always public.
* `/public/*` - No authentication will happen on these paths.
* `/login/*` - These are reversed routes for this proxy, requests to this path will be redirected back to the main page.
* - (everything else) - everything else will be checked for valid authentication and authorization of the current user.