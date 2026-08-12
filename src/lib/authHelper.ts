import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "./db/queries";

export interface AuthResult {
  valid: boolean;
  error?: string;
  requires?: "api_key" | "auth_token";
}

const STATIC_AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const MASTER_SECRET = process.env.MASTER_SECRET_KEY || "dev-secret-change-in-production";

export function getClientIdentifier(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Take the first IP in the chain (client IP)
    return forwarded.split(",")[0].trim();
  }
  return "local";
}

export function validateRequest(request: NextRequest, requiredEndpoint?: string): AuthResult {
  try {
    // Check for Authorization header
    const authHeader = request.headers.get("authorization");
    const apiKeyHeader = request.headers.get("x-api-key");
    const authTokenHeader = request.headers.get("x-auth-token");

    // Try auth token first
    if (authTokenHeader && authTokenHeader === STATIC_AUTH_TOKEN) {
      // Verify endpoint scope if required
      if (requiredEndpoint && !checkTokenEndpoint(authTokenHeader, requiredEndpoint)) {
        return { valid: false, error: "Insufficient permissions for this endpoint", requires: "auth_token" };
      }
      return { valid: true };
    }

    // Try API key
    if (apiKeyHeader) {
      const storedKey = getSetting(`${requiredEndpoint || "general"}_api_key`);
      if (storedKey && apiKeyHeader === storedKey) {
        return { valid: true };
      }
      return { valid: false, error: "Invalid API key", requires: "api_key" };
    }

    // Try master secret for admin operations
    if (MASTER_SECRET && request.headers.get("x-master-secret") === MASTER_SECRET) {
      return { valid: true };
    }

    return { valid: false, error: "Authentication required", requires: "auth_token" };
  } catch (error) {
    console.error("Auth validation error:", error);
    return { valid: false, error: "Authentication validation failed" };
  }
}

function checkTokenEndpoint(token: string, endpoint: string): boolean {
  // Simple endpoint-based authorization for auth tokens
  const adminEndpoints = ["scrape", "bulk", "analyze", "admin", "settings"];
  return adminEndpoints.includes(endpoint) || !endpoint;
}

export async function authenticateRequest(
  request: NextRequest,
  endpoint?: string
): Promise<AuthResult> {
  return validateRequest(request, endpoint);
}

export async function checkRouteAuth(request: NextRequest, endpoint?: string): Promise<boolean> {
  const auth = await authenticateRequest(request, endpoint);
  return auth.valid;
}

export async function requireAuth(
  request: NextRequest,
  endpoint?: string,
  error?: { status: number; message: string }
): Promise<AuthResult> {
  const auth = await authenticateRequest(request, endpoint);
  return auth;
}