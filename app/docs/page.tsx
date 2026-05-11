"use client";

/**
 * app/docs/page.tsx
 *
 * Swagger UI — interactive API documentation.
 * http://localhost:3000/docs
 *
 * Loads Swagger UI from CDN (no extra dependencies).
 * The spec is served from GET /api/docs/spec (api_spec.yml).
 */

import { useEffect, useRef } from "react";

declare global {
  type SwaggerUIBundleWithPresets = ((
    config: Record<string, unknown>,
  ) => void) & {
    presets?: Record<string, unknown>;
    SwaggerUIStandalonePreset?: unknown;
  };

  interface Window {
    SwaggerUIBundle: SwaggerUIBundleWithPresets;
  }
}

export default function DocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    // 1. Inject Swagger UI CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/swagger-ui-dist@5/swagger-ui.css";
    document.head.appendChild(link);

    // 2. Load Swagger UI bundle, then initialise
    const script = document.createElement("script");
    script.src = "https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js";
    script.onload = () => {
      if (!containerRef.current) return;
      window.SwaggerUIBundle({
        url: "/api/docs/spec",
        domNode: containerRef.current,
        presets: [
          window.SwaggerUIBundle.presets?.apis,
          window.SwaggerUIBundle.SwaggerUIStandalonePreset,
        ].filter(Boolean),
        layout: "BaseLayout",
        deepLinking: true,
        requestInterceptor: (req: { headers: Record<string, string> }) => req,
        // Show schemas expanded
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        // Show operations expanded
        docExpansion: "list",
      });
    };
    document.head.appendChild(script);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa" }}>
      {/* Top bar */}
      <div
        style={{
          background: "#1e293b",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <span
          style={{
            color: "#f8fafc",
            fontWeight: 700,
            fontSize: "15px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          工廠訂單管理排程系統 — API Docs
        </span>
        <span
          style={{
            fontSize: "11px",
            background: "#334155",
            color: "#94a3b8",
            padding: "2px 8px",
            borderRadius: "999px",
            fontFamily: "monospace",
          }}
        >
          OpenAPI 3.0
        </span>
      </div>

      {/* Auth note */}
      {process.env.NODE_ENV === "development" && (
        <div
          style={{
            background: "#fefce8",
            border: "1px solid #fde047",
            borderRadius: "0",
            padding: "10px 24px",
            fontSize: "13px",
            color: "#854d0e",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <strong>Dev mode：</strong> 先到{" "}
          <a href="/login" style={{ color: "#0369a1", fontWeight: 700 }}>
            /login
          </a>{" "}
          登入取得 access token，再點右上角「Authorize」輸入{" "}
          <code
            style={{
              background: "#fef9c3",
              padding: "1px 6px",
              borderRadius: "4px",
              fontFamily: "monospace",
            }}
          >
            Bearer &lt;accessToken&gt;
          </code>
          ，即可在此頁直接發 API 請求。
        </div>
      )}

      {/* Swagger UI mounts here */}
      <div ref={containerRef} id="swagger-ui" />
    </div>
  );
}
