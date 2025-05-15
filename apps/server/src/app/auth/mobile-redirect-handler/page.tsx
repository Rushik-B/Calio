// app/auth/mobile-redirect-handler/page.tsx on your Next.js server
"use client"; // This must be a client component for useEffect and window.location

import { useEffect } from 'react';
// You can import APP_SCHEME from a shared config or hardcode it if it's static.
// If importing from '@/config', ensure that config file is suitable for client-side bundling
// or simply hardcode the scheme here.
// const APP_SCHEME = "calio"; // Easiest for this simple handler

// It's better to get it from environment variables if possible,
// passed through Next.js build process for client components
const appScheme = process.env.NEXT_PUBLIC_MOBILE_APP_SCHEME || "calio";


export default function MobileRedirectHandlerPage() {
  useEffect(() => {
    // This page is loaded in the WebBrowser *after* Google sign-in is successful
    // and NextAuth has established its session (cookies are set for your backend domain).
    // Now, we redirect to the mobile app's custom scheme.
    const redirectTo = `${appScheme}://auth/callback`;
    console.log(`MobileRedirectHandlerPage: Redirecting to ${redirectTo}`);
    window.location.href = redirectTo;
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', textAlign: 'center' }}>
      <h1>Authentication Successful</h1>
      <p>Please wait while we redirect you back to the Calio app...</p>
      <p>If you are not redirected automatically, please close this window and return to the app.</p>
      {/* Provide a manual link as a fallback, though it might not always work from a web browser to a custom scheme */}
      <p><a href={`${appScheme}://auth/callback`}>Return to app</a></p>
    </div>
  );
}