'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function MobileRedirectContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const redirectTo = searchParams.get('redirectTo');
    if (redirectTo && redirectTo.startsWith('exp://')) {
      console.log(`Attempting to redirect to app: ${redirectTo}`);
      // Perform the redirect to the mobile app
      window.location.replace(redirectTo);
    } else {
      console.warn('No valid redirectTo parameter found for mobile app. Redirecting to home.');
      // Fallback redirect if no valid app scheme URL is provided
      window.location.replace('/');
    }
  }, [searchParams]);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h1>Redirecting to app...</h1>
      <p>Please wait while we redirect you back to the application.</p>
      <p>
        If you are not redirected automatically, please ensure you have the app installed
        and then try opening this link in your mobile browser: <br />
        {searchParams.get('redirectTo') ? (
          <a href={searchParams.get('redirectTo')!}>{searchParams.get('redirectTo')}</a>
        ) : (
          <span>No redirect link provided.</span>
        )}
      </p>
    </div>
  );
}

export default function MobileRedirectLandingPage() {
  return (
    <Suspense fallback={<div style={{ padding: '20px', fontFamily: 'sans-serif', textAlign: 'center' }}>Loading redirect information...</div>}>
      <MobileRedirectContent />
    </Suspense>
  );
} 