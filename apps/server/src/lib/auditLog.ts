import { PrismaClient, Prisma } from '../generated/prisma';

const prisma = new PrismaClient();

interface AuditEventData {
  userId: string;
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
    await prisma.auditEvent.create({
      data: {
        userId: data.userId,
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