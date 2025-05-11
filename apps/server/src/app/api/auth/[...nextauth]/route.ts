import { NextAuth } from "@auth/nextjs";
import Google from "@auth/core/providers/google";
import type { Provider } from "@auth/core/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/encryption";

import type { Adapter, AdapterUser } from "@auth/core/adapters";
import type { JWT } from "@auth/core/jwt";
import type {
  Session as CoreSession,
  User as CoreUser,
  Account as CoreAccount,
} from "@auth/core/types";
import type { NextRequest } from "next/server";

/* ------------------------------------------------------------------ */
/*  Basic env-var sanity checks (fail fast)                           */
/* ------------------------------------------------------------------ */
if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error("Missing GOOGLE_CLIENT_ID environment variable");
}
if (!process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("Missing GOOGLE_CLIENT_SECRET environment variable");
}

/* ------------------------------------------------------------------ */
/*  Custom types exposed by callbacks                                 */
/* ------------------------------------------------------------------ */
interface CustomJWT extends JWT {
  accessToken?: string;
  accessTokenExpires?: number;
  refreshToken?: string;
  userId?: string;
  error?: string;
}

interface CustomSession extends CoreSession {
  accessToken?: string;
  error?: string;
  user: {
    id: string;
  } & CoreUser;
}

/* ------------------------------------------------------------------ */
/*  NextAuth configuration                                            */
/* ------------------------------------------------------------------ */
const { handlers, auth } = NextAuth({
  adapter: PrismaAdapter(prisma) as Adapter,

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar",
        },
      },
    }) as Provider,
  ],

  session: { strategy: "jwt" },

  callbacks: {
    /* ----------------------  middleware / route auth -------------- */
    async authorized({
      auth,
    }: {
      auth: CustomSession | null;
      request: NextRequest;
    }): Promise<boolean> {
      return !!auth?.user;
    },

    /* ----------------------  JWT lifecycle ------------------------ */
    async jwt({
      token,
      user,
      account,
    }: {
      token: JWT;
      user?: CoreUser | AdapterUser;
      account?: CoreAccount | null;
    }): Promise<CustomJWT> {
      let current = token as CustomJWT;

      /* 1️⃣  First-time sign-in ------------------------------------ */
      if (account && user) {
        current = {
          ...current,
          accessToken: account.access_token,
          accessTokenExpires:
            typeof account.expires_at === "number"
              ? account.expires_at * 1000
              : undefined,
          refreshToken: account.refresh_token,
          userId: user.id,
        };

        /* Store encrypted tokens in DB */
        try {
          await prisma.account.update({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
            },
            data: {
              ...(account.access_token && {
                access_token: encrypt(account.access_token),
              }),
              ...(account.refresh_token && {
                refresh_token: encrypt(account.refresh_token),
              }),
            },
          });
        } catch (err) {
          console.error("Failed to encrypt tokens:", err);
          current.error = "encryption_failed";
        }

        return current;
      }

      /* 2️⃣  Re-use cached token if still valid ------------------- */
      if (
        current.accessTokenExpires &&
        Date.now() < current.accessTokenExpires
      ) {
        return current;
      }

      /* 3️⃣  Refresh expired token -------------------------------- */
      if (!current.userId || !current.refreshToken) {
        return {
          userId: current.userId,
          error: "RefreshErrorNoUserIdOrTokenRefreshToken",
        } as CustomJWT;
      }

      try {
        const dbAccount = await prisma.account.findFirst({
          where: { userId: current.userId, provider: "google" },
        });

        if (!dbAccount?.refresh_token) {
          return {
            userId: current.userId,
            error: "RefreshErrorNoDBRefreshToken",
          } as CustomJWT;
        }

        const decryptedRefreshToken = decrypt(dbAccount.refresh_token);

        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: "refresh_token",
            refresh_token: decryptedRefreshToken,
          }),
        });

        const refreshed: {
          access_token: string;
          expires_in: number;
          refresh_token?: string;
          error?: string;
        } = await res.json();

        if (!res.ok) {
          if (refreshed.error === "invalid_grant") {
            await prisma.account.update({
              where: { id: dbAccount.id },
              data: { refresh_token: null, access_token: null, expires_at: null },
            });
            return {
              userId: current.userId,
              error: "RefreshErrorInvalidGrant",
            } as CustomJWT;
          }
          return { ...current, error: "RefreshAccessTokenError" };
        }

        /* Successful refresh */
        current = {
          ...current,
          accessToken: refreshed.access_token,
          accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
          refreshToken: refreshed.refresh_token ?? current.refreshToken,
        };

        await prisma.account.update({
          where: { id: dbAccount.id },
          data: {
            access_token: encrypt(refreshed.access_token),
            expires_at: Math.floor(current.accessTokenExpires / 1000),
            ...(refreshed.refresh_token &&
              refreshed.refresh_token !== decryptedRefreshToken && {
                refresh_token: encrypt(refreshed.refresh_token),
              }),
          },
        });

        delete current.error;
        return current;
      } catch (err) {
        console.error("Token refresh failed:", err);
        return { ...current, error: "RefreshAccessTokenErrorCatch" };
      }
    },

    /* ----------------------  Session shaping --------------------- */
    async session({
      session,
      token,
    }: {
      session: CoreSession;
      token: CustomJWT;
    }): Promise<CustomSession> {
      const jwt = token as CustomJWT;

      return {
        ...session,
        user: { ...(session.user ?? {}), id: jwt.userId! },
        accessToken: jwt.accessToken,
        error: jwt.error,
      };
    },
  },

  // secret is auto-detected from AUTH_SECRET; enable debug if needed
  // debug: process.env.NODE_ENV === "development",
});

/* ------------------------------------------------------------------ */
/*  Route handlers (for /api/auth/[...nextauth])                      */
/* ------------------------------------------------------------------ */
export const { GET, POST } = handlers;
export { auth }; // Useful if other routes/middleware need the Auth.js helper
