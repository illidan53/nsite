// global-network.nphunter.gg：私有 S3 桶 + CloudFront（OAC）+ ACM 证书 + Route 53 别名记录，
// 以及供 GitHub Actions 通过 OIDC 部署静态文件的 IAM 角色。
// 本地执行：cd infra && npm ci && AWS_PROFILE=nphunter-sso pulumi up -s prod

import { readFileSync } from "node:fs";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const accountId = config.require("accountId");
const domain = config.require("domain");
const zoneName = config.require("zoneName");
const bucketName = config.require("bucketName");
const githubOwner = config.require("githubOwner");
const githubRepo = config.require("githubRepo");
const githubBranch = config.get("githubBranch") ?? "main";
// 仓库启用了 GitHub 的不可变 OIDC subject（带 owner/仓库数字 ID），仓库改名或被重建后旧信任不会被冒用。
// 查询：gh api repos/<owner>/<repo>/actions/oidc/customization/sub
const githubSubjectPrefix = config.require("githubSubjectPrefix");
if (!new RegExp(`^repo:${githubOwner}@\\d+/${githubRepo}@\\d+$`).test(githubSubjectPrefix)) {
  throw new Error("githubSubjectPrefix 必须是该仓库的不可变 OIDC 前缀，例如 repo:owner@123/repo@456");
}
// 站长专用的测量接口：个人 RIPE Atlas API key 与允许触发测量的来源 IP 都以 Pulumi secret 保存。
const ripeAtlasKey = config.getSecret("ripeAtlasKey") ?? pulumi.secret("");
const ownerIps = config.requireSecret("ownerIps");
const dailyLimit = config.getNumber("dailyMeasurementLimit") ?? 50;
const githubOidcProviderArn =
  config.get("githubOidcProviderArn") ??
  `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;

const tags = { Service: "nsite", Name: "nsite-global-network" };

// AWS 托管策略 ID
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const SECURITY_HEADERS = "67f7725c-6f97-4210-82d7-5512b31e9d03";
// 含全部 CloudFront-Viewer-* 地理定位请求头，CloudFront Function 才能读到它们。
const ALL_VIEWER_AND_CLOUDFRONT_HEADERS = "33f36d7e-f396-46d9-90e0-52428a34d9dc";
// 转发全部查看者请求头（Host 除外，函数 URL 需要自己的 Host）及 CloudFront-Viewer-Address。
const ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

const zone = aws.route53.getZoneOutput({ name: zoneName, privateZone: false });

// ---------------------------------------------------------------- S3

const bucket = new aws.s3.Bucket("siteBucket", { bucket: bucketName, tags });

new aws.s3.BucketPublicAccessBlock("siteBucketPublicAccessBlock", {
  bucket: bucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

new aws.s3.BucketOwnershipControls("siteBucketOwnership", {
  bucket: bucket.id,
  rule: { objectOwnership: "BucketOwnerEnforced" },
});

new aws.s3.BucketServerSideEncryptionConfiguration("siteBucketEncryption", {
  bucket: bucket.id,
  rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
});

// ---------------------------------------------------------------- 证书（CloudFront 要求 us-east-1）

const cert = new aws.acm.Certificate("siteCert", {
  domainName: domain,
  validationMethod: "DNS",
  tags,
});

const certValidationRecord = new aws.route53.Record("siteCertValidation", {
  zoneId: zone.zoneId,
  name: cert.domainValidationOptions[0].resourceRecordName,
  type: cert.domainValidationOptions[0].resourceRecordType,
  records: [cert.domainValidationOptions[0].resourceRecordValue],
  ttl: 300,
  allowOverwrite: true,
});

const certValidation = new aws.acm.CertificateValidation("siteCertValidationWait", {
  certificateArn: cert.arn,
  validationRecordFqdns: [certValidationRecord.fqdn],
});

// ---------------------------------------------------------------- CloudFront

const oac = new aws.cloudfront.OriginAccessControl("siteOac", {
  name: "nsite-global-network-oac",
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});

const originId = "s3-nsite-global-network";
const apiOriginId = "lambda-nsite-api";

// ---------------------------------------------------------------- 测量 API（Lambda + DynamoDB）

const table = new aws.dynamodb.Table("measurements", {
  name: "nsite-measurements",
  billingMode: "PAY_PER_REQUEST",
  hashKey: "pk",
  rangeKey: "createdAt",
  attributes: [
    { name: "pk", type: "S" },
    { name: "createdAt", type: "S" },
  ],
  tags,
});

const apiRole = new aws.iam.Role("apiRole", {
  name: "nsite-api-lambda",
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
  tags,
});
new aws.iam.RolePolicyAttachment("apiLogs", {
  role: apiRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});
new aws.iam.RolePolicy("apiTable", {
  role: apiRole.id,
  policy: table.arn.apply((arn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"], Resource: arn }],
    }),
  ),
});

const api = new aws.lambda.Function("api", {
  name: "nsite-api",
  runtime: "nodejs22.x",
  architectures: ["arm64"],
  handler: "index.handler",
  role: apiRole.arn,
  timeout: 25,
  memorySize: 256,
  code: new pulumi.asset.AssetArchive({
    "index.mjs": new pulumi.asset.FileAsset(new URL("../api/index.mjs", import.meta.url).pathname),
    "owner.mjs": new pulumi.asset.FileAsset(new URL("../api/owner.mjs", import.meta.url).pathname),
  }),
  environment: {
    variables: {
      TABLE: table.name,
      RIPE_ATLAS_KEY: ripeAtlasKey,
      OWNER_IPS: ownerIps,
      DAILY_LIMIT: String(dailyLimit),
      SITE_ORIGIN: `https://${domain}`,
    },
  },
  tags,
});

const apiUrl = new aws.lambda.FunctionUrl("apiUrl", { functionName: api.name, authorizationType: "AWS_IAM" });

const apiOac = new aws.cloudfront.OriginAccessControl("apiOac", {
  name: "nsite-api-oac",
  originAccessControlOriginType: "lambda",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});

// /geo：在边缘直接返回访问者的大致位置，供页面载入时拉近到所在地区。
const geoFunction = new aws.cloudfront.Function("geoFunction", {
  name: "nsite-viewer-geo",
  runtime: "cloudfront-js-2.0",
  comment: "Return the viewer's approximate location as JSON",
  publish: true,
  code: readFileSync(new URL("./geo-function.js", import.meta.url), "utf8"),
});

const distribution = new aws.cloudfront.Distribution("siteCdn", {
  enabled: true,
  isIpv6Enabled: true,
  httpVersion: "http2and3",
  comment: domain,
  defaultRootObject: "index.html",
  aliases: [domain],
  origins: [
    {
      domainName: bucket.bucketRegionalDomainName,
      originId,
      originAccessControlId: oac.id,
    },
    {
      domainName: apiUrl.functionUrl.apply((u) => new URL(u).host),
      originId: apiOriginId,
      originAccessControlId: apiOac.id,
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originProtocolPolicy: "https-only",
        originSslProtocols: ["TLSv1.2"],
      },
    },
  ],
  orderedCacheBehaviors: [
    {
      pathPattern: "/api/*",
      targetOriginId: apiOriginId,
      viewerProtocolPolicy: "https-only",
      allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      cachedMethods: ["GET", "HEAD"],
      compress: true,
      cachePolicyId: CACHING_DISABLED,
      originRequestPolicyId: ALL_VIEWER_EXCEPT_HOST,
      responseHeadersPolicyId: SECURITY_HEADERS,
    },
    {
      pathPattern: "/geo",
      targetOriginId: originId,
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD"],
      cachedMethods: ["GET", "HEAD"],
      compress: false,
      cachePolicyId: CACHING_DISABLED,
      originRequestPolicyId: ALL_VIEWER_AND_CLOUDFRONT_HEADERS,
      responseHeadersPolicyId: SECURITY_HEADERS,
      functionAssociations: [{ eventType: "viewer-request", functionArn: geoFunction.arn }],
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: originId,
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD"],
    cachedMethods: ["GET", "HEAD"],
    compress: true,
    cachePolicyId: CACHING_OPTIMIZED,
    responseHeadersPolicyId: SECURITY_HEADERS,
  },
  viewerCertificate: {
    acmCertificateArn: certValidation.certificateArn,
    sslSupportMethod: "sni-only",
    minimumProtocolVersion: "TLSv1.2_2021",
  },
  restrictions: { geoRestriction: { restrictionType: "none" } },
  // 面向全球访问者（含亚洲、南美、大洋洲），使用全部边缘节点。
  priceClass: "PriceClass_All",
  tags,
});

new aws.s3.BucketPolicy("siteBucketPolicy", {
  bucket: bucket.id,
  policy: pulumi.all([bucket.arn, distribution.arn]).apply(([bucketArn, distributionArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "AllowCloudFrontOAC",
          Effect: "Allow",
          Principal: { Service: "cloudfront.amazonaws.com" },
          Action: "s3:GetObject",
          Resource: `${bucketArn}/*`,
          Condition: { StringEquals: { "AWS:SourceArn": distributionArn } },
        },
      ],
    }),
  ),
});

// 只允许本分发调用函数 URL（OAC 签名）。
new aws.lambda.Permission("apiInvokeUrlFromCloudFront", {
  action: "lambda:InvokeFunctionUrl",
  function: api.name,
  principal: "cloudfront.amazonaws.com",
  sourceArn: distribution.arn,
  functionUrlAuthType: "AWS_IAM",
});
new aws.lambda.Permission("apiInvokeFromCloudFront", {
  action: "lambda:InvokeFunction",
  function: api.name,
  principal: "cloudfront.amazonaws.com",
  sourceArn: distribution.arn,
});

for (const type of ["A", "AAAA"] as const) {
  new aws.route53.Record(`siteAlias${type}`, {
    zoneId: zone.zoneId,
    name: domain,
    type,
    aliases: [
      {
        name: distribution.domainName,
        zoneId: distribution.hostedZoneId,
        evaluateTargetHealth: false,
      },
    ],
  });
}

// ---------------------------------------------------------------- GitHub Actions 部署角色

const deployRole = new aws.iam.Role("githubDeployRole", {
  name: "nsite-github-deploy",
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: githubOidcProviderArn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": `${githubSubjectPrefix}:ref:refs/heads/${githubBranch}`,
          },
        },
      },
    ],
  }),
  tags,
});

new aws.iam.RolePolicy("githubDeployPolicy", {
  role: deployRole.id,
  policy: pulumi.all([bucket.arn, distribution.arn]).apply(([bucketArn, distributionArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        { Sid: "ListSiteBucket", Effect: "Allow", Action: ["s3:ListBucket"], Resource: bucketArn },
        {
          Sid: "WriteSiteObjects",
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
          Resource: `${bucketArn}/*`,
        },
        {
          Sid: "InvalidateSiteCdn",
          Effect: "Allow",
          Action: ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
          Resource: distributionArn,
        },
      ],
    }),
  ),
});

export const url = `https://${domain}`;
export const bucketId = bucket.id;
export const distributionId = distribution.id;
export const distributionDomain = distribution.domainName;
export const deployRoleArn = deployRole.arn;
export const apiFunction = api.name;
export const measurementsTable = table.name;
