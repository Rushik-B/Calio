'use client'; // This page now needs client-side interactivity

import { useSession, signIn, signOut } from 'next-auth/react';
import Image from "next/image";
import { useState } from 'react';

export default function Home() {
  const { data: session, status } = useSession();
  const [apiResponse, setApiResponse] = useState<string | null>(null);
  const [isApiLoading, setIsApiLoading] = useState(false);

  const isLoading = status === 'loading';

  const handleCreateEvent = async () => {
    setApiResponse(null);
    setIsApiLoading(true);
    try {
      const response = await fetch('/api/calendar/hello', {
        method: 'POST',
      });
      const data = await response.json();
      if (response.ok) {
        setApiResponse(`Event created! Link: ${data.event?.htmlLink || 'N/A'}`);
      } else {
        setApiResponse(`Error: ${data.error || 'Failed to create event'}`);
      }
    } catch (error) {
      console.error("Failed to call API:", error);
      setApiResponse('Error calling API. Check console.');
    } finally {
      setIsApiLoading(false);
    }
  };

  return (
    <div className="grid grid-rows-[auto_auto_1fr_auto] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <header className="row-start-1 self-start justify-self-end">
        {/* Login/Logout Buttons */}
        {isLoading ? (
          <p>Loading session...</p>
        ) : session ? (
          <div className="flex items-center gap-4">
            <p>
              Signed in as {session.user?.email} (ID: {session.user?.id})
            </p>
            <button
              onClick={() => signOut()}
              className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn('google')}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Sign in with Google
          </button>
        )}
      </header>

      {/* Test Button Area */}
      <div className="row-start-2 justify-self-center mt-4">
        {session && (
          <button
            onClick={handleCreateEvent}
            disabled={isApiLoading}
            className="bg-green-500 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded"
          >
            {isApiLoading ? 'Creating Event...' : 'Create Hello World Event'}
          </button>
        )}
        {/* Display API Response */}
        {apiResponse && (
          <p className="mt-2 text-sm text-center">{apiResponse}</p>
        )}
      </div>

      <main className="flex flex-col gap-8 row-start-3 items-center sm:items-start">
        <Image
          className="dark:invert"
          src="https://nextjs.org/icons/next.svg"
          alt="Next.js logo"
          width={180}
          height={38}
          priority
        />
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">
            Get started by editing{" "}
            <code className="bg-black/[.05] dark:bg-white/[.06] px-1 py-0.5 rounded font-semibold">
              src/app/page.tsx
            </code>
            .
          </li>
          <li>Save and see your changes instantly.</li>
        </ol>

        {/* Display Access Token if logged in (for testing) */}
        {session && session.accessToken && (
            <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded break-all">
                <h3 className="font-bold mb-2">Access Token (for testing):</h3>
                <pre className="text-xs">{session.accessToken}</pre>
            </div>
        )}

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <a
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert"
              src="https://nextjs.org/icons/vercel.svg"
              alt="Vercel logomark"
              width={20}
              height={20}
            />
            Deploy now
          </a>
          <a
            className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:min-w-44"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read our docs
          </a>
        </div>
      </main>
      <footer className="row-start-4 flex gap-6 flex-wrap items-center justify-center">
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="https://nextjs.org/icons/file.svg"
            alt="File icon"
            width={16}
            height={16}
          />
          Learn
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="https://nextjs.org/icons/window.svg"
            alt="Window icon"
            width={16}
            height={16}
          />
          Examples
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://nextjs.org?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="https://nextjs.org/icons/globe.svg"
            alt="Globe icon"
            width={16}
            height={16}
          />
          Go to nextjs.org →
        </a>
      </footer>
    </div>
  );
}
