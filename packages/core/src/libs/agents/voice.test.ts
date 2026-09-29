import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE, resolveVoice, voicePrompt, voiceTemperature } from './voice';

describe('an agent\'s voice', () => {
  it('is the platform voice when nothing is set', () => {
    expect(resolveVoice()).toEqual(DEFAULT_VOICE);
  });

  it('takes the YAML, then an override, key by key', () => {
    expect(resolveVoice({ length: 'brief', creativity: 0.2 }, { narration: 'off' })).toEqual({ length: 'brief', narration: 'off', creativity: 0.2 });
    expect(resolveVoice({ length: 'brief' }, { length: 'detailed' }).length).toBe('detailed');
  });

  it('ignores a layer that is not a voice', () => {
    expect(resolveVoice({ length: 'short' } as never)).toEqual(DEFAULT_VOICE);
  });

  it('says each setting to the model, and the style page when there is one', () => {
    const text = voicePrompt(resolveVoice({ length: 'brief', narration: 'off', creativity: 0.9 }), { slug: 'house-voice', content: 'We write in the second person.' });

    expect(text).toContain('Length: brief');
    expect(text).toContain('Narration: off');
    expect(text).toContain('Creativity: inventive');
    expect(text).toContain('wiki page house-voice');
    expect(text).toContain('We write in the second person.');
  });

  it('sets a temperature only where the model takes one', () => {
    expect(voiceTemperature(resolveVoice({ creativity: 0.6 }), false)).toBe(0.6);
    expect(voiceTemperature(resolveVoice({ creativity: 0.6 }), true)).toBeUndefined();
  });
});
