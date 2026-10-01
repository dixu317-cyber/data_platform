"use client";

import { useEffect } from "react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  danger?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  danger = false,
  confirmText = "确认",
  cancelText = "取消",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmBg = danger ? "#dc2626" : "#b5722a";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          padding: "24px",
          borderRadius: "12px",
          maxWidth: "420px",
          width: "calc(100% - 32px)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1f2937" }}>{title}</h3>
        {description ? (
          <p style={{ margin: "12px 0 20px", fontSize: "14px", lineHeight: 1.6, color: "#4b5563" }}>{description}</p>
        ) : (
          <div style={{ height: 16 }} />
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: "8px 16px", fontSize: "14px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer" }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{ padding: "8px 16px", fontSize: "14px", borderRadius: "8px", border: "none", background: confirmBg, color: "#fff", cursor: "pointer" }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
