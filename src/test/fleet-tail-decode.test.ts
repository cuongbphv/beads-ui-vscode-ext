import { describe, expect, it } from 'vitest';

import { decodeUtf8Chunk, trimPartialFirstLine } from '../extension/fleet/lib/tail-decode';

describe('decodeUtf8Chunk', () => {
  it('reassembles a UTF-8 character whose bytes are split across a chunk boundary', () => {
    // "€" (U+20AC) is 3 bytes in UTF-8: E2 82 AC. Split it right in the
    // middle of the sequence, as a fixed-size file read would if the
    // boundary happened to land there.
    const full = new TextEncoder().encode('a€b');
    expect(Array.from(full)).toEqual([0x61, 0xe2, 0x82, 0xac, 0x62]);

    const firstChunk = full.subarray(0, 2); // "a" + first byte of "€"
    const secondChunk = full.subarray(2); // remaining 2 bytes of "€" + "b"

    const step1 = decodeUtf8Chunk(new Uint8Array(0), firstChunk);
    expect(step1.text).toBe('a'); // the incomplete "€" prefix must not appear yet
    expect(step1.carry.length).toBe(1);

    const step2 = decodeUtf8Chunk(step1.carry, secondChunk);
    expect(step2.text).toBe('€b');
    expect(step2.carry.length).toBe(0);

    expect(step1.text + step2.text).toBe('a€b');
  });

  it('handles a character split across three consecutive chunks', () => {
    const full = new TextEncoder().encode('€'); // E2 82 AC
    let carry: Uint8Array = new Uint8Array(0);
    let text = '';
    for (const byte of full) {
      const step = decodeUtf8Chunk(carry, new Uint8Array([byte]));
      text += step.text;
      carry = step.carry;
    }
    expect(text).toBe('€');
    expect(carry.length).toBe(0);
  });

  it('decodes ASCII with no carry when nothing is split', () => {
    const step = decodeUtf8Chunk(new Uint8Array(0), new TextEncoder().encode('hello'));
    expect(step.text).toBe('hello');
    expect(step.carry.length).toBe(0);
  });

  it('never throws on an empty chunk', () => {
    expect(() => decodeUtf8Chunk(new Uint8Array(0), new Uint8Array(0))).not.toThrow();
    expect(decodeUtf8Chunk(new Uint8Array(0), new Uint8Array(0))).toEqual({ text: '', carry: new Uint8Array(0) });
  });
});

describe('trimPartialFirstLine', () => {
  it('drops everything up to and including the first newline', () => {
    expect(trimPartialFirstLine('partial-head\ncomplete line one\ncomplete line two')).toBe(
      'complete line one\ncomplete line two',
    );
  });

  it('returns an empty string when there is no newline at all', () => {
    expect(trimPartialFirstLine('one giant partial line with no newline')).toBe('');
  });
});
