import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env.development") });

// Initialize the Google Generative AI model for chat
// Ensure GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is in your .env.development
const chatModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest", // Using flash for speed, can be changed
  temperature: 0.7, // Standard temperature for creative/chat tasks
});

const APP_CONTEXT = `
You are a helpful AI assistant integrated into an application that primarily helps users manage their Google Calendar.
Your capabilities include assisting with creating, listing, updating, and deleting calendar events.

If the user's query seems related to calendar management (e.g., scheduling, asking about events), try to understand their intent and guide them if their request is unclear for direct calendar actions. You can ask clarifying questions to help them formulate a request that the calendar tools can understand.

If the planner component (another AI) couldn't categorize the user's request and has forwarded it to you, it means the query was not a clear calendar command. In such cases, or if the user initiates a general conversation, engage in a friendly and helpful manner. You can:
- Politely explain the primary functions of the application (calendar management) if their query seems completely unrelated but they might be looking for help.
- Offer to chat generally if they are not looking for calendar assistance.
- If their query is vague but might relate to calendar actions, try to clarify what they want to do with their calendar.

Essentially, be the helpful conversational layer, especially when direct actions aren't clear.
`;

/**
 * Handles general chat interactions with the user.
 *
 * @param userMessage The current message from the user.
 * @returns A promise that resolves to the LLM's response string.
 */
export async function handleGeneralChat(
  userMessage: string
): Promise<string> {
  console.log(`[GeneralChatHandler] Received message: \"${userMessage}\"`);

  const messages: BaseMessage[] = [new SystemMessage(APP_CONTEXT)];

  // Add the current user message
  messages.push(new HumanMessage(userMessage));

  try {
    const result = await chatModel.invoke(messages);
    let responseContent: string;

    if (typeof result.content === "string") {
      responseContent = result.content;
    } else if (Array.isArray(result.content)) {
      // Handle cases where content might be an array of content blocks
      responseContent = result.content
        .map(part => {
          if (part.type === "text") {
            return part.text;
          }
          return ""; // Or handle other parts like images if necessary in the future
        })
        .filter(text => text) // Remove empty strings from non-text parts
        .join("\n");
    } else {
        responseContent = "I'm not sure how to respond to that.";
        console.warn("[GeneralChatHandler] LLM response content was not in expected string format:", result.content);
    }
    
    console.log(`[GeneralChatHandler] LLM Response: "${responseContent}"`);
    return responseContent;
  } catch (error) {
    console.error("[GeneralChatHandler] Error calling LLM:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
    return `Sorry, I encountered an error: ${errorMessage}`;
  }
}

// Example usage (for testing purposes, can be removed or commented out)
/*
async function testGeneralChat() {
  if (!process.env.GOOGLE_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("ERROR: Set GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY in your env for testing.");
    return;
  }
  console.log("--- Testing General Chat ---");
  
  const response1 = await handleGeneralChat("Hello there!");
  console.log("User: Hello there!");
  console.log("AI  :", response1);

  const response2 = await handleGeneralChat("Can you tell me a fun fact about space?");
  console.log("\nUser: Can you tell me a fun fact about space?");
  console.log("AI  :", response2);
  
  const response3 = await handleGeneralChat("What about my meeting tomorrow?");
  console.log("\nUser: What about my meeting tomorrow?");
  console.log("AI  :", response3);
}

// To run this test:
// 1. Ensure .env.development has GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY
// 2. Uncomment the line below
// 3. Run: pnpm exec ts-node src/lib/generalChatHandler.ts
// testGeneralChat();
*/ 