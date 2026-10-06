/**
 * The connectors that can serve the voice capability, in the order a
 * workspace's connection is looked for. The one list that names them: a new
 * text-to-speech connector is one line here and its own module.
 */

import type { VoiceConnector } from './provider';
import { elevenLabsVoiceConnector } from './elevenlabs';

export const VOICE_CONNECTORS: readonly VoiceConnector[] = [elevenLabsVoiceConnector];
