from fastapi.testclient import TestClient

from app.main import app


def test_health_is_503_until_the_agent_is_built() -> None:
    # sin entrar en el lifespan (no se usa `with`), el estado aún no tiene agente
    if hasattr(app.state, "agent"):
        del app.state.agent
    response = TestClient(app).get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "starting"}


def test_health_is_open_and_ok_once_the_agent_exists() -> None:
    app.state.agent = object()
    try:
        response = TestClient(app).get("/health")
    finally:
        del app.state.agent
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
