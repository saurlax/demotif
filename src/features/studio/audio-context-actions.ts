export const audioActions = {
  render:{label:'Convert to Sound',prompt:'Convert the selected Clip to Sound using its current notes, instrument, sampler and effects. Use render_clip for faithful rendering. Keep the original and add the result at the selected position.'},
  variation:{label:'Change sound / style',prompt:'Create a musical Sound variation of the selected Clip. Infer a suitable style from its current instrument, notes and sample settings. Use its actual audio as a reference: render note Clips first with reference_only=true, then use a supported reference model. Keep the original and add the result at the same position. Explain that a generated interpretation may change notes.'},
  transcribe:{label:'Convert to Notes',prompt:'Convert the selected audio Clip to editable notes using local audio-to-notes analysis. Infer pitched or percussion analysis from the available context. Preserve the original audio and stage the notes on a muted track. If the selected range exceeds 30 seconds, ask which excerpt to analyze.'},
  voice_conversion:{label:'Change voice',prompt:'Change the voice of the selected audio Clip with a supported voice-conversion model. Choose a suitable accessible voice from its named catalog, keep the original, and add the result at the same position.'},
  isolate:{label:'Clean up voice',prompt:'Remove background noise from the selected speech/audio Clip using voice isolation. Keep the original and propose the cleaned result. This is speech cleanup, not full music stem separation.'},
  recognize:{label:'Transcribe speech',prompt:'Transcribe the speech in the selected audio Clip and return its text and word timings. Do not convert speech to musical notes.'},
  align:{label:'Align text to audio',prompt:'Align supplied text or lyrics to the selected audio Clip. If the text is not available in this conversation or selection, ask me for it before calling alignment. Return timing information without changing the original.'},
  generate:{label:'Generate Sound here',prompt:'Generate a new musical Sound at the selected location. Choose a sensible instrument and style from the project context, keep existing material, and place it in the draft.'},
  sound:{label:'Generate One Shot / Loop here',prompt:'Generate a short sound effect or musical sample at the selected location. Infer One Shot or seamless Loop from my instructions and project context; choose a sensible default when unspecified. Place it in the draft.'},
  speech:{label:'Generate speech here',prompt:'Generate spoken audio at the selected location. If no words have been supplied in this message or conversation, ask for the text first. Choose a suitable named voice and add the result for review.'},
} as const;
export type AudioAction=keyof typeof audioActions;
export function clipAudioActions(hasClip:boolean,isAudio:boolean):AudioAction[]{
  return [...(hasClip?(isAudio?['transcribe','variation','voice_conversion','isolate','recognize','align'] as const:['render','variation'] as const):[]),'generate','sound','speech'];
}
export function audioActionMessage(action:AudioAction,draft:string){return audioActions[action].prompt+(draft.trim()?`\nAdditional instructions: ${draft.trim()}`:'');}
