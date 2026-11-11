## Why

The deployed YuE2 worker can draft a lead sheet. Producer needs a way to turn it into editable Clips with accurate beat positions.

## What Changes

- Add opt-in YuE2 score generation through the existing Modal deployment.
- Validate YuE2 ABC and place its two melodies as editable Clips in one undoable Producer batch.
- Return the score's tempo, meter, and harmonic events with the tool result.
- Preserve the source ABC, key and meter changes, section boundaries, and chord symbols in the draft and display imported harmony on the timeline.
- Expose YuE2 full-song rendering to Producer and import the stereo result as an audio Clip.

## Capabilities

### New Capabilities

- `producer-score-planning` covers generating and importing editable melodies.

### Modified Capabilities

None.

## Impact

Touches the provider, asset storage, and server command staging boundaries. Rendering uses the YuE2 style and lyrics inputs. Reverse conversion of edited project notes and Next.js hosting are outside the scope.
