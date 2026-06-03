import type React from "react";

function roleTone(role: string): {
  background: string;
  color: string;
  border: string;
} {
  switch (role) {
    case "SUPERADMIN":
      return { background: "#f3e8ff", color: "#6b21a8", border: "#d8b4fe" };
    case "ADMIN":
      return { background: "#dbeafe", color: "#1e40af", border: "#93c5fd" };
    case "SALES":
      return { background: "#dcfce7", color: "#166534", border: "#86efac" };
    default:
      return { background: "#f1f5f9", color: "#475569", border: "#cbd5e1" };
  }
}

export function RoleBadge({ role }: Readonly<{ role: string }>) {
  const tone = roleTone(role);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {role}
    </span>
  );
}

export function StatusBadge({ pending }: Readonly<{ pending: boolean }>) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${pending ? "#fed7aa" : "#bbf7d0"}`,
        background: pending ? "#fff7ed" : "#f0fdf4",
        color: pending ? "#9a3412" : "#166534",
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {pending ? "PENDING" : "ACTIVE"}
    </span>
  );
}

export const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 1040,
  minHeight: "100vh",
  margin: "0 auto",
  padding: "clamp(12px, 4vw, 24px)",
  color: "#0f172a",
  background: "#f8fafc",
  boxShadow: "0 0 0 100vmax #f8fafc",
  clipPath: "inset(0 -100vmax)",
  overflowX: "hidden",
};

export const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 18,
};

export const panelStyle: React.CSSProperties = {
  border: "1px solid #dbe3ef",
  borderRadius: 8,
  padding: "clamp(12px, 3vw, 16px)",
  marginBottom: 16,
  background: "#ffffff",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

export const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
};

export const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 750,
};

export const sectionMetaStyle: React.CSSProperties = {
  margin: "4px 0 0",
  color: "#475569",
  fontSize: 12,
};

export const formGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
  gap: 12,
  alignItems: "end",
};

export const fieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

export const labelStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  color: "#0f172a",
  background: "#fff",
};

export const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 38,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "1px solid #2563eb",
  borderRadius: 6,
  padding: "8px 12px",
  background: "#2563eb",
  color: "#fff",
  fontSize: 13,
  fontWeight: 750,
  cursor: "pointer",
};

export const secondaryButtonStyle: React.CSSProperties = {
  minHeight: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "6px 10px",
  background: "#fff",
  color: "#1e293b",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

export const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "5px 9px",
  background: "#fff",
  color: "#1e293b",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

export const warningStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: "1px solid #fed7aa",
  background: "#fff7ed",
  color: "#9a3412",
  borderRadius: 8,
  padding: 12,
  marginBottom: 16,
  fontSize: 13,
};

export const tableStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 720,
  borderCollapse: "collapse",
  fontSize: 13,
};

export const thStyle: React.CSSProperties = {
  borderBottom: "1px solid #dbe3ef",
  padding: "9px 10px",
  color: "#334155",
  fontSize: 12,
  fontWeight: 750,
  textAlign: "left",
  whiteSpace: "nowrap",
};

export const trStyle: React.CSSProperties = {
  borderBottom: "1px solid #eef2f7",
};

export const tdStyle: React.CSSProperties = {
  padding: "10px",
  verticalAlign: "middle",
  color: "#0f172a",
  whiteSpace: "nowrap",
};

export const mutedTextStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 14,
};
