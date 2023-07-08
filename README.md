# Authress Identity Aware Proxy + Private Website Authentication

This repository contains two proxies that enable adding Authentication and security to existing applications and platforms without changing any code in those services.

* Service Identity Aware Proxy (IAP)
* Private Website

## Identity Aware Proxy

* [Stack Template](./templates/identityAwareProxyStackTemplate.json)

The IAP enables adding globally redundant and fault tolerant authentication to an existing service being run. After deploying the stack, your service will automatically receive user identity tokens that can be verified. These tokens are automatically verified by the proxy to ensure all requests to the services themselves are secured.

## Private Website

* [Stack Template](./templates/privateWebsiteStackTemplate.json)

The private website configuration is a AWS Stack which creates a CloudFront. The CloudFront is configured with a Lambda@Edge function which requires the user to login before accessing any assets in your S3 bucket or website.

When your users end up at your website, if they are not already logged in, they will be automatically redirected to your [Authress hosted login page](https://authress.io/knowledge-base/docs/authentication/user-authentication) asking them to login to gain access. Additionally, the assets in your bucket will be checked against Authress to ensure that the user has access to the exact resource they are attempting to view. This is done using [Authress authorization](https://authress.io/knowledge-base/docs/category/authorization).