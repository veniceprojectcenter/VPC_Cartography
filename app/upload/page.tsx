import type { Metadata } from "next";
import Uploader from "@/components/Uploader";

export const metadata: Metadata = { title: "Upload a map — Venetian Historical Map Explorer" };

// Served cross-origin isolated (next.config.ts) so the tiler can use threads.
export default function Page() {
  return <Uploader />;
}
