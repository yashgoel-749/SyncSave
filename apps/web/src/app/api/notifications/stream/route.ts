import { auth } from "@/auth";
import { subscribeToUserNotifications } from "@/lib/notification-service";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(`event: connected\ndata: "connected"\n\n`));

      unsubscribe = subscribeToUserNotifications(userId, (notification) => {
        try {
          const payload = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream might be closed
        }
      });

      // Keepalive ping every 25 seconds to prevent intermediate proxy timeouts
      const keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(keepaliveInterval);
        }
      }, 25000);

      request.signal.addEventListener("abort", () => {
        clearInterval(keepaliveInterval);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          // Ignore close errors
        }
      });
    },
    cancel() {
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
