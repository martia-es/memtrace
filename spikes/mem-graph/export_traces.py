"""Exporta de ClickHouse los spans de las trazas generadas con `spikes/mem` (sesiones `gen-weather-*`) a `data/spans.jsonl`.

Usa el clickhouse-client del pod del cluster local (no necesita puertos abiertos ni credenciales).
  python export_traces.py [--prefix gen-weather-]
"""
import argparse
import subprocess
from pathlib import Path

QUERY = """
SELECT TraceId, SpanId, ParentSpanId, SpanName, StatusCode, StatusMessage, toString(Timestamp) AS ts, Duration,
       ConversationId, PromptVersion,
       SpanAttributes['memtrace.step_type'] AS step_type,
       SpanAttributes['gen_ai.tool.name'] AS tool,
       SpanAttributes['gen_ai.tool.call.arguments'] AS args,
       substring(SpanAttributes['gen_ai.tool.call.result'], 1, 2000) AS result,
       SpanAttributes['gen_ai.request.model'] AS model,
       SpanAttributes['gen_ai.usage.input_tokens'] AS tokens_in,
       SpanAttributes['gen_ai.usage.output_tokens'] AS tokens_out,
       if(SpanName LIKE 'chat %', SpanAttributes['gen_ai.input.messages'], '') AS input_messages,
       if(SpanName LIKE 'invoke_agent%', SpanAttributes['final_result'], '') AS final_result,
       if(SpanName LIKE 'chat %', SpanAttributes['gen_ai.tool.definitions'], '') AS tool_defs
FROM memtrace.otel_traces
WHERE ConversationId LIKE '{prefix}%'
ORDER BY TraceId, Timestamp
FORMAT JSONEachRow
"""

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="gen-weather-")
    a = ap.parse_args()
    out = Path(__file__).parent / "data"
    out.mkdir(exist_ok=True)
    r = subprocess.run(
        ["kubectl", "-n", "memtrace", "exec", "-i", "clickhouse-0", "-c", "clickhouse", "--", "clickhouse-client"],
        input=QUERY.format(prefix=a.prefix.replace("'", "")), capture_output=True, text=True, check=True,
    )
    (out / "spans.jsonl").write_text(r.stdout)
    print(f"{r.stdout.count(chr(10))} spans -> data/spans.jsonl")
