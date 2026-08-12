import { NextRequest, NextResponse } from "next/server";
import { getClientIdentifier } from "@/lib/authMiddleware";

export async function GET(request: NextRequest) {
  // Minimal auth for health check - no sensitive data returned
  const clientId = getClientIdentifier(request);
  return Response.json({ status: "ok", timestamp: Date.now() }, { status: 200 });
}