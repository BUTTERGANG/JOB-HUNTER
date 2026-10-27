import { NextRequest } from "next/server";
import { getClientIdentifier } from "@/lib/authMiddleware";

export async function GET(request: NextRequest) {
  // Minimal health check — no sensitive data returned. The client identifier is
  // the same value rate limiting uses, which makes a stuck limiter debuggable.
  return Response.json(
    { status: "ok", timestamp: Date.now(), client: getClientIdentifier(request) },
    { status: 200 }
  );
}