-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "actor" "ActorType" NOT NULL,
    "messageText" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "llmPrompt" TEXT,
    "llmResponseRaw" TEXT,
    "toolCalled" TEXT,
    "toolParams" JSONB,
    "toolResult" JSONB,
    "clarificationContext" JSONB,
    "requiresFollowUp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationTurn_conversationId_idx" ON "ConversationTurn"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationTurn_userId_conversationId_turnNumber_idx" ON "ConversationTurn"("userId", "conversationId", "turnNumber");

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
