// This file is used to initialize the Errly SDK.
// It is a client component that is used to initialize the Errly SDK.


'use client'; // <-- Mark this as a Client Component

import { useEffect } from 'react';
import { setKey, patch } from 'errly-sdk';

// Replace with your actual Errly Project API Key
const ERRLY_API_KEY = '20d8a72d-f012-44e3-9ba8-22fe6262b2d0';

export function ErrlyInitializer() {
  useEffect(() => {
    // Initialize only once when the component mounts on the client
    if (ERRLY_API_KEY ) {
      console.log("Initializing Errly SDK...");
      setKey(ERRLY_API_KEY);
      patch(); // Patch the console methods
      console.log("Errly SDK initialized.");
    } else {
        console.warn("Errly API Key not set. SDK not initialized.");
    }
  }, []); // Empty dependency array ensures this runs only once

  return null; // This component doesn't render anything visible
} 