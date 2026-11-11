import {expect,it} from 'vitest';
import {audioActionMessage,clipAudioActions} from './audio-context-actions';
it('offers conversions and voice tools only on applicable Clip types',()=>{
  expect(clipAudioActions(true,false)).toEqual(['render','variation','generate','sound','speech']);
  expect(clipAudioActions(true,true)).toContain('transcribe');
  expect(clipAudioActions(true,true)).toEqual(expect.arrayContaining(['voice_conversion','isolate','recognize','align','variation']));
  expect(clipAudioActions(false,false)).toEqual(['generate','sound','speech']);
});
it('preserves user style instructions and requests actual reference conditioning',()=>{
  const message=audioActionMessage('variation','换成爵士吉他，保留节奏');
  expect(message).toContain('reference_only=true');expect(message).toContain('换成爵士吉他，保留节奏');
  expect(audioActionMessage('align','')).toContain('ask me for it');
});
