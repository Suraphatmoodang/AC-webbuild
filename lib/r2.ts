import { S3Client } from "@aws-sdk/client-s3";

// ── Cloudflare R2 (SERVER ONLY — never import from a page/component) ─────────
//
// R2 speaks the S3 API, so the AWS SDK drives it unchanged; only the endpoint and
// region differ. These credentials are an R2 API token with Object Read & Write on
// ONE bucket — they must never reach the browser, which is why every use of this
// module lives under pages/api/.
//
// Env vars (set in .env.local AND in the Vercel project settings):
//   R2_ACCOUNT_ID          Cloudflare account id (the R2 endpoint is built from it)
//   R2_ACCESS_KEY_ID       from the R2 API token
//   R2_SECRET_ACCESS_KEY   from the R2 API token
//   R2_BUCKET              bucket name
//   NEXT_PUBLIC_R2_PUBLIC_BASE   public read URL, no trailing slash — the bucket's
//                          custom domain (preferred) or its r2.dev address. PUBLIC on
//                          purpose: the browser builds <img src> from it (see lib/images.ts).
//
// The bucket also needs a CORS rule allowing PUT from the site origin, or the
// browser's direct upload is blocked:
//   [{ "AllowedOrigins": ["https://<your-site>", "http://localhost:3000"],
//      "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]

export const R2_BUCKET = process.env.R2_BUCKET ?? "";

export const r2Configured = (): boolean =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && R2_BUCKET);

let _client: S3Client | undefined;

export function r2(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // R2 does not implement S3's newer default checksum headers. Left on, the SDK
      // signs an x-amz-checksum-* header the browser won't send on the presigned PUT,
      // and R2 rejects the upload as SignatureDoesNotMatch. "WHEN_REQUIRED" is the
      // documented fix — do not remove this without re-testing a real upload.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return _client;
}
