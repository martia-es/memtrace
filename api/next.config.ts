import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El driver de ClickHouse usa APIs de Node: se carga tal cual, sin empaquetar
  serverExternalPackages: ["@clickhouse/client"],
  // Servidor autocontenido para la imagen de contenedor (api/Dockerfile): copia solo lo necesario
  output: "standalone",
  // `next dev` escribe AGENTS.md/CLAUDE.md en el repo en cada arranque; aquí no se quiere
  agentRules: false,
  // Cabeceras de seguridad de la API (ADR-081). Es JSON y no se muestra en un navegador, así que cierra el sniffing, el
  // enmarcado y la fuga de referer; HSTS lo pone quien termina TLS.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
