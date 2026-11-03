import asyncio

from sqlalchemy import func, select, update

from app.adapters.agent.harness import produce
from app.db.session import SessionLocal
from app.models.project import ProducerEvent, ProducerRun
from app.schemas.document import ProjectDocument

_tasks: dict[str, asyncio.Task] = {}
_slots = asyncio.Semaphore(2)
_event_locks: dict[str, asyncio.Lock] = {}


async def append(run_id: str, payload: dict) -> None:
    async with _event_locks.setdefault(run_id, asyncio.Lock()), SessionLocal() as session:
        seq = (await session.scalar(select(func.max(ProducerEvent.seq)).where(ProducerEvent.run_id == run_id)) or 0) + 1
        session.add(ProducerEvent(run_id=run_id, seq=seq, payload=payload))
        await session.commit()


async def execute(run_id: str, document: ProjectDocument, previous: dict | None) -> None:
    status = "failed"
    try:
        async with _slots, asyncio.timeout(600):
            async with SessionLocal() as session:
                run = await session.get(ProducerRun, run_id)
                prompt = run.prompt
            commands, state = await produce(
                prompt, document, previous, lambda p: append(run_id, p), project_id=run.project_id
            )
            async with SessionLocal() as session:
                run = await session.get(ProducerRun, run_id)
                run.commands = commands
                run.state = state
                await session.commit()
            status = "complete"
    except asyncio.CancelledError:
        status = "cancelled"
    except TimeoutError:
        await append(run_id, {"type": "error", "text": "Producer reached its time limit."})
    except Exception:  # noqa: BLE001 - persist terminal state for any worker failure
        await append(
            run_id, {"type": "error", "text": "Producer could not finish. Check the server model configuration."}
        )
    finally:
        async with SessionLocal() as session:
            await session.execute(update(ProducerRun).where(ProducerRun.id == run_id).values(status=status))
            await session.commit()
        await append(run_id, {"type": "status", "status": status})
        _tasks.pop(run_id, None)
        _event_locks.pop(run_id, None)


def start(run_id: str, document: ProjectDocument, previous: dict | None) -> None:
    _tasks[run_id] = asyncio.create_task(execute(run_id, document, previous))


async def recover() -> None:
    async with SessionLocal() as session:
        await session.execute(update(ProducerRun).where(ProducerRun.status == "running").values(status="interrupted"))
        await session.commit()


async def shutdown() -> None:
    tasks = list(_tasks.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
