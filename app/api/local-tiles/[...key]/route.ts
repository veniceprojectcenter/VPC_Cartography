import { content_type, local_put_allowed, local_read, local_write } from "@/lib/image-store";

// The local stand-in for the S3 bucket: GET serves uploads/, PUT takes a signed URL from /api/tiles.
// Development only; the deployed build stores images in S3.

const DEV_ONLY = () => Response.json({ error: "Local image storage is only on in development." }, { status: 403 });

export async function GET(_request: Request, ctx: RouteContext<"/api/local-tiles/[...key]">) {
  if (process.env.NODE_ENV === "production") return DEV_ONLY();
  const key = (await ctx.params).key.join("/");
  const bytes = await local_read(key);
  if (!bytes) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": content_type(key), "Cache-Control": "no-cache", "Cross-Origin-Resource-Policy": "same-origin" },
  });
}

export async function PUT(request: Request, ctx: RouteContext<"/api/local-tiles/[...key]">) {
  if (process.env.NODE_ENV === "production") return DEV_ONLY();
  const key = (await ctx.params).key.join("/");
  const url = new URL(request.url);
  if (!local_put_allowed(key, Number(url.searchParams.get("expires")), url.searchParams.get("sig") ?? "")) {
    return Response.json({ error: "This upload link has expired or is not valid." }, { status: 403 });
  }
  await local_write(key, new Uint8Array(await request.arrayBuffer()));
  return new Response(null, { status: 200 });
}
