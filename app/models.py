from __future__ import annotations
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field, model_validator


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return str(uuid4())


Text = Annotated[str, Field(min_length=1, max_length=500)]
Status = Literal["proposed", "confirmed", "rejected"]
Level = Literal["high", "medium", "low", "unknown"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Evidence(Model):
    source_id: str
    quote: Annotated[str, Field(min_length=1, max_length=4000)]


class Metric(Model):
    level: Level = "unknown"
    explanation: str = ""


class PersonInput(Model):
    name: Text
    title: str = ""
    department: str = ""
    email: str = ""
    phone: str = ""
    is_decision_maker: bool = False
    relationship: Literal["strong", "developing", "weak", "unknown"] = "unknown"
    communication_notes: str = ""
    interests: list[str] = Field(default_factory=list)
    potential: Metric = Field(default_factory=Metric)
    stability: Metric = Field(default_factory=Metric)
    evidence: list[Evidence] = Field(default_factory=list)


class Person(PersonInput):
    id: str = Field(default_factory=uid)
    updated_at: str = Field(default_factory=now)


class PersonPatch(Model):
    expected_version: int = Field(ge=1)
    changes: dict = Field(min_length=1)


class DealInput(Model):
    name: Text
    description: str = ""
    stage: Literal["discovery", "proposal", "negotiation", "won", "lost"] = "discovery"
    amount: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    currency: Literal["RUB", "USD", "EUR"] = "RUB"
    participants: dict[str, str] = Field(default_factory=dict)


class Deal(DealInput):
    id: str = Field(default_factory=uid)


class RelationInput(Model):
    from_person_id: str
    to_person_id: str
    kind: Literal["influences", "reports_to", "collaborates", "delegates", "approves"]
    description: str = ""
    deal_id: str | None = None
    strength: int = Field(default=3, ge=1, le=5)
    status: Status = "proposed"
    evidence: list[Evidence] = Field(default_factory=list)

    @model_validator(mode="after")
    def no_self_link(self):
        if self.from_person_id == self.to_person_id:
            raise ValueError("A relation must connect two different people")
        return self


class Relation(RelationInput):
    id: str = Field(default_factory=uid)
    updated_at: str = Field(default_factory=now)
    reviewed_by: str | None = None


class Review(Model):
    expected_version: int = Field(ge=1)
    status: Status
    description: str | None = None


class InteractionInput(Model):
    person_ids: list[str] = Field(min_length=1)
    deal_id: str | None = None
    kind: Literal["meeting", "email", "call", "event", "note"]
    occurred_at: datetime
    summary: Annotated[str, Field(min_length=1, max_length=10000)]
    source_id: str | None = None

    @model_validator(mode="after")
    def aware(self):
        if self.occurred_at.tzinfo is None:
            raise ValueError("occurred_at must include a timezone")
        if len(set(self.person_ids)) != len(self.person_ids):
            raise ValueError("Duplicate person_ids")
        return self


class Interaction(InteractionInput):
    id: str = Field(default_factory=uid)


class SourceInput(Model):
    title: Text
    kind: Literal["protocol", "research", "crm", "document", "manual"] = "protocol"
    text: Annotated[str, Field(min_length=1, max_length=100000)]
    source_date: datetime
    url: str | None = None

    @model_validator(mode="after")
    def aware(self):
        if self.source_date.tzinfo is None:
            raise ValueError("source_date must include a timezone")
        return self


class Source(SourceInput):
    id: str = Field(default_factory=uid)
    created_at: str = Field(default_factory=now)


class ClientInput(Model):
    name: Text
    industry: str = ""
    crm_id: str | None = None


class ClientState(ClientInput):
    id: str = Field(default_factory=uid)
    version: int = 1
    updated_at: str = Field(default_factory=now)
    people: list[Person] = Field(default_factory=list)
    deals: list[Deal] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)
    interactions: list[Interaction] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)


class ChatRequest(Model):
    intent: Literal["auto", "summary", "compare", "recommendations", "help"] = "auto"
    compare_version: int | None = Field(default=None, ge=1)
    message: Annotated[str, Field(min_length=1, max_length=4000)]
    scope: Literal["client", "deal", "person"] = "client"
    scope_id: str | None = None
    session_id: str | None = None
    version: int | None = Field(default=None, ge=1)


class Extraction(Model):
    relations: list[RelationInput] = Field(default_factory=list, max_length=30)
