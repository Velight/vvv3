import pytest


@pytest.fixture(autouse=True)
def minimal_seed_for_api_contracts(monkeypatch):
    # Existing API contracts exercise mutations from version 1.
    monkeypatch.setenv("SEED_HISTORY", "false")
