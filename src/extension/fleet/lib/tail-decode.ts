/**
 * Byte-level helpers for tailing a transcript file (P4's `TranscriptTailer`):
 * decoding a chunk of bytes read mid-stream without corrupting a UTF-8
 * character that a chunk boundary happens to split, and trimming a
 * fixed-size byte window down to whole lines.
 *
 * Both are pure: given the same bytes they return the same result, with no
 * file or process I/O and no throwing.
 */

/**
 * Decode `chunk`, carrying forward any trailing bytes that are an incomplete
 * UTF-8 sequence to be prepended to the *next* chunk instead of decoded now.
 *
 * `carry` is the leftover from the previous call (start with an empty
 * `Uint8Array` for the first chunk of a stream). The returned `carry` is
 * always the tail of the *combined* bytes, so a character split across many
 * chunks in a row still reassembles correctly.
 */
export function decodeUtf8Chunk(carry: Uint8Array, chunk: Uint8Array): { text: string; carry: Uint8Array } {
  const combined = new Uint8Array(carry.length + chunk.length);
  combined.set(carry, 0);
  combined.set(chunk, carry.length);

  const splitAt = incompleteSequenceStart(combined);
  const decodable = combined.subarray(0, splitAt);
  const nextCarry = combined.subarray(splitAt);

  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(decodable),
    carry: new Uint8Array(nextCarry),
  };
}

/** How many bytes a UTF-8 sequence starting with `leadByte` should have. */
function utf8SequenceLength(leadByte: number): number {
  if ((leadByte & 0x80) === 0x00) return 1;
  if ((leadByte & 0xe0) === 0xc0) return 2;
  if ((leadByte & 0xf0) === 0xe0) return 3;
  if ((leadByte & 0xf8) === 0xf0) return 4;
  return 1; // Not a valid lead byte; treat as its own (invalid) unit.
}

/**
 * Index at which `bytes` should be split so everything before it is
 * decodable now, and everything from it on is (possibly) an incomplete
 * trailing sequence to carry into the next chunk.
 */
function incompleteSequenceStart(bytes: Uint8Array): number {
  const maxLookback = Math.min(4, bytes.length);

  for (let back = 1; back <= maxLookback; back++) {
    const index = bytes.length - back;
    const byte = bytes[index];
    if ((byte & 0xc0) === 0x80) continue; // continuation byte — keep scanning back

    const needed = utf8SequenceLength(byte);
    return needed > back ? index : bytes.length;
  }

  return bytes.length;
}

/**
 * Drop everything up to and including the first newline. Used to trim a
 * fixed-size byte window read from the middle of a file (the tailer's 256KB
 * backfill), whose first line is very likely a partial one.
 *
 * Returns an empty string when no newline is present — the whole window was
 * one partial line, so none of it is a complete line to show.
 */
export function trimPartialFirstLine(text: string): string {
  const index = text.indexOf('\n');
  return index === -1 ? '' : text.slice(index + 1);
}
