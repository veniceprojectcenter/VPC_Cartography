// Server-only. Where tile sets and their source images live: S3, or uploads/ on this machine.
// Both hand the browser short-lived signed PUT URLs, so the upload code is the same for either;
// the browser never sees AWS credentials.
//
//   IMAGE_STORE=s3     S3_BUCKET, S3_REGION, S3_PUBLIC_URL (optional; default the bucket's own URL),
//                      AWS credentials from the usual AWS_* variables
//   IMAGE_STORE=local  uploads/ in the project, served by app/api/local-tiles (development only)

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

export type SignedPut = { key: string; url: string; headers: Record<string, string> };

// Tile sets never change once written, so they can be cached for good.
const TILE_CACHE = "public, max-age=31536000, immutable";
// Long enough for a slow batch, short enough that a leaked URL is soon useless.
const URL_LIFETIME_S = 15 * 60;

export const TILESET_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
// z/x/y.webp, or the original image as source.<ext>.
export const OBJECT_NAME = /^(?:\d{1,2}\/\d{1,7}\/\d{1,7}\.webp|source\.(?:jpe?g|png|tiff?|webp))$/;

const CONTENT_TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", tif: "image/tiff", tiff: "image/tiff" };
export const content_type = (name: string) => CONTENT_TYPES[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

const object_key = (tilesetId: string, name: string) => `tilesets/${tilesetId}/${name}`;

const use_s3 = () => process.env.IMAGE_STORE === "s3";

// ---------- S3 ----------

// On Vercel, AWS_ROLE_ARN: the function trades its short-lived Vercel OIDC token for the role's
// credentials, so the host holds no AWS secret that could leak or need rotating. Elsewhere, the
// SDK's usual chain (AWS_* variables, ~/.aws).
async function s3() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  if (!bucket || !region) throw new Error("IMAGE_STORE=s3 needs S3_BUCKET and S3_REGION");
  const roleArn = process.env.AWS_ROLE_ARN;
  const credentials = roleArn ? (await import("@vercel/functions/oidc")).awsCredentialsProvider({ roleArn, clientConfig: { region } }) : undefined;
  return { client: new S3Client({ region, credentials }), bucket, region };
}

// ---------- local ----------

const LOCAL_DIR = join(process.cwd(), "uploads");
// Per process unless set: a restart just means the browser asks for fresh URLs.
const LOCAL_SECRET = process.env.LOCAL_TILE_SECRET ?? randomBytes(32).toString("hex");

function local_signature(key: string, expires: number): string {
  return createHmac("sha256", LOCAL_SECRET).update(`${key}\n${expires}`).digest("base64url");
}

export function local_put_allowed(key: string, expires: number, sig: string): boolean {
  if (!(expires > Date.now() / 1000)) return false;
  const want = Buffer.from(local_signature(key, expires));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

// Inside uploads/ and nowhere else.
export function local_path(key: string): string | null {
  const path = join(LOCAL_DIR, ...key.split("/"));
  return relative(LOCAL_DIR, path).split(sep)[0] === ".." ? null : path;
}

export async function local_write(key: string, bytes: Uint8Array) {
  const path = local_path(key);
  if (!path) throw new Error("bad key");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function local_read(key: string): Promise<Buffer | null> {
  const path = local_path(key);
  return path ? readFile(path).catch(() => null) : null;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

// ---------- the two calls the route makes ----------

export async function sign_puts(tilesetId: string, names: string[], origin: string): Promise<SignedPut[]> {
  if (use_s3()) {
    const [{ PutObjectCommand }, { getSignedUrl }, { client, bucket }] = await Promise.all([import("@aws-sdk/client-s3"), import("@aws-sdk/s3-request-presigner"), s3()]);
    return Promise.all(names.map(async (name) => {
      const headers = { "Content-Type": content_type(name), "Cache-Control": TILE_CACHE };
      const command = new PutObjectCommand({ Bucket: bucket, Key: object_key(tilesetId, name), ContentType: headers["Content-Type"], CacheControl: TILE_CACHE });
      return { key: name, url: await getSignedUrl(client, command, { expiresIn: URL_LIFETIME_S }), headers };
    }));
  }
  const expires = Math.floor(Date.now() / 1000) + URL_LIFETIME_S;
  return names.map((name) => {
    const key = object_key(tilesetId, name);
    return { key: name, url: `${origin}/api/local-tiles/${key}?expires=${expires}&sig=${local_signature(key, expires)}`, headers: { "Content-Type": content_type(name) } };
  });
}

// Every name already stored for this tile set: what an interrupted upload can skip, and what the
// final check counts.
export async function list_names(tilesetId: string): Promise<string[]> {
  const prefix = object_key(tilesetId, "");
  if (use_s3()) {
    const [{ ListObjectsV2Command }, { client, bucket }] = await Promise.all([import("@aws-sdk/client-s3"), s3()]);
    const names: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) if (o.Key) names.push(o.Key.slice(prefix.length));
      token = page.NextContinuationToken;
    } while (token);
    return names;
  }
  const root = local_path(prefix)!;
  return (await walk(root)).map((p) => relative(root, p).split(sep).join("/"));
}

// Where a browser reads the tile set from; tiles_url is this plus /{z}/{x}/{y}.webp.
export async function public_base(tilesetId: string): Promise<string> {
  if (use_s3()) {
    const { bucket, region } = await s3();
    const base = process.env.S3_PUBLIC_URL ?? `https://${bucket}.s3.${region}.amazonaws.com`;
    return `${base.replace(/\/+$/, "")}/${object_key(tilesetId, "")}`.replace(/\/$/, "");
  }
  return `/api/local-tiles/${object_key(tilesetId, "")}`.replace(/\/$/, "");
}
