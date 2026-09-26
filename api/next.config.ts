import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El driver de ClickHouse usa APIs de Node: se carga tal cual, sin empaquetar
  serverExternalPackages: ["@clickhouse/client"],
};

export default nextConfig;
