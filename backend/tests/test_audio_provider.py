import pytest
from pydantic import ValidationError

from app.adapters.audio.provider import AudioRequest, validate_url


def test_provider_payloads_and_invalid_inputs():
    ability, payload = AudioRequest(mode="music", prompt="Warm piano", duration_seconds=20).payload()
    assert ability == "ttapi-suno-v6"
    assert payload["music_option"]["duration"] == 20000
    assert payload["music_option"]["make_instrumental"] is True
    ability, payload = AudioRequest(mode="speech", prompt="Hello").payload()
    assert payload["audio_option"]["type"] == "txt_2_speech"
    ability, payload = AudioRequest(mode="sound", prompt="Rain", duration_seconds=2).payload()
    assert payload["audio_option"]["duration"] == 2000
    for data in (
        {"mode": "sound", "prompt": "x", "duration_seconds": 60},
        {"mode": "music", "prompt": "x", "duration_seconds": 15.5},
        {"mode": "transcribe"},
    ):
        with pytest.raises(ValidationError):
            AudioRequest(**data)


def test_download_rejects_private_and_non_https():
    with pytest.raises(ValueError):
        validate_url("file:///etc/passwd")
    with pytest.raises(ValueError):
        validate_url("https://127.0.0.1/a.wav")
    with pytest.raises(ValueError):
        validate_url("https://user:password@example.com/file")
