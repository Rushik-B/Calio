// This file is used to log a message to Errly.
// It is a client component that is used to log a message to Errly.
// Built it just to test errly thats it.

'use client'; // <-- Mark this as a Client Component

import React from 'react';

export function ErrlyLogButton() {

  const handleSendLog = () => {
    console.log("Sending log to Errly..."); // Normal console log for debugging
    try {
      // Send an 'info' level log to Errly
      // @ts-ignore - Errly patches console.text at runtime
      console.text( // This uses the patched console
        'info', // Set the level to 'info'
        'User clicked the Errly log button!', // Message
        { page: '/', component: 'ErrlyLogButton' } // Optional metadata
      );
      console.log("Log supposedly sent."); // Confirm attempt
    } catch (error) {
        // Fallback if console.text somehow fails (e.g., SDK didn't init)
        console.error("Failed to send Errly log via console.text:", error);
    }
  };

  return (
    <button
      type="button" // Use type="button" if it's not submitting a form
      onClick={handleSendLog}
      style={{ marginLeft: '10px', padding: '5px 10px', cursor: 'pointer' }}
    >
      Send Log to Errly
    </button>
  );
} 