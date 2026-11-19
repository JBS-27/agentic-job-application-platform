"""
Phase 1 test: verifies the FastAPI app boots and the health endpoint
responds. No feature logic is tested here since none exists yet.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "running"


def test_health_endpoint_reachable():
    response = client.get("/health")
    assert response.status_code == 200
    assert "database_connected" in response.json()
