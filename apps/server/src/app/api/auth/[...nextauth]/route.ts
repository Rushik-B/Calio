import NextAuth, { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { PrismaClient } from "@/generated/prisma";
import { encrypt, decrypt } from "@/lib/encryption"; // Updated import

const prisma = new PrismaClient();

if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error("Missing GOOGLE_CLIENT_ID environment variable");
}
if (!process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("Missing GOOGLE_CLIENT_SECRET environment variable");
}

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          // Request specific Google Calendar scopes
          scope: "openid email profile https://www.googleapis.com/auth/calendar",
          // IMPORTANT: Ensure 'access_type=offline' to get a refresh token
        },
      },
    }),
    // ...add more providers here if needed
  ],
  session: {
    strategy: "jwt", // Use JSON Web Tokens for session strategy
  },
  callbacks: {
    async jwt({ token, user, account }) {
      // Initial sign in
      if (account && user) {
        token.accessToken = account.access_token;
        // Convert expires_at from seconds to milliseconds for consistency
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined;
        // account.refresh_token is only initially available during the very first sign-in.
        // It should be securely stored, e.g., in the database, for later use.
        token.refreshToken = account.refresh_token; // Persist refresh token to JWT for this session
        token.userId = user.id; // Persist the user ID from the database into the token

        // Encrypt tokens before they are saved to the database by the adapter
        // This update happens after the Prisma adapter's initial save.
        let encryptedAccessToken: string | undefined;
        let encryptedRefreshToken: string | undefined;

        if (account.access_token) {
          encryptedAccessToken = encrypt(account.access_token);
        }
        // IMPORTANT: Only encrypt and store the refresh token if it's provided by Google.
        // Google only provides it on the first authorization.
        if (account.refresh_token) {
          encryptedRefreshToken = encrypt(account.refresh_token);
        }

        if (encryptedAccessToken || encryptedRefreshToken) {
          try {
            const dataToUpdate: { access_token?: string; refresh_token?: string } = {};
            if (encryptedAccessToken) dataToUpdate.access_token = encryptedAccessToken;
            if (encryptedRefreshToken) dataToUpdate.refresh_token = encryptedRefreshToken;

            await prisma.account.update({
              where: {
                provider_providerAccountId: {
                  provider: account.provider,
                  providerAccountId: account.providerAccountId,
                },
              },
              data: dataToUpdate,
            });
            console.log(`Tokens for user ${user.id}, provider ${account.provider} potentially updated with encryption.`);
          } catch (error) {
            console.error('Failed to update account with encrypted tokens:', error);
            token.error = "encryption_failed";
          }
        }
        return token;
      }

      // Return previous token if the access token has not expired yet
      if (token.accessTokenExpires && Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }

      // Access token has expired, try to update it using the refresh token.
      console.log("Access token expired, attempting refresh...");

      if (!token.userId) {
        console.error("No userId in token, cannot refresh.");
        token.error = "RefreshErrorNoUserId";
        return { ...token, accessToken: undefined, accessTokenExpires: undefined, refreshToken: undefined, error: "RefreshErrorNoUserId" };
      }
      
      try {
        const dbAccount = await prisma.account.findFirst({ 
          where: {
            userId: token.userId as string,
            provider: 'google', 
          },
        });

        if (!dbAccount || !dbAccount.refresh_token) {
          console.error("No refresh token found in DB for user", token.userId);
          // Potentially clear the token to force re-login if refresh token is expected but missing
          return { ...token, accessToken: undefined, accessTokenExpires: undefined, refreshToken: undefined, error: "RefreshErrorNoDBRefreshToken" };
        }

        const decryptedRefreshToken = decrypt(dbAccount.refresh_token);

        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: "refresh_token",
            refresh_token: decryptedRefreshToken,
          }),
        });

        const refreshedTokens = await response.json();

        if (!response.ok) {
          console.error("Failed to refresh access token", refreshedTokens);
          // If refresh token is invalid (e.g., revoked), clear it from DB and token
          if (refreshedTokens.error === "invalid_grant") {
            await prisma.account.update({
              where: { id: dbAccount.id },
              data: { refresh_token: null, access_token: null, expires_at: null },
            });
             return { ...token, accessToken: undefined, accessTokenExpires: undefined, refreshToken: undefined, error: "RefreshErrorInvalidGrant" };
          }
          token.error = "RefreshAccessTokenError";
          return { ...token, error: "RefreshAccessTokenError" }; // Keep old potentially expired token with error
        }
        
        console.log("Successfully refreshed access token for user:", token.userId);

        // Update the JWT token with new values
        token.accessToken = refreshedTokens.access_token;
        token.accessTokenExpires = Date.now() + refreshedTokens.expires_in * 1000;
        // Google might send a new refresh token, though often it doesn't for subsequent refreshes.
        // If it does, update it in the JWT and encrypt/save it.
        token.refreshToken = refreshedTokens.refresh_token ?? token.refreshToken; 

        // Encrypt and update the tokens in the database
        const newEncryptedAccessToken = encrypt(refreshedTokens.access_token);
        let newEncryptedRefreshToken: string | undefined;
        if (refreshedTokens.refresh_token) {
          newEncryptedRefreshToken = encrypt(refreshedTokens.refresh_token);
        }

        const dataToUpdate: { access_token: string; expires_at: number; refresh_token?: string } = {
          access_token: newEncryptedAccessToken,
          expires_at: Math.floor((token.accessTokenExpires as number) / 1000), // Store as seconds
        };
        if (newEncryptedRefreshToken) {
          dataToUpdate.refresh_token = newEncryptedRefreshToken;
        }
        
        await prisma.account.update({
          where: { id: dbAccount.id },
          data: dataToUpdate,
        });
        
        // Clear any previous error on successful refresh
        delete token.error;
        return token;

      } catch (error) {
        console.error("Error refreshing access token:", error);
        token.error = "RefreshAccessTokenErrorCatch";
        return { ...token, error: "RefreshAccessTokenErrorCatch" }; // Keep old potentially expired token with error
      }
    },
    async session({ session, token }) {
      // Send properties to the client, like an access_token and user id from the token.
      session.accessToken = token.accessToken as string | undefined;
      session.error = token.error as string | undefined;
      session.user.id = token.userId as string; // Add user ID to session
      return session;
    },
    async redirect({ url, baseUrl }) {
      console.log("[NextAuth Redirect Callback] Received URL for redirect decision:", url);
      console.log("[NextAuth Redirect Callback] BaseURL:", baseUrl);

      // Allow URLs that are on the same origin as the NextAuth.js deployment.
      // This will allow our /auth/mobile-redirect-landing?redirectTo=exp://... URL.
      if (url.startsWith(baseUrl)) {
        console.log("[NextAuth Redirect Callback] Allowing redirect to (same base origin):", url);
        return url;
      }
      // Allow relative URLs (these are implicitly on the same origin).
      if (url.startsWith('/')) {
        const absoluteUrl = `${baseUrl}${url}`;
        console.log("[NextAuth Redirect Callback] Allowing redirect to relative path (now absolute):", absoluteUrl);
        return absoluteUrl;
      }
      
      // For all other scenarios, redirect to the base URL as a safe default.
      // This prevents open redirect vulnerabilities.
      console.log("[NextAuth Redirect Callback] URL does not meet criteria, defaulting to baseUrl:", baseUrl);
      return baseUrl;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  // debug: process.env.NODE_ENV === 'development', // Optional: Enable debug messages
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };