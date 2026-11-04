"""Original, scored Mandarin syllables for the non-commercial reference experiment."""
from __future__ import annotations
import math
from typing import Any


def phrase(seconds: float) -> dict[str, Any]:
    """Build a phoneme-level DS phrase with rests and one continued vowel."""
    if seconds < 2:
        raise ValueError('The demo phrase requires at least two seconds')
    # These four syllables mean 'hello, music'; melody is created for this test.
    syllables = [('n', 'i', 60), ('h', 'ao', 64), ('y', 'in', 67), ('y', 've', 65)]
    leading = 0.15
    trailing = 0.2
    middle_rest = 0.15
    duration = (seconds - leading - trailing - middle_rest) / 4
    phonemes: list[str] = ['SP']
    durations = [leading]
    notes = ['rest']
    slurs = [0]
    midis: list[int | None] = [None]
    for index, (consonant, vowel, midi) in enumerate(syllables):
        if index == 2:
            phonemes.append('SP'); durations.append(middle_rest)
            notes.append('rest'); slurs.append(0); midis.append(None)
        consonant_duration = min(0.08, duration * 0.2)
        vowel_duration = duration - consonant_duration
        phonemes.extend([consonant, vowel]); durations.extend([consonant_duration, vowel_duration])
        note = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12] + str(midi // 12 - 1)
        notes.extend([note, note]); slurs.extend([0, 0]); midis.extend([midi, midi])
        if index == 1:
            # Continue the same vowel on a neighboring note without a new consonant.
            durations[-1] = vowel_duration * 0.6
            phonemes.append(vowel); durations.append(vowel_duration * 0.4)
            notes.append('F4'); slurs.append(1); midis.append(65)
    phonemes.append('SP'); durations.append(trailing)
    notes.append('rest'); slurs.append(0); midis.append(None)
    ends: list[float] = []
    total = 0.0
    for duration in durations:
        total += duration; ends.append(total)
    timestep = 0.005
    f0: list[float] = []
    interval = 0
    for frame in range(math.ceil(seconds / timestep)):
        t = frame * timestep
        while interval + 1 < len(ends) and t >= ends[interval]:
            interval += 1
        midi = midis[interval]
        f0.append(0.0 if midi is None else 440.0 * 2 ** ((midi - 69) / 12))
    return {'text': '你好音乐', 'input_type': 'phoneme', 'ph_seq': ' '.join(phonemes),
            'note_seq': ' '.join(notes), 'note_dur_seq': ' '.join(f'{x:.9f}' for x in durations),
            'ph_dur': ' '.join(f'{x:.9f}' for x in durations),
            'is_slur_seq': ' '.join(str(x) for x in slurs),
            'f0_seq': ' '.join(f'{x:.6f}' for x in f0), 'f0_timestep': timestep}
