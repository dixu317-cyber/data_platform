export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 11 }}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
        <rect x="1.5" y="1.5" width="37" height="37" rx="11" stroke="var(--accent)" strokeWidth="1.6" opacity="0.5" />
        <circle cx="20" cy="20" r="4.4" fill="var(--accent)" />
        <circle cx="11" cy="11.5" r="2.5" fill="var(--accent)" opacity="0.85" />
        <circle cx="29" cy="11.5" r="2.5" fill="var(--accent)" opacity="0.85" />
        <circle cx="11" cy="28.5" r="2.5" fill="var(--accent)" opacity="0.85" />
        <circle cx="29" cy="28.5" r="2.5" fill="var(--accent)" opacity="0.85" />
        <path d="M20 20L11 11.5M20 20l9-8.5M20 20l-9 8.5M20 20l9 8.5" stroke="var(--accent)" strokeWidth="1.3" opacity="0.55" />
      </svg>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: 17,
          letterSpacing: "-0.01em",
          color: "var(--text)",
          whiteSpace: "nowrap"
        }}
      >
        CoworkExpress 平台
      </span>
    </span>
  );
}
