"""Compile accepted vocal-score snapshots to the pinned model's phoneme-level DS input."""
from __future__ import annotations
import math
import re
from typing import Any


def compile_phrase(source: dict[str, Any], tempo: float, dictionary: dict[str, list[str]],
                   lead: float = 0.15, tail: float = 0.2) -> tuple[dict[str, Any], dict[str, Any]]:
    """Keep note pitch/length authoritative; fixed initial phone timing is not AI prediction."""
    from pypinyin import lazy_pinyin
    import numpy as np

    beat_seconds = 60 / tempo
    vocal = source['vocal']
    notes = sorted(source['notes'], key=lambda n: n['start'])
    if not notes:
        raise ValueError('Add notes before synthesizing')
    first = notes[0]['start']
    end = notes[-1]['start'] + notes[-1]['duration']
    syllables = vocal['syllables']
    # Read adjacent Chinese syllables in phrase context, preserving editable lyric labels.
    # Explicit pronunciation always wins; raw phonemes override both paths below.
    automatic: dict[str, list[str]] = {}
    run: list[tuple[str, str]] = []
    def resolve_run() -> None:
        if run:
            for (note_id, _), reading in zip(run, lazy_pinyin(''.join(text for _, text in run))):
                automatic.setdefault(note_id, []).append(reading)
            run.clear()
    for n in notes:
        assignment = syllables.get(n['id'], {})
        if assignment.get('kind') == 'continue':
            continue
        text = assignment.get('lyric', '').strip()
        for token in re.findall(r'[\u3400-\u9fff]|[^\s\u3400-\u9fff]+', text):
            if len(token) == 1 and '\u3400' <= token <= '\u9fff':
                run.append((n['id'], token))
            else:
                resolve_run()
                automatic.setdefault(n['id'], []).append(token.lower())
    resolve_run()
    phonemes = ['SP']
    durations = [lead]
    note_names = ['rest']
    resolved = []
    cursor = first
    i = 0
    while i < len(notes):
        note = notes[i]
        if note['start'] > cursor + 1e-6:
            phonemes.append('SP'); durations.append((note['start'] - cursor) * beat_seconds); note_names.append('rest')
        assignment = syllables.get(note['id'])
        if not assignment or assignment['kind'] != 'syllable' or not assignment.get('lyric', '').strip():
            raise ValueError(f"Assign a lyric syllable to note {note['id']}")
        j = i + 1
        while j < len(notes) and syllables.get(notes[j]['id'], {}).get('kind') == 'continue':
            j += 1
        group_end = notes[j - 1]['start'] + notes[j - 1]['duration']
        seconds = (group_end - note['start']) * beat_seconds
        override = assignment.get('phonemes')
        keys: list[str] = []
        budgets: list[float] = []
        if override:
            phones = [p['symbol'] for p in override]
            unknown = set(phones) - {v for row in dictionary.values() for v in row} - {'SP', 'AP'}
            if unknown: raise ValueError('Unknown phonemes: ' + ', '.join(sorted(unknown)))
            fixed = [p.get('duration_beats') for p in override]
            weights = [0.2 if k < len(phones) - 1 else 0.8 for k in range(len(phones))]
        else:
            text = assignment['lyric'].strip().lower()
            keys = assignment.get('pronunciation', '').strip().lower().split() or automatic.get(note['id'], lazy_pinyin(text))
            lyric_count = len(re.findall(r'[\u3400-\u9fff]|[^\s\u3400-\u9fff]+', text))
            if assignment.get('pronunciation', '').strip() and len(keys) != lyric_count:
                raise ValueError(f'Enter {lyric_count} pronunciation syllables to match the lyrics')
            phones = []
            weights = []
            for syllable_index, key in enumerate(keys):
                if key not in dictionary:
                    raise ValueError(f"Unknown syllable '{key}' at beat {note['start'] + 1}; enter pronunciation")
                row = dictionary[key]
                budget = note['duration'] * beat_seconds / len(keys)
                if syllable_index == len(keys) - 1:
                    budget += seconds - note['duration'] * beat_seconds
                budgets.append(budget)
                row_weights = [0.2 if k < len(row) - 1 else 0.8 for k in range(len(row))]
                weights.extend(budget * w / sum(row_weights) for w in row_weights)
                phones.extend(row)
            fixed = [None] * len(phones)
        used = sum(x * beat_seconds for x in fixed if x is not None)
        missing = sum(x is None for x in fixed)
        if used > seconds + 1e-6 or (not missing and abs(used - seconds) > 1e-6):
            raise ValueError(f"Phone timing must fill syllable group {note['id']}")
        remaining = max(0, seconds - used)
        if missing:
            # A deterministic editing default; final phone carries the sustained vowel.
            free_weights = [w for k, w in enumerate(weights) if fixed[k] is None]
            total = sum(free_weights)
            free = iter(remaining * w / total for w in free_weights)
            phone_seconds = [x * beat_seconds if x is not None else next(free) for x in fixed]
        else:
            phone_seconds = [x * beat_seconds for x in fixed]
        if any(x <= 0 for x in phone_seconds): raise ValueError('Phone duration must be positive')
        phonemes.extend(phones); durations.extend(phone_seconds)
        note_name = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][note['pitch'] % 12] + str(note['pitch'] // 12 - 1)
        note_names.extend([note_name] * len(phones))
        resolved.append({'note_id': note['id'], 'phonemes': phones,
                         'durations_seconds': phone_seconds, 'syllables': keys, 'syllable_durations_seconds': budgets, 'timing': 'manual-or-fixed-initial'})
        cursor = group_end
        i = j
    phonemes.append('SP'); durations.append(tail); note_names.append('rest')
    total = (end - first) * beat_seconds + lead + tail
    timestep = 0.005
    f0 = []
    times = np.arange(math.ceil(total / timestep)) * timestep
    pitch_points = vocal.get('pitch', [])
    regions: list[tuple[float, float]] = []
    for n in notes:
        if regions and abs(regions[-1][1] - n['start']) <= 1e-6:
            regions[-1] = (regions[-1][0], n['start'] + n['duration'])
        else:
            regions.append((n['start'], n['start'] + n['duration']))
    for t in times:
        beat = (float(t) - lead) / beat_seconds + first
        note = next((n for n in notes if n['start'] <= beat < n['start'] + n['duration']), None)
        if note is None:
            f0.append(0.0)
            continue
        region = next(r for r in regions if r[0] <= beat < r[1])
        local_points = [p for p in pitch_points if region[0] <= p['beat'] <= region[1]]
        cents = float(np.interp(beat, [p['beat'] for p in local_points], [p['value'] for p in local_points])) if local_points else 0.0
        vib = vocal.get('vibrato', {}).get(note['id'])
        if vib:
            onset = note['start'] + note['duration'] * vib.get('onset', 0.5)
            elapsed = (beat - onset) * beat_seconds
            if elapsed > 0:
                cents += vib['depth_cents'] * min(1, elapsed / 0.05) * math.sin(2 * math.pi * vib['rate_hz'] * elapsed)
        f0.append(440 * 2 ** ((note['pitch'] - 69 + cents / 100) / 12))
    result = {'text': ' '.join(x.get('lyric', '') for x in syllables.values()), 'input_type': 'phoneme',
              'ph_seq': ' '.join(phonemes), 'note_seq': ' '.join(note_names),
              'ph_dur': ' '.join(f'{x:.9f}' for x in durations),
              'note_dur_seq': ' '.join(f'{x:.9f}' for x in durations),
              'is_slur_seq': ' '.join('0' for _ in phonemes),
              'f0_timestep': timestep, 'f0_seq': ' '.join(f'{x:.6f}' for x in f0)}
    return result, {'source_start_beat': first, 'offset_seconds': first * beat_seconds - lead,
                    'lead_seconds': lead, 'tail_seconds': tail, 'duration_seconds': total,
                    'resolved_syllables': resolved}
