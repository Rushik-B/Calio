# Project Overview: Conversational Calendar Agent

# This is a high level overview of the project that we are building, just to give you some context.

## Core Concept

This project aims to build an intelligent calendar assistant that allows users to manage their Google Calendar through a natural language conversational interface. Users will interact with a mobile application (iOS first, built with React Native/Expo) by typing commands like "Schedule a meeting with Jane next Tuesday afternoon" or "What does my Wednesday look like?".

## Architecture: Planner-Controller-Executor

The core architecture leverages a Large Language Model (LLM) like Google's gemini flash 2.0, or Open AI's GPT 4o, etc., but prioritizes safety and reliability by implementing the Planner-Controller-Executor pattern:

1.  **Planner (LLM + LangChain.js):** The LLM interprets the user's natural language request and generates a structured plan (as JSON) indicating the desired action (e.g., `create_event`, `find_free_time`) and its parameters (e.g., participants, time range).
2.  **Controller (TypeScript Logic):** A deterministic backend component (part of the Next.js server) receives this plan. It validates the plan, applies business rules and safety guardrails (e.g., preventing accidental mass deletions), checks for scheduling conflicts, enriches the plan with user preferences (e.g., default event duration), and handles user confirmation flows (potentially via push notifications) before any action is taken.
3.  **Executor (Controller calling Google API):** Only after validation (and user confirmation, if required) does the Controller make the necessary calls to the Google Calendar API using the user's authorized credentials.

## Technology Stack

*   **Mobile Frontend:** React Native + Expo (for iOS initially)
*   **Backend API Server:** Next.js 15 (TypeScript)
*   **LLM Orchestration:** LangChain.js
*   **LLM Provider:** OpenAI (GPT-4o or similar)
*   **External API:** Google Calendar API
*   **Database:** PostgreSQL (for user preferences, OAuth tokens, audit logs)
*   **Push Notifications:** Expo Push Notification Service

## Goal

To create a user-friendly, conversational agent that feels intuitive ("it just understands me") while ensuring calendar operations are safe, reliable, and respect user intent through robust validation, guardrails, and confirmation steps. The LLM acts as the intelligent interpreter, but the deterministic Controller holds the actual power to modify the calendar. 