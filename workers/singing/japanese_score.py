"""Japanese score preparation. Derived mora timing never changes accepted notes."""
from __future__ import annotations
import re
import unicodedata
from typing import Any, Callable


def hiragana(text: str) -> str:
    text = unicodedata.normalize('NFKC', text)
    return ''.join(chr(ord(c) - 96) if 'ァ' <= c <= 'ヶ' else c for c in text)


def morae(text: str) -> list[str]:
    result: list[str] = []
    for c in hiragana(text):
        if c.isspace():
            continue
        if c in 'ゃゅょぁぃぅぇぉゎ' and result:
            result[-1] += c
        elif 'ぁ' <= c <= 'ゖ' or c == 'ー':
            result.append(c)
        else:
            raise ValueError('Enter a kana pronunciation for this Japanese lyric')
    if not result:
        raise ValueError('Enter a nonempty Japanese pronunciation')
    return result


def resolve_readings(source: dict[str, Any], frontend: Callable[[str], list[dict]]) -> dict[str, list[str]]:
    """Resolve the full lyric before selecting a phrase. Never guess a split kanji word."""
    notes = sorted(source['notes'], key=lambda n: n['start'])
    spans, text = [], ''
    for note in notes:
        assignment = source['vocal']['syllables'].get(note['id'], {})
        if assignment.get('kind') == 'continue':
            continue
        lyric = unicodedata.normalize('NFKC', assignment.get('lyric', '')).replace(' ', '')
        if not lyric:
            raise ValueError(f"Beat {note['start'] + 1}: assign Japanese lyrics")
        spans.append((len(text), len(text) + len(lyric), note, assignment))
        text += lyric
    readings: dict[str, str] = {n['id']: '' for _, _, n, _ in spans}
    cursor = 0
    for item in frontend(text):
        surface = item['string']
        start = text.find(surface, cursor)
        if start < 0:
            raise ValueError('Japanese text normalization is ambiguous; enter kana pronunciation')
        end = start + len(surface)
        cursor = end
        owners = [(a, b, n, s) for a, b, n, s in spans if a < end and b > start]
        if not owners:
            continue
        if len(owners) == 1:
            readings[owners[0][2]['id']] += (item.get('pron', '') or surface).replace('’', '')
        else:
            # Kana boundaries are unambiguous; a kanji word crossing notes requires
            # explicit per-note readings, rather than evenly guessing syllables.
            for a, b, note, assignment in owners:
                if assignment.get('pronunciation') or assignment.get('phonemes'):
                    continue
                fragment = text[max(a, start):min(b, end)]
                if re.search(r'[一-龯々]', surface):
                    raise ValueError(f"Beat {note['start'] + 1}: word '{surface}' crosses notes; enter kana pronunciation")
                readings[note['id']] += fragment
    result = {}
    for _, _, note, assignment in spans:
        if assignment.get('phonemes'):
            result[note['id']] = []
            continue
        try:
            result[note['id']] = morae(assignment.get('pronunciation') or readings[note['id']])
        except ValueError as error:
            raise ValueError(f"Beat {note['start'] + 1}: {error}") from error
    return result


def compile_ust(source: dict[str, Any], context: dict[str, Any], tempo: float,
                readings: dict[str, list[str]], table: dict[str, list[str]], intensity: str = '0030') -> tuple[str, list[dict], dict]:
    """Generate HTS-compatible UST plus exact per-derived-note timing budgets."""
    if not 0 < tempo < float('inf'):
        raise ValueError('Invalid score tempo')
    vocal = source['vocal']
    if vocal.get('pitch') or vocal.get('vibrato'):
        raise ValueError('This Japanese voice supports automatic pitch; remove manual pitch/vibrato overrides')
    ordered = sorted(context['notes'], key=lambda n: n['start'])
    notes = sorted(source['notes'], key=lambda n: n['start'])
    first, last = notes[0]['start'], notes[-1]['start'] + notes[-1]['duration']
    seconds = 60 / tempo
    lead, tail = .15, .2
    inventory = {p for row in table.values() for p in row}
    segments: list[dict] = []
    def append(lyric: str, pitch: int, duration: float, phones: list[dict] | None = None):
        segments.append({'lyric': lyric, 'pitch': pitch, 'seconds': duration, 'phones': phones})
    append('R', 60, lead)
    cursor = first
    for note in notes:
        if note['start'] > cursor + 1e-8:
            append('R', 60, (note['start'] - cursor) * seconds)
        assignment = vocal['syllables'][note['id']]
        duration = note['duration'] * seconds
        if assignment['kind'] == 'continue':
            i = next(i for i, n in enumerate(ordered) if n['id'] == note['id']) - 1
            while i >= 0 and context['vocal']['syllables'][ordered[i]['id']]['kind'] == 'continue':
                i -= 1
            if i < 0:
                raise ValueError(f"Beat {note['start'] + 1}: continuation needs a preceding syllable")
            previous = context['vocal']['syllables'][ordered[i]['id']]
            phone = previous.get('phonemes', [{}])[-1].get('symbol') if previous.get('phonemes') else table.get(readings[ordered[i]['id']][-1], [])[-1:]
            vowel = phone if isinstance(phone, str) else (phone[0] if phone else '')
            if vowel not in {'a', 'i', 'u', 'e', 'o', 'N'}:
                raise ValueError(f"Beat {note['start'] + 1}: previous syllable has no sustainable vowel")
            append(vowel, note['pitch'], duration)
        elif assignment.get('phonemes'):
            phones = assignment['phonemes']
            if any(p['symbol'] not in inventory for p in phones):
                raise ValueError(f"Beat {note['start'] + 1}: unknown Japanese phoneme")
            append(' '.join(p['symbol'] for p in phones), note['pitch'], duration, phones)
        else:
            tokens = readings[note['id']]
            prior = ''
            if tokens and tokens[0] == 'ー':
                index = next(i for i, n in enumerate(ordered) if n['id'] == note['id'])
                previous_tokens = [token for n in ordered[:index] for token in readings.get(n['id'], []) if token != 'ー']
                if previous_tokens and previous_tokens[-1] in table:
                    prior = table[previous_tokens[-1]][-1]
            for token in tokens:
                if token == 'ー':
                    if prior not in {'a', 'i', 'u', 'e', 'o', 'N'}:
                        raise ValueError(f"Beat {note['start'] + 1}: long vowel needs its preceding kana in pronunciation")
                    append(prior, note['pitch'], duration / len(tokens))
                    continue
                if token not in table:
                    raise ValueError(f"Beat {note['start'] + 1}: unsupported Japanese mora '{token}'")
                append(token, note['pitch'], duration / len(tokens))
                prior = table[token][-1]
        cursor = note['start'] + note['duration']
    append('R', 60, tail)
    ust = f'[#VERSION]\nUST Version1.2\n[#SETTING]\nTempo={tempo}\nTracks=1\n'
    # Preserve the accepted tempo in the model's musical context. Integer UST
    # tick rounding is corrected using exact budgets after HTS creation.
    for i, segment in enumerate(segments):
        ust += (f"[#{i:04d}]\nLength={max(20, round(segment['seconds'] * tempo * 8))}\n"
                f"Lyric={segment['lyric']}\nNoteNum={segment['pitch']}\nTempo={tempo}\nFlags={intensity}\n")
    alignment = {'source_start_beat': first, 'offset_seconds': first * seconds - lead,
                 'lead_seconds': lead, 'tail_seconds': tail, 'duration_seconds': (last - first) * seconds + lead + tail}
    return ust + '[#TRACKEND]\n', segments, alignment


def phone_durations(segment: dict, predicted: list[float], beat_seconds: float) -> list[float]:
    """Fit predicted phone ratios and explicit overrides into the accepted note."""
    count = len(predicted)
    fixed = [p.get('duration_beats') for p in segment['phones']] if segment.get('phones') else [None] * count
    if len(fixed) != count:
        raise ValueError('Phoneme override does not match generated Japanese labels')
    used = sum(x * beat_seconds for x in fixed if x is not None)
    free = [i for i, x in enumerate(fixed) if x is None]
    remaining = segment['seconds'] - used
    if remaining < -1e-7 or (not free and abs(remaining) > 1e-7) or (free and remaining <= 0):
        raise ValueError('Phoneme durations must fill the original Japanese note budget')
    total = sum(max(.001, predicted[i]) for i in free)
    return [x * beat_seconds if x is not None else remaining * max(.001, predicted[i]) / total for i, x in enumerate(fixed)]
