"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { relativeTime } from "@/lib/utils";

export interface NotificationItem {
  id: string;
  type: "DOCUMENT_INVITATION" | "INVITATION_ACCEPTED" | "ROLE_UPDATED" | "ACCESS_REVOKED" | "WORKSPACE_EVENT";
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications & unread count
  const fetchNotifications = useCallback(async () => {
    try {
      setIsLoading(true);
      const baseUrl = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      const res = await fetch(`${baseUrl}/api/notifications?limit=25`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // silent fail during tests/offline
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const baseUrl = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";

    fetch(`${baseUrl}/api/notifications?limit=25`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data) {
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        }
      })
      .catch(() => {});

    // Setup Server-Sent Events (SSE) for real-time notification delivery
    let eventSource: EventSource | null = null;
    if (typeof window !== "undefined" && typeof EventSource !== "undefined") {
      try {
        const sseUrl = window.location?.origin || "";
        eventSource = new EventSource(`${sseUrl}/api/notifications/stream`);

        eventSource.addEventListener("notification", (event) => {
          try {
            const newNotification: NotificationItem = JSON.parse(event.data);
            setNotifications((prev) => [newNotification, ...prev]);
            setUnreadCount((prev) => prev + 1);
          } catch (e) {
            console.warn("Failed to parse incoming notification SSE:", e);
          }
        });
      } catch (e) {
        console.warn("SSE connection could not be established:", e);
      }
    }

    // Fallback polling every 45s in case SSE is blocked by proxies
    const pollInterval = setInterval(() => {
      fetchNotifications();
    }, 45000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fetchNotifications]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const markAllAsRead = async () => {
    try {
      const res = await fetch("/api/notifications", { method: "PATCH" });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.warn("Failed to mark all as read:", err);
    }
  };

  const markSingleAsRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silent fail
    }
  };

  const getNotificationIcon = (type: NotificationItem["type"]) => {
    switch (type) {
      case "DOCUMENT_INVITATION":
        return (
          <div className="w-7 h-7 rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
        );
      case "INVITATION_ACCEPTED":
        return (
          <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
      case "ROLE_UPDATED":
        return (
          <div className="w-7 h-7 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
        );
      case "ACCESS_REVOKED":
        return (
          <div className="w-7 h-7 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
        );
      default:
        return (
          <div className="w-7 h-7 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        );
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        type="button"
        id="notification-bell-button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            fetchNotifications();
          }
        }}
        aria-label="View notifications"
        className="relative p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-2/60 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span
            id="notification-unread-badge"
            className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-brand-primary text-[10px] font-bold text-white shadow-sm animate-in zoom-in-75"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications Dropdown Panel */}
      {isOpen && (
        <div
          id="notification-dropdown-menu"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-bg-card border border-border-subtle shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-bg-surface/50">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-text-primary">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-medium bg-brand-500/10 text-brand-300">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-[11px] text-brand-primary hover:text-brand-secondary transition-colors font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-border-subtle/50">
            {isLoading && notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-muted">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-muted space-y-1">
                <p className="font-medium text-text-secondary">All caught up!</p>
                <p>No new notifications at this time.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.isRead && markSingleAsRead(n.id)}
                  className={`p-3.5 flex items-start gap-3 transition-colors ${
                    n.isRead ? "bg-bg-card/40 opacity-80" : "bg-surface-1/70"
                  } hover:bg-surface-2/60 cursor-pointer`}
                >
                  {getNotificationIcon(n.type)}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-xs font-semibold text-text-primary truncate">
                        {n.title}
                      </span>
                      <span
                        suppressHydrationWarning
                        className="text-[10px] text-text-muted whitespace-nowrap"
                      >
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>

                    <p className="text-xs text-text-secondary leading-snug line-clamp-2">
                      {n.message}
                    </p>

                    {/* Action buttons if applicable */}
                    {typeof n.data?.inviteToken === "string" && !n.isRead && (
                      <div className="mt-2 flex items-center gap-2">
                        <Link
                          href={`/invite/${n.data.inviteToken}`}
                          onClick={() => {
                            markSingleAsRead(n.id);
                            setIsOpen(false);
                          }}
                          className="btn btn-primary text-[11px] py-1 px-2.5 rounded shadow-sm"
                        >
                          Accept Invitation
                        </Link>
                      </div>
                    )}

                    {typeof n.data?.documentId === "string" && !n.data?.inviteToken && (
                      <div className="mt-1.5">
                        <Link
                          href={`/documents/${n.data.documentId}`}
                          onClick={() => {
                            markSingleAsRead(n.id);
                            setIsOpen(false);
                          }}
                          className="text-[11px] font-medium text-brand-primary hover:underline inline-flex items-center gap-1"
                        >
                          Open Document →
                        </Link>
                      </div>
                    )}
                  </div>

                  {!n.isRead && (
                    <span className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0 mt-1" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
