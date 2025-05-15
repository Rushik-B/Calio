// src/app/api/auth/[...nextauth]/route.ts
export const runtime = "nodejs";

import { handlers } from "@/auth"; // Import from your new src/auth.ts

export const { GET, POST } = handlers;

// If you also want to export auth, signIn, signOut from this file (less common for just the route file):
// export const { handlers: { GET, POST }, auth, signIn, signOut } = NextAuth(authOptions);
