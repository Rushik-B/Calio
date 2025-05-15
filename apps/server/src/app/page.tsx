// src/app/page.tsx

import { auth, signIn, signOut } from "@/auth"
import { ErrlyLogButton } from "@/components/errly-log-button"

export default async function HomePage() {
  const session = await auth();

  console.log("Session on server:", session);

  return (
    <div>
      <form
        action={async () => {
          "use server"
          await signIn("google")
        }}
      >
        <button type="submit">Signin with Google</button>
        <ErrlyLogButton />
      </form>

      {session && (
        <div>
          <hr />
          <p>Logged in as: {session.user?.name} ({session.user?.email})</p>
        </div>
      )}
    </div>
  )
} 