from dataclasses import dataclass, field
from typing import Protocol

from app.schemas.command import Command
from app.schemas.document import ProjectDocument


@dataclass
class ProducerReply:
    message: str
    commands: list[Command] = field(default_factory=list)


class Producer(Protocol):
    async def respond(self, text: str, document: ProjectDocument) -> ProducerReply: ...
