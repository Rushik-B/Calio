import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventSummary, ListEventsStructuredResult } from './calendarTools'; // Assuming EventSummary is exported or defined here

// --- Load prompts --- 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const P_FILTER_SUMMARIZE_PROMPT_PATH = path.resolve(__dirname, '../prompts/filterAndSummarizeEventsPrompt.md');
const FILTER_SUMMARIZE_MASTER_PROMPT = fs.readFileSync(P_FILTER_SUMMARIZE_PROMPT_PATH, 'utf-8');

const P_FORMAT_RESPONSE_PROMPT_PATH = path.resolve(__dirname, '../prompts/formatResponsePrompt.md');
const FORMAT_RESPONSE_MASTER_PROMPT = fs.readFileSync(P_FORMAT_RESPONSE_PROMPT_PATH, 'utf-8');

// --- General Conversation Prompt ---
const GENERAL_CHAT_SYSTEM_PROMPT = `You are a helpful assistant integrated into a calendar application. Your primary function is to help with calendar tasks (creating, listing, updating, deleting events).

A user has asked a question or made a statement that doesn't seem related to a specific calendar action. Respond helpfully and conversationally to the user's message below.

If the query is something you can reasonably answer or discuss, please do so naturally.
If the query is outside your capabilities or knowledge, politely state your limitations regarding non-calendar topics, perhaps reminding them of your main purpose.

Keep your response concise and friendly.`;

// --- Configure LLM instances ---
const summarizationModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest",
  temperature: 0.3,
});

const formattingModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest", // Can be the same or different
  temperature: 0.2, // Typically lower for formatting tasks to be more deterministic
});

/**
 * Takes a user's query and a list of fetched event data, then uses an LLM to 
 * filter relevant events and generate a natural language summary.
 * 
 * @param originalUserQuery The user's original chat message.
 * @param structuredEventResults An array of results from ListEventsTool, one for each calendar queried.
 * @param currentTimeISO Optional current time to provide more context to the summarization LLM.
 * @param userTimezone Optional user timezone to provide more context to the summarization LLM.
 * @returns A string containing the LLM's natural language summary.
 */
export async function getFilteredEventSummary(
  originalUserQuery: string,
  structuredEventResults: ListEventsStructuredResult[],
  currentTimeISO?: string,
  userTimezone?: string
): Promise<string> {
  console.log('[ResponseFormatter] Generating filtered summary for query:', originalUserQuery);
  console.log('[ResponseFormatter] Received structured event results:', JSON.stringify(structuredEventResults, null, 2));
  if (userTimezone) {
    console.log('[ResponseFormatter] User timezone:', userTimezone);
  }

  // Aggregate all events from all calendars and note any errors or specific messages.
  const allEvents: EventSummary[] = [];
  const calendarMessages: string[] = [];
  let hadSuccessfulFetches = false;
  let hadErrors = false;

  structuredEventResults.forEach(res => {
    if (res.events && res.events.length > 0) {
      allEvents.push(...res.events.map(e => ({ ...e, calendarId: res.calendarId }))); // Add calendarId to each event for context
      hadSuccessfulFetches = true;
    }
    if (res.message && !res.events?.length) { // Message like "No events found"
      calendarMessages.push(`For calendar '${res.calendarId}': ${res.message}`);
    }
    if (res.error) {
      calendarMessages.push(`For calendar '${res.calendarId}': Error - ${res.error}`);
      hadErrors = true;
    }
  });

  // If all fetches resulted in errors and no events were found at all.
  if (hadErrors && !hadSuccessfulFetches && allEvents.length === 0) {
    const errorSummary = calendarMessages.join('\n');
    console.log('[ResponseFormatter] All fetches failed or returned errors:', errorSummary);
    return `I encountered some issues accessing your calendars: \n${errorSummary}`;
  }
  
  // If no events were found across all calendars (but no critical errors preventing at least one fetch attempt)
  if (allEvents.length === 0 && !hadErrors) {
      // Let the main formatter handle the "no events" messages if they exist, or provide a generic one.
      const noEventsMessage = calendarMessages.length > 0 ? calendarMessages.join('\n') : "I couldn't find any events for the period I looked at.";
      console.log('[ResponseFormatter] No events found across all calendars:', noEventsMessage);
      return noEventsMessage;
  }

  // Construct the input for the summarization LLM
  const llmInputParts = [
    `User's Original Request: "${originalUserQuery}"`,    
    `Fetched Calendar Events (JSON):\n${JSON.stringify(allEvents, null, 2)}`,
  ];

  if (currentTimeISO) {
    llmInputParts.unshift(`SYSTEM NOTE: Current date and time is ${currentTimeISO} (UTC).`);
  }
  // Add userTimezone to the LLM input if available
  if (userTimezone) {
    llmInputParts.unshift(`SYSTEM NOTE: User's local timezone is ${userTimezone}. Please use this timezone when presenting dates/times to the user.`);
  }
  
  const llmInput = llmInputParts.join('\n\n---\n\n');

  try {
    const messages = [
      new SystemMessage(FILTER_SUMMARIZE_MASTER_PROMPT),
      new HumanMessage(llmInput),
    ];

    console.log('[ResponseFormatter] Sending to summarization LLM with input:', llmInput);
    const result = await summarizationModel.invoke(messages);
    const summary = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    console.log('[ResponseFormatter] LLM Summary received:', summary);
    
    // If there were partial errors and some events, append the error messages.
    // Let the final formatter handle combining these messages.
    if (hadErrors && hadSuccessfulFetches && calendarMessages.length > 0) {
        const errorReport = calendarMessages.filter(m => m.toLowerCase().includes('error')).join('\n');
        if (errorReport) {
            return `${summary}\n\nAdditionally, I had some issues: \n${errorReport}`;
        }
    }
    return summary;

  } catch (err: any) {
    console.error("[ResponseFormatter] Error during LLM summarization:", err);
    return "Sorry, I found some events but had trouble summarizing them. You can see the raw data above if it was logged."; // Fallback
  }
} 


/**
 * Takes a raw response string (which might be from summarization, tool execution, or error messages)
 * and uses an LLM to format it into a clean, user-friendly, markdown-compatible message.
 *
 * @param rawResponse The raw string output that needs formatting.
 * @returns A string containing the LLM's formatted response.
 */
export async function formatFinalResponse(rawResponse: string): Promise<string> {
  if (!rawResponse || rawResponse.trim() === "") {
    console.log('[ResponseFormatter] Raw response is empty, returning as is.');
    return rawResponse;
  }
  console.log('[ResponseFormatter] Formatting raw response:', rawResponse);

  const systemPrompt = FORMAT_RESPONSE_MASTER_PROMPT;
  const humanMessageContent = systemPrompt.replace('{raw_input}', rawResponse); // Assuming prompt has {raw_input} placeholder

  try {
    const messages = [
      // The new prompt is self-contained with instructions, so we might not need a separate system message here
      // if the prompt itself acts as the primary instruction set.
      // However, Langchain's `ChatGoogleGenerativeAI` typically expects a `SystemMessage` then `HumanMessage`
      // Let's ensure the prompt file is structured to be the *content* of a SystemMessage.
      // The prompt content is: "You are a helpful AI assistant... Now, please format the following raw input: {raw_input}"
      // So we should use the prompt content as the system message and `rawResponse` as the human message.
      // Let's adjust the prompt structure slightly if it's meant to be a template.
      // For now, let's assume the prompt itself is the main instruction and we just provide the raw input.

      // Re-evaluating: The prompt has "{raw_input}" at the end. It should be the system message,
      // and the human message is the actual raw text to be formatted.
      new SystemMessage(FORMAT_RESPONSE_MASTER_PROMPT.replace('{raw_input}', '')), // Remove placeholder for system message
      new HumanMessage(rawResponse),
    ];
    
    // Or, if the prompt is designed to be the *full* input with a placeholder:
    // const fullPrompt = FORMAT_RESPONSE_MASTER_PROMPT.replace('{raw_input}', rawResponse);
    // const messages = [new HumanMessage(fullPrompt)]; // This might be simpler if the model handles it well.
    // Let's stick to System + Human for now for clarity.

    console.log('[ResponseFormatter] Sending to formatting LLM.');
    // console.log('System Prompt for Formatter:\n', FORMAT_RESPONSE_MASTER_PROMPT.replace('{raw_input}', ''));
    // console.log('Human Message for Formatter:\n', rawResponse);

    const result = await formattingModel.invoke(messages);
    const formattedContent = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    
    console.log('[ResponseFormatter] LLM Formatted response received:', formattedContent);
    return formattedContent;

  } catch (err: any) {
    console.error("[ResponseFormatter] Error during LLM final formatting:", err);
    // Fallback to raw response if formatting fails, to not lose the information
    return `Sorry, I had a bit of trouble tidying up the response. Here it is directly: \n\n${rawResponse}`; 
  }
} 

/**
 * Handles general non-calendar related user queries using an LLM.
 *
 * @param userMessage The user's original chat message.
 * @returns A string containing the LLM's conversational response.
 */
export async function getGeneralChatResponse(userMessage: string): Promise<string> {
  console.log('[ResponseFormatter] Handling general query:', userMessage);

  try {
    const messages = [
      new SystemMessage(GENERAL_CHAT_SYSTEM_PROMPT),
      new HumanMessage(userMessage),
    ];

    // We can reuse one of the existing models, e.g., formattingModel, 
    // as gemini-1.5-flash is good for general tasks too.
    console.log('[ResponseFormatter] Sending general query to LLM.');
    const result = await formattingModel.invoke(messages);
    const generalResponse = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    
    console.log('[ResponseFormatter] LLM General response received:', generalResponse);
    return generalResponse;

  } catch (err: any) {
    console.error("[ResponseFormatter] Error during LLM general response generation:", err);
    // Fallback response if the general LLM fails
    return "I encountered an issue trying to process that request. My main function is to help with calendar tasks."; 
  }
} 