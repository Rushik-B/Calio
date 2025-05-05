import NextAuth, { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { PrismaClient } from "@/generated/prisma";
import { encrypt } from "@/lib/encryption"; // Adjust path if needed

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
        // Store the original tokens and expiry from the account for session use
        token.accessToken = account.access_token;
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined;
        token.userId = user.id; // Persist the user ID from the database into the token

        // Encrypt tokens before they are saved to the database by the adapter
        // Note: This happens *after* the adapter potentially saves the plain tokens initially.
        // We update the record immediately after.
        let encryptedAccessToken: string | undefined;
        let encryptedRefreshToken: string | undefined;

        if (account.access_token) {
          encryptedAccessToken = encrypt(account.access_token);
        }
        if (account.refresh_token) {
          encryptedRefreshToken = encrypt(account.refresh_token);
        }

        // Update the Account record in the database with encrypted tokens
        if (encryptedAccessToken || encryptedRefreshToken) {
          try {
            await prisma.account.update({
              where: {
                provider_providerAccountId: {
                  provider: account.provider,
                  providerAccountId: account.providerAccountId,
                },
              },
              data: {
                access_token: encryptedAccessToken ?? undefined, // Use encrypted or null
                refresh_token: encryptedRefreshToken ?? undefined,
              },
            });
            console.log(`Tokens encrypted for user ${user.id}, provider ${account.provider}`);
          } catch (error) {
            console.error('Failed to update account with encrypted tokens:', error);
            token.error = "encryption_failed"; // Add error info to token
          }
        }
      }

      // TODO: Add token rotation logic here if needed later

      return token;
    },
    async session({ session, token }) {
      // Send properties to the client, like an access_token and user id from the token.
      session.accessToken = token.accessToken as string | undefined;
      session.error = token.error as string | undefined;
      session.user.id = token.userId as string; // Add user ID to session
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  // debug: process.env.NODE_ENV === 'development', // Optional: Enable debug messages
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };