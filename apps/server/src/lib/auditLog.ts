import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface AuditEventData {
  clerkUserId: string;
  action: string;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  requestId?: string;
  payload?: Prisma.InputJsonValue;
  error?: string;
}

/**
 * Logs an audit event to the database.
 * @param data The data for the audit event.
 */
export async function logAuditEvent(data: AuditEventData): Promise<void> {
  try {
    console.log(`[logAuditEvent] Attempting to log audit for clerkUserId: ${data.clerkUserId}, action: ${data.action}, status: ${data.status}`);

    const user = await prisma.user.findUnique({
      where: { clerkUserId: data.clerkUserId },
      select: { id: true },
    });

    if (!user) {
      console.error(`[logAuditEvent] User not found with clerkUserId: ${data.clerkUserId}. Audit event will not be logged.`);
      // Optionally, you could throw an error here if this is a critical failure condition
      // throw new Error(`User not found with clerkUserId: ${data.clerkUserId}`);
      return;
    }

    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        action: data.action,
        status: data.status,
        requestId: data.requestId,
        payload: data.payload,
        error: data.error,
      },
    });
  } catch (dbError) {
    console.error('Failed to write audit event to database:', dbError);
    // Depending on the criticality, you might want to handle this error more gracefully
    // For example, retry, or log to a fallback system (e.g., console or a file if DB is down)
    // For now, we'll just log to console to avoid interrupting the main flow.
  }
} 