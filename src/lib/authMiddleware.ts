import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "./db/queries";

export interface AuthResult {
  valid: boolean;
  error?: string;
  requires?: "api_key" | "auth_token";
}

const MASTER_SECRET = process.env.MASTER_SECRET_KEY || "dev-secret-change-in-production";
const STATIC_AUTH_TOKEN = process.env.AUTH_TOKEN || "";

/**
 * Get client identifier from request for rate limiting and auth
 * Uses X-Forwarded-For header for proxies, falls back to "local" for direct connections
 */
export function getClientIdentifier(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Take the first IP in the chain (client IP)
    return forwarded.split(",")[0].trim();
  }
  // In development or direct connections, use a generic identifier
  // In production behind a proxy, the proxy should set x-forwarded-for
  return "local";
}

export function validateRequest(request: NextRequest, requiredEndpoint?: string): AuthResult {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // Skip auth for settings in DEVELOPMENT only (settings are needed for auth config)
    // In production, require authentication for all endpoints
    if (path.startsWith("/api/settings") && process.env.NODE_ENV === "development") {
      return { valid: true };
    }

    // Check for Authorization header
    const authHeader = request.headers.get("authorization");
    const apiKeyHeader = request.headers.get("x-api-key");
    const authTokenHeader = request.headers.get("x-auth-token");

    // Try auth token first (higher precedence)
    if (authTokenHeader && authTokenHeader === STATIC_AUTH_TOKEN) {
      // Verify endpoint scope if required
      if (requiredEndpoint && !checkTokenEndpoint(authTokenHeader, requiredEndpoint)) {
        return { valid: false, error: "Insufficient permissions for this endpoint", requires: "auth_token" };
      }
      return { valid: true };
    }

    // Try API key
    if (apiKeyHeader) {
      // Different endpoints use different settings keys
      const settingKey = getSettingKeyByEndpoint(requiredEndpoint);
      const storedKey = getSetting(settingKey);
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

function getSettingKeyByEndpoint(endpoint?: string): string {
  // Map endpoints to their corresponding settings keys
  // This fixes the bug where all endpoints were looking for scrape_api_key
  const endpointToSettingMap: Record<string, string> = {
    scrape: "anthropic_api_key",
    bulk: "anthropic_api_key",
    analyze: "anthropic_api_key",
    settings: "anthropic_api_key",
    admin: "master_secret_key",
    auth: "static_auth_token",
  };
  return endpointToSettingMap[endpoint || ""] || "anthropic_api_key"; // default to ANTHROPIC_API_KEY
}

function checkTokenEndpoint(token: string, endpoint: string): boolean {
  // Simple endpoint-based authorization for auth tokens
  // In production, you'd want more granular controls
  // Define which endpoints this token can access
  const allowedEndpoints = ["scrape", "bulk", "analyze", "admin", "settings", "auth"];
  return allowedEndpoints.includes(endpoint) || !endpoint;
}

/**
 * Higher-order function to add authentication to API route handlers
 * Creates a middleware wrapper that validates authentication before calling the original handler
 */
export function withAuth<TArgs extends unknown[]>(
  handler: (request: NextRequest, ...args: TArgs) => Promise<Response | NextResponse>,
  requiredEndpoint?: string
): (request: NextRequest, ...args: TArgs) => Promise<Response | NextResponse> {
  return async (request: NextRequest, ...args: TArgs) => {
    const auth = validateRequest(request, requiredEndpoint);

    if (!auth.valid) {
      const response = NextResponse.json(
        {
          error: auth.error || "Authentication failed",
          requires: auth.requires
        },
        { status: 401 }
      );

      // Set header to indicate what auth type is needed for the client
      if (auth.requires === "api_key") {
        response.headers.set("X-Require-Auth-Type", "api_key");
      } else if (auth.requires === "auth_token") {
        response.headers.set("X-Require-Auth-Type", "token");
      }

      return response;
    }

    return handler(request, ...args);
  };
}