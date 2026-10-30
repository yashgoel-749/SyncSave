"use client";

import React, { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible title id — pass the id of the heading rendered inside. */
  labelledBy?: string;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

/**
 * Accessible modal: closes on Escape and backdrop click, traps initial focus,
 * locks body scroll, and animates in using the design-system enter keyframes.
 */
export function Modal({ open, onClose, labelledBy, children, size = "md", className = "" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first focusable element (or the panel itself) for keyboard users.
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([data-modal-close]), [href], [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? panel)?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`card w-full ${SIZE_CLASS[size]} bg-surface-1 border border-border-normal shadow-2xl rounded-2xl outline-none animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual intent of the confirm button. */
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Replacement for window.confirm() that matches the product's visual language.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-dialog-title" size="sm">
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
              tone === "danger" ? "bg-red-500/10 text-red-400" : "bg-brand-500/10 text-brand-400"
            }`}
          >
            {tone === "danger" ? (
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <h3 id="confirm-dialog-title" className="text-sm font-bold text-text-primary">
              {title}
            </h3>
            {description && (
              <div className="mt-1 text-xs text-text-secondary leading-relaxed">{description}</div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            data-modal-close
            className="btn btn-ghost text-xs px-3 py-1.5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={loading}
            className={`btn text-xs px-4 py-1.5 ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
          >
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Working…
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
