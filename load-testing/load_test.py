#!/usr/bin/env python3
"""
Load testing script for MemTrace API.
- 100 requests per batch
- Repeats 10 times with 2-minute intervals
- Uses mock data (no real API calls)
"""

import asyncio
import httpx
import time
import random
from datetime import datetime
from typing import Callable
from dataclasses import dataclass


@dataclass
class LoadTestResult:
    total_requests: int
    successful: int
    failed: int
    avg_response_time: float
    min_response_time: float
    max_response_time: float


class MockAPIResponses:
    """Mock responses for API endpoints"""

    @staticmethod
    def mock_trace_list() -> dict:
        """Mock /api/v1/traces response"""
        return {
            "items": [
                {
                    "traceId": f"trace-{i}",
                    "rootSpanName": f"query_{i}",
                    "serviceName": "agent-service",
                    "startTime": "2024-01-15T10:00:00Z",
                    "durationMs": random.randint(100, 5000),
                    "status": random.choice(["ok", "error"]),
                    "spanCount": random.randint(1, 10),
                    "errorCount": random.randint(0, 3),
                    "totalTokens": random.randint(100, 2000),
                    "input": f"Input message {i}",
                    "output": f"Output response {i}",
                    "conversationId": f"conv-{i % 5}",
                }
                for i in range(10)
            ],
            "nextCursor": None,
        }

    @staticmethod
    def mock_spans_list() -> dict:
        """Mock /api/v1/spans response"""
        return {
            "items": [
                {
                    "spanId": f"span-{i}",
                    "traceId": f"trace-{i // 5}",
                    "parentSpanId": None if i % 3 == 0 else f"span-{i-1}",
                    "conversationId": f"conv-{i % 5}",
                    "name": random.choice(["llm_call", "tool_use", "retriever"]),
                    "kind": random.choice(["llm", "tool", "retriever"]),
                    "serviceName": "agent-service",
                    "startTime": "2024-01-15T10:00:00Z",
                    "durationMs": random.randint(50, 3000),
                    "status": "ok",
                    "model": "gpt-4" if random.random() > 0.5 else None,
                    "totalTokens": random.randint(50, 1500),
                    "input": f"Input {i}",
                    "output": f"Output {i}",
                }
                for i in range(20)
            ],
            "nextCursor": None,
        }

    @staticmethod
    def mock_conversations_list() -> dict:
        """Mock /api/v1/conversations response"""
        return {
            "items": [
                {
                    "conversationId": f"conv-{i}",
                    "serviceNames": ["agent-service"],
                    "startTime": "2024-01-15T10:00:00Z",
                    "lastActivity": "2024-01-15T10:30:00Z",
                    "turnCount": random.randint(1, 10),
                    "errorTurns": random.randint(0, 2),
                    "failedSpans": random.randint(0, 5),
                    "totalTokens": random.randint(1000, 10000),
                    "activeMs": random.randint(10000, 60000),
                }
                for i in range(5)
            ],
            "nextCursor": None,
        }

    @staticmethod
    def mock_services() -> dict:
        """Mock /api/v1/services response"""
        return {"items": ["agent-service", "tool-executor", "llm-client"]}

    @staticmethod
    def mock_health() -> dict:
        """Mock /api/v1/health response"""
        return {"status": "ok"}


class LoadTester:
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url
        self.mock_responses = MockAPIResponses()
        self.response_times: list[float] = []

    async def make_request(self, method: str, endpoint: str) -> tuple[bool, float]:
        """Make a single request and return success status and response time"""
        url = f"{self.base_url}/api/v1{endpoint}"

        # Get mock response based on endpoint
        if "traces" in endpoint and "conversations" not in endpoint:
            mock_data = self.mock_responses.mock_trace_list()
        elif "spans" in endpoint:
            mock_data = self.mock_responses.mock_spans_list()
        elif "conversations" in endpoint:
            mock_data = self.mock_responses.mock_conversations_list()
        elif "services" in endpoint:
            mock_data = self.mock_responses.mock_services()
        elif "health" in endpoint:
            mock_data = self.mock_responses.mock_health()
        else:
            mock_data = {}

        try:
            start_time = time.time()

            # Simulate network latency (20-200ms)
            await asyncio.sleep(random.uniform(0.02, 0.2))

            response_time = time.time() - start_time
            self.response_times.append(response_time)

            return True, response_time
        except Exception as e:
            print(f"Request failed: {e}")
            return False, 0

    async def run_batch(self, batch_num: int, requests_per_batch: int = 100) -> LoadTestResult:
        """Run a batch of concurrent requests"""
        print(
            f"\n{'='*60}"
            f"\nBatch {batch_num}: Starting {requests_per_batch} requests"
            f"\nTime: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            f"\n{'='*60}"
        )

        endpoints = [
            "/traces",
            "/traces?limit=50",
            "/spans",
            "/spans?limit=100",
            "/conversations",
            "/services",
            "/health",
        ]

        tasks = []
        for i in range(requests_per_batch):
            endpoint = endpoints[i % len(endpoints)]
            task = self.make_request("GET", endpoint)
            tasks.append(task)

        # Run all requests concurrently
        results = await asyncio.gather(*tasks)

        successful = sum(1 for success, _ in results if success)
        failed = len(results) - successful
        response_times = [rt for _, rt in results if rt > 0]

        if response_times:
            avg_time = sum(response_times) / len(response_times)
            min_time = min(response_times)
            max_time = max(response_times)
        else:
            avg_time = min_time = max_time = 0

        result = LoadTestResult(
            total_requests=requests_per_batch,
            successful=successful,
            failed=failed,
            avg_response_time=avg_time,
            min_response_time=min_time,
            max_response_time=max_time,
        )

        print(f"\nBatch {batch_num} Results:")
        print(f"  Successful: {successful}/{requests_per_batch}")
        print(f"  Failed: {failed}/{requests_per_batch}")
        print(f"  Avg Response Time: {avg_time*1000:.2f}ms")
        print(f"  Min Response Time: {min_time*1000:.2f}ms")
        print(f"  Max Response Time: {max_time*1000:.2f}ms")

        return result

    async def run_load_test(
        self,
        num_batches: int = 10,
        requests_per_batch: int = 100,
        interval_seconds: int = 120,
    ):
        """Run complete load test with multiple batches"""
        print(f"\n🚀 Starting Load Test")
        print(f"   Batches: {num_batches}")
        print(f"   Requests per batch: {requests_per_batch}")
        print(f"   Interval between batches: {interval_seconds}s")
        print(f"   Total requests: {num_batches * requests_per_batch}")

        all_results: list[LoadTestResult] = []
        start_time = time.time()

        for batch_num in range(1, num_batches + 1):
            result = await self.run_batch(batch_num, requests_per_batch)
            all_results.append(result)

            if batch_num < num_batches:
                print(
                    f"\n⏳ Next batch in {interval_seconds} seconds..."
                    f"\n   (Press Ctrl+C to stop)"
                )
                try:
                    await asyncio.sleep(interval_seconds)
                except KeyboardInterrupt:
                    print("\n⚠️  Load test interrupted by user")
                    break

        # Print final summary
        total_time = time.time() - start_time
        total_successful = sum(r.successful for r in all_results)
        total_failed = sum(r.failed for r in all_results)
        total_requests = sum(r.total_requests for r in all_results)

        all_response_times = self.response_times
        if all_response_times:
            avg_all = sum(all_response_times) / len(all_response_times)
            min_all = min(all_response_times)
            max_all = max(all_response_times)
        else:
            avg_all = min_all = max_all = 0

        print(f"\n{'='*60}")
        print(f"📊 FINAL SUMMARY")
        print(f"{'='*60}")
        print(f"Total Time: {total_time:.2f}s")
        print(f"Total Requests: {total_requests}")
        print(f"  ✓ Successful: {total_successful}")
        print(f"  ✗ Failed: {total_failed}")
        print(f"Success Rate: {(total_successful/total_requests*100):.1f}%")
        print(f"\nResponse Times:")
        print(f"  Average: {avg_all*1000:.2f}ms")
        print(f"  Min: {min_all*1000:.2f}ms")
        print(f"  Max: {max_all*1000:.2f}ms")
        print(f"{'='*60}\n")


async def main():
    """Main entry point"""
    import sys

    base_url = "http://localhost:3000"
    num_batches = 10
    requests_per_batch = 100
    interval_seconds = 120

    # Parse command line arguments
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--url" and i + 1 < len(sys.argv) - 1:
            base_url = sys.argv[i + 2]
        elif arg == "--batches" and i + 1 < len(sys.argv) - 1:
            num_batches = int(sys.argv[i + 2])
        elif arg == "--requests" and i + 1 < len(sys.argv) - 1:
            requests_per_batch = int(sys.argv[i + 2])
        elif arg == "--interval" and i + 1 < len(sys.argv) - 1:
            interval_seconds = int(sys.argv[i + 2])

    tester = LoadTester(base_url=base_url)
    await tester.run_load_test(
        num_batches=num_batches,
        requests_per_batch=requests_per_batch,
        interval_seconds=interval_seconds,
    )


if __name__ == "__main__":
    asyncio.run(main())
