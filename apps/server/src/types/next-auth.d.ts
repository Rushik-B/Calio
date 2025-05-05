import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    accessToken?: string;
    refreshToken?: string; // Consider security implications before exposing
    error?: string;
    provider?: string;
    user: {
      id: string;
      // Add other user properties if needed
    } & DefaultSession["user"]; // Keep the default properties like name, email, image
  }

  // Optional: Extend the User model if you add custom fields via the adapter
  // interface User extends DefaultUser {
  //   // Example: role: string;
  // }
}

declare module "next-auth/jwt" {
  /** Returned by the `jwt` callback and present in the received token object */
  interface JWT extends DefaultJWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    userId?: string;
    provider?: string;
    error?: string;
  }
} 