from app.models import (
    ClientState,
    Person,
    Relation,
    Source,
    Deal,
    Interaction,
    Evidence,
    Metric,
)


def seed(store):
    if store.all():
        return
    d = [
        ("krasnodar", "ФК «Краснодар»"),
        ("vtb", "ВТБ"),
        ("mvideo", "М.Видео"),
        ("s7", "S7 Airlines"),
    ]
    for a, c in d:
        g = ClientState(
            id=a, name=c, industry="Демонстрационные данные", crm_id=f"demo-{a}"
        )
        if a == "s7":
            store.create(g, "seed")
            continue
        f = Source(
            id=f"{a}-source",
            title="Тестовый протокол встречи",
            kind="protocol",
            text="Николай Орлов согласует требования ИБ. Ирина Кузнецова ведёт закупку. Николай Орлов обсуждает требования с Ириной Кузнецовой.",
            source_date="2026-11-20T10:00:00+03:00",
        )
        g.sources.append(f)
        for i, (e, b, h) in enumerate(
            [
                ("Николай Орлов", "ИБ", "Руководитель ИБ"),
                ("Ирина Кузнецова", "Закупки", "Руководитель закупок"),
                ("Мария Иванова", "Инфраструктура", "Руководитель инфраструктуры"),
                ("Роман Юдин", "Юридический", "Юрист"),
                ("Сергей Петров", "Финансы", "Финансовый директор"),
                ("Дмитрий Волков", "ИБ", "Эксперт ИБ"),
            ]
        ):
            g.people.append(
                Person(
                    id=f"{a}-p{i+1}",
                    name=e,
                    title=h,
                    department=b,
                    is_decision_maker=i in (0, 1, 4),
                    relationship=[
                        "strong",
                        "developing",
                        "weak",
                        "unknown",
                        "weak",
                        "developing",
                    ][i],
                    communication_notes="Предпочтения пока не подтверждены.",
                    potential=Metric(),
                    stability=Metric(),
                )
            )
        g.deals.append(
            Deal(
                id=f"{a}-d1",
                name="Обновление защиты инфраструктуры",
                amount=1500000,
                participants={
                    g.people[0].id: "Согласование требований ИБ",
                    g.people[1].id: "Закупки",
                },
            )
        )
        g.relations.append(
            Relation(
                id=f"{a}-r1",
                from_person_id=g.people[0].id,
                to_person_id=g.people[1].id,
                kind="collaborates",
                deal_id=g.deals[0].id,
                description="Обсуждают требования безопасности",
                status="proposed",
                evidence=[
                    Evidence(
                        source_id=f.id,
                        quote="Николай Орлов обсуждает требования с Ириной Кузнецовой.",
                    )
                ],
            )
        )
        g.interactions.append(
            Interaction(
                person_ids=[g.people[0].id],
                deal_id=g.deals[0].id,
                kind="meeting",
                occurred_at="2026-11-20T10:00:00+03:00",
                summary="Обсудили требования безопасности",
                source_id=f.id,
            )
        )
        store.create(g, "seed")
