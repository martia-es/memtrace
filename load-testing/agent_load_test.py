#!/usr/bin/env python3
"""
Load testing with real MemTrace instrumentation.
Simulates N concurrent AI agents generating traces every 2 minutes × 10 batches.
Each agent uses the MemTrace SDK to generate realistic traces in ClickHouse.
"""

import asyncio
import logging
import os
import random
import sys
import time
from datetime import datetime
from pathlib import Path

os.environ["MEMTRACE_CAPTURE_CONTENT"] = "true"

# Add SDK to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root / "sdk" / "python"))

from memtrace import init_tracer, shutdown, trace_llm_call, trace_step

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("load_test")


class SimulatedAgent:
    """Simulates an AI agent performing a task with multiple steps."""

    def __init__(self, agent_id: int, service_name: str = "load-test-agent"):
        self.agent_id = agent_id
        self.service_name = service_name

    @trace_step(name="Search_Knowledge_Base", step_type="tool")
    def search_tool(self, query: str) -> str:
        """Simulate searching a knowledge base."""
        time.sleep(random.uniform(0.05, 0.2))  # 50-200ms latency
        return f"Found {random.randint(5, 20)} documents matching: {query}"

    @trace_step(name="Rank_Documents", step_type="tool")
    def rank_documents(self, documents: str) -> str:
        """Simulate ranking documents by relevance."""
        time.sleep(random.uniform(0.03, 0.15))
        return "Top 3 ranked documents processed"

    @trace_step(name="Generate_Response", step_type="llm")
    def llm_generation(self, prompt: str, context: str) -> str:
        """Simulate LLM call for response generation."""
        models = ["gpt-4o", "gpt-4-turbo", "claude-3-sonnet", "llama-3.1"]
        model = random.choice(models)

        time.sleep(random.uniform(0.1, 0.5))  # LLM latency

        response = f"Generated response using {model} based on: {context}"

        # Record LLM call with realistic token counts
        input_tokens = random.randint(150, 500)
        output_tokens = random.randint(50, 300)

        trace_llm_call(
            provider="openai" if "gpt" in model else "anthropic" if "claude" in model else "ollama",
            model=model,
            operation="chat",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            temperature=random.uniform(0.5, 1.5),
            max_tokens=1024,
            input_messages=[{"role": "user", "content": prompt}],
            output_messages=[{"role": "assistant", "content": response}],
        )

        return response

    @trace_step(name="Validate_Output", step_type="tool")
    def validate_output(self, response: str) -> bool:
        """Simulate output validation."""
        time.sleep(random.uniform(0.02, 0.1))
        # 95% success rate
        return random.random() > 0.05

    @trace_step(name="Agent_Execution", step_type="agent")
    async def execute(self) -> str:
        """Main agent execution flow."""
        query = random.choice([
            "What are the latest trends in AI?",
            "How to implement RAG systems?",
            "Best practices for LLM prompting",
            "Explain distributed tracing",
            "What is OpenTelemetry?",
        ])

        # Step 1: Search
        search_result = self.search_tool(query)

        # Step 2: Rank
        ranked = self.rank_documents(search_result)

        # Step 3: Generate with LLM
        response = self.llm_generation(query, ranked)

        # Step 4: Validate
        is_valid = self.validate_output(response)

        if not is_valid:
            raise RuntimeError("Output validation failed")

        return response


class LoadTestRunner:
    """Orchestrates the load test with multiple agents."""

    def __init__(
        self,
        num_agents: int = 10,
        otel_endpoint: str = "http://localhost:4317",
    ):
        self.num_agents = num_agents
        self.otel_endpoint = otel_endpoint
        self.total_traces = 0
        self.total_errors = 0
        self.batch_times: list[float] = []

    async def run_agent(self, agent_id: int) -> tuple[bool, float]:
        """Run a single agent and return success status and duration."""
        try:
            start = time.time()
            agent = SimulatedAgent(agent_id)
            await agent.execute()
            duration = time.time() - start
            return True, duration
        except Exception as e:
            logger.error(f"Agent {agent_id} failed: {e}")
            return False, 0

    async def run_batch(self, batch_num: int) -> dict:
        """Run a batch of concurrent agents."""
        print(
            f"\n{'='*70}"
            f"\n📊 Batch {batch_num}: Launching {self.num_agents} agents"
            f"\n⏰ Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            f"\n{'='*70}"
        )

        batch_start = time.time()
        tasks = [self.run_agent(i) for i in range(self.num_agents)]
        results = await asyncio.gather(*tasks)

        batch_duration = time.time() - batch_start
        self.batch_times.append(batch_duration)

        successful = sum(1 for success, _ in results if success)
        failed = len(results) - successful
        durations = [d for _, d in results if d > 0]

        self.total_traces += successful
        self.total_errors += failed

        if durations:
            avg_duration = sum(durations) / len(durations)
            min_duration = min(durations)
            max_duration = max(durations)
        else:
            avg_duration = min_duration = max_duration = 0

        result = {
            "batch_num": batch_num,
            "total": len(results),
            "successful": successful,
            "failed": failed,
            "batch_duration": batch_duration,
            "avg_agent_duration": avg_duration,
            "min_agent_duration": min_duration,
            "max_agent_duration": max_duration,
        }

        print(f"\n✅ Batch {batch_num} Results:")
        print(f"   Agents: {successful}/{len(results)} succeeded")
        print(f"   Batch duration: {batch_duration:.2f}s")
        print(f"   Avg agent time: {avg_duration:.2f}s")
        print(f"   Min agent time: {min_duration:.2f}s")
        print(f"   Max agent time: {max_duration:.2f}s")
        print(f"   Traces sent to ClickHouse: {successful}")

        return result

    async def run_load_test(
        self,
        num_batches: int = 10,
        interval_seconds: int = 120,
    ):
        """Run complete load test."""
        # Initialize MemTrace for this test run
        init_tracer(
            service_name="load-test-orchestrator",
            endpoint=self.otel_endpoint,
        )

        print("\n🚀 Starting Load Test with Real MemTrace Instrumentation")
        print("   Service: load-test-orchestrator")
        print(f"   Agents per batch: {self.num_agents}")
        print(f"   Total batches: {num_batches}")
        print(f"   Interval between batches: {interval_seconds}s")
        print(f"   Expected total traces: {num_batches * self.num_agents}")
        print(f"   OTLP Endpoint: {self.otel_endpoint}")

        all_results: list[dict] = []
        test_start = time.time()

        try:
            for batch_num in range(1, num_batches + 1):
                result = await self.run_batch(batch_num)
                all_results.append(result)

                # Flush traces after each batch
                shutdown()
                # Re-initialize for next batch
                if batch_num < num_batches:
                    init_tracer(
                        service_name="load-test-orchestrator",
                        endpoint=self.otel_endpoint,
                    )

                if batch_num < num_batches:
                    print(
                        f"\n⏳ Waiting {interval_seconds}s until next batch..."
                        f"\n   (Press Ctrl+C to stop)"
                    )
                    try:
                        await asyncio.sleep(interval_seconds)
                    except KeyboardInterrupt:
                        print("\n⚠️  Load test interrupted by user")
                        break

        finally:
            shutdown()

        # Print final summary
        total_time = time.time() - test_start
        print(f"\n{'='*70}")
        print("📈 FINAL SUMMARY")
        print(f"{'='*70}")
        print(f"Total Time: {total_time:.2f}s")
        print(f"Total Traces Generated: {self.total_traces}")
        print(f"Total Errors: {self.total_errors}")
        print(f"Success Rate: {(self.total_traces/(self.total_traces+self.total_errors)*100):.1f}%")
        print("\nBatch Statistics:")
        print(f"   Average batch duration: {sum(self.batch_times)/len(self.batch_times):.2f}s")
        print(f"   Min batch duration: {min(self.batch_times):.2f}s")
        print(f"   Max batch duration: {max(self.batch_times):.2f}s")
        print("\nThroughput:")
        print(f"   Traces/second: {self.total_traces/total_time:.2f}")
        print(f"   Agents/second: {(self.num_agents * len(all_results))/total_time:.2f}")
        print("\n✨ All traces have been sent to ClickHouse via OTel Collector")
        print("   View them in the Dashboard: http://localhost:3000")
        print(f"{'='*70}\n")


async def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Load test MemTrace with real agents")
    parser.add_argument(
        "--agents",
        type=int,
        default=100,
        help="Number of agents per batch (default: 10)",
    )
    parser.add_argument(
        "--batches",
        type=int,
        default=10,
        help="Number of batches (default: 10)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=20,
        help="Interval between batches in seconds (default: 120)",
    )
    parser.add_argument(
        "--endpoint",
        type=str,
        default="http://localhost:4317",
        help="OTLP endpoint (default: http://localhost:4317)",
    )

    args = parser.parse_args()

    runner = LoadTestRunner(
        num_agents=args.agents,
        otel_endpoint=args.endpoint,
    )

    await runner.run_load_test(
        num_batches=args.batches,
        interval_seconds=args.interval,
    )


if __name__ == "__main__":
    asyncio.run(main())
