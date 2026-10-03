from typing import Any, Optional, Sequence

from memtrace.application.tracing_service import TracingService
from memtrace.dependency_container import get_service


def record_retrieved_chunks(documents: Sequence[Any], *, service: Optional[TracingService] = None) -> None:
    """Records the chunks a retrieval step returned on the current span (use inside a `retriever` step). Never raises.

    `documents`: strings, dicts (`text`, `id`?, `source`?, `score`?) or LangChain-like documents
    (`page_content` + `metadata`). The list order is the rank. The chunk text is exported only when
    content capture is enabled; the count is always recorded.
    """
    (service or get_service()).record_retrieved_chunks(documents)
