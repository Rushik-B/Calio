// src/auth.ts on your Next.js server
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma"; // Ensure this path is correct

// For debugging environment variables
console.log(">>>> [AUTH.TS] Initial process.env.MOBILE_APP_SCHEME:", process.env.MOBILE_APP_SCHEME);
console.log(">>>> [AUTH.TS] Initial process.env.NEXTAUTH_URL:", process.env.NEXTAUTH_URL || process.env.AUTH_URL);


const MOBILE_APP_SCHEME = process.env.MOBILE_APP_SCHEME || "calio"; // Should be "calio" from your .env
console.log(">>>> [AUTH.TS] MOBILE_APP_SCHEME constant:", MOBILE_APP_SCHEME);


const authConfig = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: "openid email profile https://www.googleapis.com/auth/calendar",
        },
      },
    }),
  ],
  session: { strategy: "database" as const },
  secret: process.env.AUTH_SECRET, // Ensure this is set in .env
  debug: process.env.NODE_ENV === 'development',
  callbacks: {
    async redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
      console.log(`[NextAuth Redirect Callback] Attempting to redirect. Received URL: ${url}, BaseURL: ${baseUrl}`);

      // Allow redirect to the intermediate mobile redirect handler page
      if (url.startsWith(`${baseUrl}/auth/mobile-redirect-handler`)) {
        console.log(`[NextAuth Redirect Callback] Allowing redirect to mobile handler: ${url}`);
        return url;
      }

      // IMPORTANT: This is where you'd redirect to the app if the intermediate page wasn't used.
      // However, with the intermediate page, this specific mobile scheme check might not be hit
      // directly after Google sign-in, as the target is the /auth/mobile-redirect-handler.
      // It's good to keep for other potential custom scheme redirects if any.
      if (url.startsWith(`${MOBILE_APP_SCHEME}://`)) {
        console.log(`[NextAuth Redirect Callback] Allowing direct mobile app scheme redirect: ${url}`);
        return url;
      }

      // Allow relative callback URLs
      if (url.startsWith("/")) {
        console.log(`[NextAuth Redirect Callback] Allowing relative callback: <span class="math-inline">\{baseUrl\}</span>{url}`);
        return `<span class="math-inline">\{baseUrl\}</span>{url}`;
      }
      // Allow callback URLs on the same origin
      if (new URL(url).origin === baseUrl) {
        console.log(`[NextAuth Redirect Callback] Allowing same origin callback: ${url}`);
        return url;
      }

      console.log(`[NextAuth Redirect Callback] Defaulting to baseUrl: ${baseUrl}`);
      return baseUrl; // Default to redirecting to the base URL
    },
    async session({ session, user }: {session: any, user: any}) { // Add types for clarity
      if (session.user) {
        session.user.id = user.id; // Add user ID to session
      }
      return session;
    },
  },
  basePath: "/api/auth", // Explicitly set the base path
  trustHost: true,      // For development, trust the host header
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);