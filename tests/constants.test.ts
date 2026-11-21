import { describe, expect, it } from 'vitest';
import { GAME_NAME, MAX_FRAME_BYTES } from '../src/shared/constants';

describe('constants', () => {
  it('names the game', () => expect(GAME_NAME).toBe('Big Little Road'));
  it('caps frames at 512 bytes', () => expect(MAX_FRAME_BYTES).toBe(512));
});
