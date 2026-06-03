import pytest

from backend.main import app


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    return TestClient(app)
