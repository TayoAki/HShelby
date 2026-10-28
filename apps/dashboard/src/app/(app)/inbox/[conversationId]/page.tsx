"use client";

import { useParams } from "next/navigation";
import { Thread } from "@/components/inbox/Thread";

export default function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  // keyed, so switching conversations starts from a clean thread
  return <Thread key={conversationId} conversationId={conversationId} />;
}
