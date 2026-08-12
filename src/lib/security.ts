"use server";

import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "./db/queries";

// Rate limiting store - in production, use Redis
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

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
 * Get client identifier from request headers
 */
export function getClientIdentifier(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Take the first IP in the chain (client IP)
    return forwarded.split(",")[0].trim();
  }
  // Fallback to a secure identifier
  return "client";
}

/**
 * Clean up expired rate limit entries periodically
 */
export function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Generate rate limit headers for response
 */
export function setRateLimitHeaders(response: NextResponse, rateLimit: RateLimitResult): NextResponse {
  Object.entries(rateLimit.headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

// Create pre-configured rate limiters for different endpoints
export const authRateLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60_000, // 5 requests per minute
});

export const apiRateLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60_000, // 100 requests per minute
});

export const scrapeRateLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60_000, // 20 requests per minute
});

export const analyzeRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000, // 10 requests per minute
});

export const bulkRateLimiter = createRateLimiter({
  maxRequests: 2,
  windowMs: 300_000, // 2 requests per 5 minutes
});