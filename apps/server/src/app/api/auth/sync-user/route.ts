import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node"; 
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  // 1. Get the Clerk session token from the Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ error: "No auth header" }, { status: 401 });
  const token = authHeader.replace("Bearer ", ""); // get the token from the header

  // 2. Verify the token and get Clerk user info
  let userId: string;
  try {
    const { userId: uid } = getAuth(req); // if using @clerk/nextjs/server
    if (!uid) throw new Error("No userId found in session");
    userId = uid;
  } catch (err: any) {
    return NextResponse.json({ error: "Unauthorized: " + err.message }, { status: 401 });
  }

  // 3. Fetch Clerk user object (for email, name, etc.)
  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(userId);
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to get Clerk user: " + err.message }, { status: 400 });
  }

  const email = clerkUser.emailAddresses[0].emailAddress;
  const name = clerkUser.firstName;

  // 4. Find or create user in your DB
  let user = await prisma.user.findUnique({ where: { clerkUserId: userId } });
  if (!user) {
    user = await prisma.user.create({
      data: { clerkUserId: userId, email, name }
    });
  }

  return NextResponse.json({ user });
}
