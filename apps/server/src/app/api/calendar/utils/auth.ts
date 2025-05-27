import { NextRequest } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node";

export interface AuthenticatedUser {
  userId: string;
  googleAccessToken: string;
}

/**
 * Authenticates a user request and returns user info with Google access token
 * @param req NextRequest object
 * @returns Promise<AuthenticatedUser>
 * @throws Error if authentication fails
 */
export async function authenticateUser(req: NextRequest): Promise<AuthenticatedUser> {
  // 1. Extract and validate authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new Error("Authorization header is missing");
  }
  
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    throw new Error("Malformed token in Authorization header");
  }

  // 2. Verify Clerk token and get user ID
  let userId: string;
  try {
    const claims = await clerkClient.verifyToken(token);
    if (!claims.sub) {
      throw new Error("User ID (sub) not found in token claims");
    }
    userId = claims.sub;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid token: ${message}`);
  }

  // 3. Get Google OAuth Access Token from Clerk
  let googleAccessToken: string;
  try {
    const response = await clerkClient.users.getUserOauthAccessToken(userId, "google");
    const oauthAccessTokens = response.data;
    
    if (!oauthAccessTokens || oauthAccessTokens.length === 0 || !oauthAccessTokens[0].token) {
      throw new Error("Google OAuth token not found. Please ensure your Google account is connected and calendar permissions are granted.");
    }
    
    googleAccessToken = oauthAccessTokens[0].token;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error fetching Google OAuth token";
    console.error("Error fetching Google OAuth token from Clerk:", error);
    
    // Re-throw with more specific error message
    if (message.includes("Google OAuth token not found")) {
      throw new Error(message);
    }
    throw new Error(`Failed to fetch Google OAuth token: ${message}`);
  }

  return {
    userId,
    googleAccessToken,
  };
}

/**
 * Creates a standardized error response for authentication failures
 * @param error Error object
 * @returns Object with error message and appropriate HTTP status code
 */
export function getAuthErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown authentication error";
  
  if (message.includes("Authorization") || message.includes("token") || message.includes("Invalid token")) {
    return { error: message, status: 401 };
  }
  
  if (message.includes("Google OAuth")) {
    return { error: message, status: 403 };
  }
  
  return { error: `Authentication failed: ${message}`, status: 500 };
} 