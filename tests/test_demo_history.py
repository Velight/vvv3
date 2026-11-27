from app.seed import seed
from app.demo_history import seed_history
from app.store import Store


def test_demo_history_is_replayable_and_idempotent(tmp_path):
    store = Store(tmp_path / "demo.db")
    seed(store)
    original = store.get("krasnodar").model_dump()
    seed_history(store)
    assert store.get("krasnodar", 1).model_dump() == original
    latest = store.get("krasnodar")
    assert latest.version == 9
    assert len(latest.people) == 10
    assert len(latest.sources) == 49
    assert len(latest.deals) == 2
    for version in range(1, 10):
        snapshot = store.get("krasnodar", version)
        ids = {p.id for p in snapshot.people}
        sources = {s.id: s.text for s in snapshot.sources}
        for r in snapshot.relations:
            assert {r.from_person_id, r.to_person_id} <= ids
            for evidence in r.evidence:
                assert evidence.quote in sources[evidence.source_id]
    seed_history(store)
    assert store.get("krasnodar").model_dump() == latest.model_dump()


def test_demo_does_not_modify_user_changes(tmp_path):
    store = Store(tmp_path / "demo.db")
    seed(store)
    store.mutate(
        "krasnodar",
        1,
        "editor",
        "person.updated",
        lambda s: setattr(s.people[0], "name", "User"),
    )
    seed_history(store)
    assert store.get("krasnodar").version == 2
    assert store.get("krasnodar").people[0].name == "User"
