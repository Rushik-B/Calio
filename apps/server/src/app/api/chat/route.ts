"use server";

import { NextResponse } from 'next/server';
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { generatePlan, CalendarAction } from '@/lib/planner'; // Assuming planner exports these
import {
    CreateEventTool,
    ListEventsTool,
    UpdateEventTool,
    DeleteEventTool,
    createEventParamsSchema,
    listEventsParamsSchema,
    updateEventParamsSchema,
    deleteEventParamsSchema,
    ListEventsStructuredResult
} from '@/lib/calendarTools';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getFilteredEventSummary, formatFinalResponse, getGeneralChatResponse } from "@/lib/responseFormatter"; // Import the new summarizer

// Reusable User type (or import if defined elsewhere)
interface UserForToken {
    id: string;
    name?: string | null;
    email?: string | null;
}

// Simplified version of getAuthenticatedUserAndToken from calendar-actions
// Returns only the necessary parts or throws error
async function getAuthDetails(): Promise<{ userId: string; accessToken: string }> {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error("Not authenticated.");
    }
    const userId = session.user.id;

    try {
        const account = await prisma.account.findFirst({
            where: {
                userId: userId,
                provider: "google",
            },
        });

        if (!account?.access_token) {
            throw new Error("Google account not found or access token missing.");
        }

        // Using raw token as decided previously (no decryption)
        console.log("[API Chat] Using access_token directly from DB.");
        const rawAccessToken = account.access_token;
        return { userId, accessToken: rawAccessToken };

    } catch (e: any) {
        console.error("Error fetching account or token:", e);
        throw new Error(`Failed to retrieve access token: ${e.message}`);
    }
}

// Tool Mapping
const toolMap: Record<string, {
    toolClass: new (userId: string, accessToken: string) => StructuredTool;
    schema: z.ZodSchema<any>;
}> = {
    'create_event': { toolClass: CreateEventTool, schema: createEventParamsSchema },
    'list_events': { toolClass: ListEventsTool, schema: listEventsParamsSchema },
    'update_event': { toolClass: UpdateEventTool, schema: updateEventParamsSchema },
    'delete_event': { toolClass: DeleteEventTool, schema: deleteEventParamsSchema },
};

export async function POST(request: Request) {
    try {
        // Extract userTimezone along with message and selectedCalendarIds
        const { message, selectedCalendarIds, userTimezone } = await request.json(); 
        
        // Validate timezone or set a default (optional, but good practice)
        let effectiveUserTimezone = 'UTC'; // Default if not provided or invalid
        if (userTimezone && typeof userTimezone === 'string') {
            try {
                // Basic validation: Check if Intl recognizes the timezone
                Intl.DateTimeFormat(undefined, { timeZone: userTimezone });
                effectiveUserTimezone = userTimezone;
            } catch (e) {
                console.warn(`[API Chat] Invalid userTimezone received: ${userTimezone}. Falling back to UTC.`);
            }
        }
        console.log(`[API Chat] Using effective timezone: ${effectiveUserTimezone}`);

        const targetCalendarIds = Array.isArray(selectedCalendarIds) && selectedCalendarIds.length > 0 
                                  ? selectedCalendarIds 
                                  : ['primary']; 
        const { userId, accessToken } = await getAuthDetails();
        const currentTimeISO = new Date().toISOString();
        
        // Generate plan
        const plan: CalendarAction | null = await generatePlan(message, currentTimeISO);
        
        let rawReply = ''; 
        let useGeneralResponse = false;

        // --- Determine if we should use general response logic ---
        if (!plan || !plan.action || (plan.action !== 'unknown' && !toolMap[plan.action])) { // Simplified check: plan exists, action exists, but it's not 'unknown' AND not in toolMap (shouldn't happen ideally) OR no plan/action at all.
             if (plan && plan.action === 'unknown') {
                 console.log('[API Chat] Planner returned unknown action. Falling back to general response.');
             } else {
                 console.log('[API Chat] Planner failed or returned invalid/unhandled action. Falling back to general response. Plan:', plan);
             }
             useGeneralResponse = true;
             rawReply = await getGeneralChatResponse(message);
        } else if (plan.action === 'unknown') { 
            // Explicitly handle 'unknown' if planner returns it and we didn't catch it above
            console.log('[API Chat] Planner explicitly returned unknown action. Falling back to general response.');
            useGeneralResponse = true;
            rawReply = await getGeneralChatResponse(message);
        } else {
            // --- Calendar Action Logic --- 
            const toolDetails = toolMap[plan.action];
            console.log(`[API Chat] Plan generated: Action=${plan.action}, TargetCalendars: ${targetCalendarIds.join(", ")}`);
            
            if (plan.action === 'list_events') {
                const structuredToolResults: ListEventsStructuredResult[] = [];
                for (const calendarId of targetCalendarIds) {
                    const paramsForValidation = {
                        ...(plan.params || {}),
                        calendarId: calendarId,
                    };
                    const validatedParams = toolDetails.schema.safeParse(paramsForValidation);
                    if (!validatedParams.success) {
                        console.warn(`[API Chat] Param validation failed for list_events on calendar ${calendarId}: ${validatedParams.error.format()}`);
                        structuredToolResults.push({ calendarId, events: [], error: `Action on calendar '${calendarId}' skipped due to invalid details.` });
                        continue;
                    }
                     try {
                        const toolInstance = new toolDetails.toolClass(userId, accessToken);
                        const singleResult = await (toolInstance as ListEventsTool).call(validatedParams.data);
                        structuredToolResults.push(singleResult);
                     } catch (toolError: any) {
                        console.error(`[API Chat] Tool execution failed for list_events on calendar ${calendarId}:`, toolError);
                        structuredToolResults.push({ calendarId, events: [], error: `Action on calendar '${calendarId}' failed: ${toolError.message}` });
                     }
                }
                
                rawReply = await getFilteredEventSummary(message, structuredToolResults, currentTimeISO, effectiveUserTimezone);
            } else if (plan.action === 'create_event') { 
                const results: string[] = [];
                for (const calendarId of targetCalendarIds) {
                    const paramsForValidation = {
                        ...(plan.params || {}),
                        calendarId: calendarId,
                    };
                    const validatedParams = toolDetails.schema.safeParse(paramsForValidation);
                    if (!validatedParams.success) {
                        console.warn(`[API Chat] Param validation failed for ${plan.action} on calendar ${calendarId}: ${validatedParams.error.format()}`);
                        results.push(`Action on calendar '${calendarId}' skipped due to invalid details.`);
                        continue; 
                    }
                     try {
                        const toolInstance = new toolDetails.toolClass(userId, accessToken);
                        const singleResult = await toolInstance.call(validatedParams.data);
                        results.push(singleResult); 
                     } catch (toolError: any) {
                        console.error(`[API Chat] Tool execution failed for ${plan.action} on calendar ${calendarId}:`, toolError);
                        results.push(`Action on calendar '${calendarId}' failed: ${toolError.message}`);
                     }
                }
                rawReply = results.join('\n---\n');
            } else if (plan.action === 'update_event' || plan.action === 'delete_event') {
                // Handle single calendar requirement immediately
                if (targetCalendarIds.length !== 1) {
                    rawReply = `Action '${plan.action}' requires exactly one calendar to be selected. Please select only one.`;
                    // Format this specific error and return early
                    const finalReply = await formatFinalResponse(rawReply);
                    return NextResponse.json({ reply: finalReply }, { status: 400 }); 
                } 
                
                // Proceed if exactly one calendar is selected
                const calendarId = targetCalendarIds[0];
                const paramsForValidation = {
                    ...(plan.params || {}),
                    calendarId: calendarId, // Inject the single selected calendarId
                };
                const validatedParams = toolDetails.schema.safeParse(paramsForValidation);

                if (!validatedParams.success) {
                     console.error(`[API Chat] Parameter validation failed for action ${plan.action}:`, validatedParams.error.format());
                     rawReply = `There was an issue with the details provided for the action '${plan.action}'. Reason: ${validatedParams.error.issues.map(i => i.message).join(', ')}`;
                } else {
                     console.log(`[API Chat] Validated Params for ${plan.action}:`, validatedParams.data);
                     try {
                        const toolInstance = new toolDetails.toolClass(userId, accessToken);
                        rawReply = await toolInstance.call(validatedParams.data);
                        console.log(`[API Chat] Tool Result for ${plan.action}: ${rawReply}`);
                     } catch (toolError: any) {
                        console.error(`[API Chat] Tool execution failed for ${plan.action} on calendar ${calendarId}:`, toolError);
                        rawReply = `Action on calendar '${calendarId}' failed: ${toolError.message}`;
                        // We will let the central formatter handle this tool execution error message
                     }
                }              
            } 
        }

        // --- Centralized Formatting and Response --- 
        console.log(`[API Chat] Raw reply before final formatting:`, rawReply);
        const finalReply = await formatFinalResponse(rawReply);
        console.log(`[API Chat] Final formatted reply:`, finalReply);
        return NextResponse.json({ reply: finalReply }, { status: 200 });

    } catch (error: any) {
        console.error('[API Chat] Unhandled error:', error);
        let errorMessage = error.message || 'An unexpected error occurred.';
        if (errorMessage.includes("Not authenticated") || errorMessage.includes("access token missing")){
             const finalReply = await formatFinalResponse(errorMessage);
             return NextResponse.json({ error: finalReply }, { status: 401 }); // error key for client to check?
        }
        const finalReply = await formatFinalResponse(errorMessage);
        return NextResponse.json({ error: `An error occurred: ${finalReply}` }, { status: 500 }); // error key for client
    }
} 