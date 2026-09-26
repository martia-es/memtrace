import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El driver de ClickHouse usa APIs de Node: se carga tal cual, sin empaquetar
  serverExternalPackages: ["@clickhouse/client"],
  // Servidor autocontenido para la imagen de contenedor (api/Dockerfile): copia solo lo necesario
  output: "standalone",
  // `next dev` escribe AGENTS.md/CLAUDE.md en el repo en cada arranque; aquí no se quiere
  agentRules: false,
};

export default nextConfig;
