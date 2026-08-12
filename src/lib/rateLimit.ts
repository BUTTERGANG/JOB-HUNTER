import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory rate limiter for API routes.
 * In production, consider using Redis or a more robust solution.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  headers: Record<string, string>;
}

export function createRateLimiter(config: RateLimitConfig) {
  return function rateLimit(identifier: string): RateLimitResult {
    const now = Date.now();
    const entry = rateLimitStore.get(identifier);

    if (!entry || now > entry.resetAt) {
      // First request or window expired
      const resetAt = now + config.windowMs;
      rateLimitStore.set(identifier, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt,
        headers: {
          "X-RateLimit-Limit": String(config.maxRequests),
          "X-RateLimit-Remaining": String(config.maxRequests - 1),
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
        },
      };
    }

    if (entry.count >= config.maxRequests) {
      // Rate limited
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        headers: {
          "X-RateLimit-Limit": String(config.maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
          "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
        },
      };
    }

    // Increment count
    entry.count++;
    const remaining = config.maxRequests - entry.count;
    rateLimitStore.set(identifier, entry);
    return {
      allowed: true,
      remaining,
      resetAt: entry.resetAt,
      headers: {
        "X-RateLimit-Limit": String(config.maxRequests),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
      },
    };
  };
}

/**
 * Get client identifier from request.
 * Uses x-forwarded-for header (for proxied requests) or falls back to IP.
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

/**
 * Specific rate limiters for different endpoints
 */

// AI endpoints - strict limits (expensive API calls)
export const aiRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000, // 10 requests per minute
});

// Scraping endpoints - moderate limits
export const scrapeRateLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60_000, // 20 requests per minute
});

// Settings - generous limits
export const settingsRateLimiter = createRateLimiter({
  maxRequests: 60,
  windowMs: 60_000, // 60 requests per minute
});

// General API - generous limits
export const generalRateLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60_000, // 100 requests per minute
});

// Bulk scan - very strict (long-running operation)
export const bulkScanRateLimiter = createRateLimiter({
  maxRequests: 2,
  windowMs: 300_000, // 2 requests per 5 minutes
});