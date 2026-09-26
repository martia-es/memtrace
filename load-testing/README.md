# Agent Load Testing

Simula múltiples agentes de IA generando trazas reales en ClickHouse.

## Uso

```bash
# Ejecución básica (10 agentes × 10 batches, cada 2 minutos)
python load-testing/agent_load_test.py

# Con parámetros
python load-testing/agent_load_test.py \
  --agents 50       # Agentes por batch (default: 10)
  --batches 5       # Número de batches (default: 10)
  --interval 60     # Segundos entre batches (default: 120)
  --endpoint http://localhost:4317  # OTLP endpoint
```

## Requisitos

- Kubernetes corriendo (`make kind-up`)
- OTel Collector en localhost:4317
- API en http://localhost:3000
- ClickHouse disponible

## Qué genera

Cada agente:
1. Busca en conocimiento (tool)
2. Rankea documentos (tool)
3. Genera respuesta con LLM (gpt-4o, claude-3, llama-3.1)
4. Valida output (tool)

Resultado: trazas completas con modelos, tokens, latencias en ClickHouse.

## Ver resultados

Dashboard: http://localhost:3000 → Traces → filtrar por `service_name = "load-test-orchestrator"`

## Cancelar

Ctrl+C en cualquier momento.
