import prisma from "@/lib/prisma";
import type { NotificationType } from "@syncspace/db";
import { EventEmitter } from "events";

// Global event bus for SSE real-time notifications
const globalForNotifications = globalThis as unknown as {
  notificationEmitter?: EventEmitter;
};

const notificationEmitter =
  globalForNotifications.notificationEmitter ?? new EventEmitter();
notificationEmitter.setMaxListeners(100);

if (process.env.NODE_ENV !== "production") {
  globalForNotifications.notificationEmitter = notificationEmitter;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
}

/**
 * Creates a database-backed notification and emits it to real-time subscribers.
 * Note: Never includes raw document content in notifications to avoid content leaks.
 */
export async function createNotification(input: CreateNotificationInput) {
  // Sanitize data: ensure no sensitive content fields leaked
  const sanitizedData = input.data ? { ...input.data } : null;
  if (sanitizedData) {
    delete sanitizedData.content;
    delete sanitizedData.yjsState;
  }

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title.trim(),
      message: input.message.trim(),
      data: sanitizedData ? JSON.parse(JSON.stringify(sanitizedData)) : undefined,
    },
  });

  // Real-time broadcast to connected user SSE streams
  notificationEmitter.emit(`notification:${input.userId}`, notification);

  return notification;
}

/**
 * Retrieves notifications for a user, sorted newest first.
 */
export async function getUserNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {}
) {
  const { limit = 20, unreadOnly = false } = options;

  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    },
    take: Math.min(Math.max(limit, 1), 100),
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Returns count of unread notifications for quick badge rendering.
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  });
}

/**
 * Marks a specific notification as read.
 */
export async function markNotificationAsRead(notificationId: string, userId: string) {
  return prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId,
    },
    data: {
      isRead: true,
    },
  });
}

/**
 * Marks all notifications as read for a user.
 */
export async function markAllNotificationsAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });
}

/**
 * Subscribes a listener to real-time notifications for a user.
 */
export function subscribeToUserNotifications(
  userId: string,
  listener: (notification: unknown) => void
) {
  const channel = `notification:${userId}`;
  notificationEmitter.on(channel, listener);
  return () => {
    notificationEmitter.off(channel, listener);
  };
}
