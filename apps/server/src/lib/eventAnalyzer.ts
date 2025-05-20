import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Basic environment setup, assuming .env.development is two levels up from 'lib' (e.g., project_root/.env.development)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env.development") });

// Initialize the Google Generative AI model for chat analysis
// Ensure GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is in your .env.development
const analysisModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest", // Or your preferred model for analysis
  temperature: 0.3, // Lower temperature for more factual, less creative analysis
});

const ANALYSIS_SYSTEM_PROMPT = `
You are an AI assistant specialized in analyzing lists of calendar events to answer user questions.
Based *only* on the calendar events provided in the user's message, answer their question.
- Calculate durations, count events, or summarize information as relevant to the question.
- If the events provided do not contain enough information to definitively answer the question, state that clearly.
- Do not ask for clarification on date ranges or event details if the information is not present in the provided events; instead, indicate what information is missing based on the events at hand.
- When referring to event times in your answer, present them in a natural way (e.g., "at 2:30 PM"). If you need to specify the timezone, use the provided user's timezone name (e.g., "America/Vancouver") rather than just the offset.
- Present your answer clearly and concisely.
`;

/**
 * Analyzes a list of calendar events to answer a specific user question.
 *
 * @param userQuestion The user's question about the events.
 * @param eventDataString A string containing the list of events, formatted for the LLM.
 * @param userTimezone The IANA timezone name of the user (e.g., "America/Vancouver").
 * @returns A promise that resolves to the LLM's analytical response string.
 */
export async function handleEventAnalysis(
  userQuestion: string,
  eventDataString: string,
  userTimezone: string
): Promise<string> {
  console.log(`[EventAnalyzer] Received question: "${userQuestion}" for timezone: ${userTimezone}`);
  // console.log(`[EventAnalyzer] Event data string: "${eventDataString}"`); // Log if needed for debugging, can be verbose

  const systemMessage = new SystemMessage(ANALYSIS_SYSTEM_PROMPT.replace("{userTimezoneName}", userTimezone));

  const constructedUserMessage = `User's Question: ${userQuestion}\n(Assume all event times are relevant to the user timezone: ${userTimezone})\n\nProvided Events:\n${eventDataString}`;

  const messages: BaseMessage[] = [
    systemMessage,
    new HumanMessage(constructedUserMessage),
  ];

  try {
    const result = await analysisModel.invoke(messages);
    let responseContent: string;

    if (typeof result.content === "string") {
      responseContent = result.content;
    } else if (Array.isArray(result.content)) {
      responseContent = result.content
        .map(part => (part.type === "text" ? part.text : ""))
        .filter(text => text)
        .join("\n");
    } else {
      responseContent = "I was unable to analyze the events based on the provided information.";
      console.warn("[EventAnalyzer] LLM response content was not in expected string format:", result.content);
    }
    
    console.log(`[EventAnalyzer] LLM Analysis Response: "${responseContent}"`);
    return responseContent;
  } catch (error) {
    console.error("[EventAnalyzer] Error calling LLM for event analysis:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred during event analysis.";
    return `Sorry, I encountered an error while analyzing the calendar events: ${errorMessage}`;
  }
} 