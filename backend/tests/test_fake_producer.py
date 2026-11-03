from app.adapters.agent.fake import FakeProducer
from app.schemas.document import ProjectDocument, Track


async def test_proposes_tempo_and_clip_without_applying():
    document = ProjectDocument(tracks=[Track(name="Keys")])

    reply = await FakeProducer().respond("set tempo to 96 and add a 4 bar clip", document)

    assert [command.type for command in reply.commands] == ["project.set_tempo", "clip.add"]
    clip = reply.commands[1]
    assert clip.length_beats == 16
    assert document.tracks[0].clips == []


async def test_reports_when_every_track_is_locked():
    document = ProjectDocument(tracks=[Track(name="Keys", locked=True)])

    reply = await FakeProducer().respond("add a clip", document)

    assert reply.commands == []
    assert "locked" in reply.message
