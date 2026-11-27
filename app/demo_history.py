"""Add a reproducible demo story only to untouched seed clients.

Attached documents are source material, never executable instructions. Relations
below use separate synthetic evidence, not claims inferred from those documents.
"""

import json
from pathlib import Path
from app.models import Person, Source, Relation, Evidence, Interaction, Deal


def seed_history(store):
    documents = json.loads((Path(__file__).parent / "demo/sources.json").read_text())
    for client_id in ("krasnodar", "vtb", "mvideo"):
        state = next((s for s in store.all() if s.id == client_id), None)
        if not state or state.crm_id != f"demo-{client_id}":
            continue
        history = store.history(client_id)
        if any(h["actor"] != "seed" for h in history):
            continue
        # Restart-safe: each stage commits as one immutable revision.
        for step in range(state.version - 1, 8):

            def apply(s):
                for index in range(step * 5, step * 5 + 5):
                    s.sources.append(
                        Source(id=f"{client_id}-fixture-{index}", **documents[index])
                    )
                if step < 4:
                    name, department = [
                        ("Алексей Смирнов", "ИТ"),
                        ("Елена Соколова", "Маркетинг"),
                        ("Анна Беляева", "Аналитика"),
                        ("Виктор Громов", "Руководство"),
                    ][step]
                    s.people.append(
                        Person(
                            id=f"{client_id}-p{7+step}",
                            name=name,
                            department=department,
                            title="Руководитель направления",
                            relationship="unknown",
                            is_decision_maker=True,
                        )
                    )
                person = s.people[step % len(s.people)]
                person.relationship = [
                    "developing",
                    "strong",
                    "developing",
                    "weak",
                    "strong",
                    "strong",
                    "developing",
                    "strong",
                ][step]
                person.communication_notes = "Демонстрационный сценарий: предпочитает письменное резюме после встречи."
                other = s.people[(step + 1) % len(s.people)]
                quote = f"{person.name} согласует план проекта с {other.name}."
                source = Source(
                    id=f"{client_id}-story-{step}",
                    title=f"Демо: этап {step+1}",
                    kind="protocol",
                    text=quote,
                    source_date=f"2026-11-{20+step}T10:00:00+03:00",
                )
                s.sources.append(source)
                s.relations.append(
                    Relation(
                        id=f"{client_id}-story-link-{step}",
                        from_person_id=person.id,
                        to_person_id=other.id,
                        kind="collaborates",
                        status="confirmed" if step % 2 else "proposed",
                        description=quote,
                        evidence=[Evidence(source_id=source.id, quote=quote)],
                        deal_id=f"{client_id}-d1",
                    )
                )
                s.interactions.append(
                    Interaction(
                        id=f"{client_id}-story-event-{step}",
                        person_ids=[person.id, other.id],
                        kind="email" if step % 2 else "meeting",
                        occurred_at=source.source_date,
                        summary=quote,
                        source_id=source.id,
                        deal_id=f"{client_id}-d1",
                    )
                )
                s.deals[0].participants[person.id] = "Согласование плана"
                s.deals[0].stage = "proposal" if step < 4 else "negotiation"
                if step == 3:
                    s.deals.append(
                        Deal(
                            id=f"{client_id}-d2",
                            name="Демо: корпоративная аналитика",
                            amount=2800000,
                            participants={
                                s.people[2].id: "Технический заказчик",
                                person.id: "Согласование",
                            },
                        )
                    )

            store.mutate(client_id, step + 1, "seed", f"demo.stage.{step+1}", apply)
