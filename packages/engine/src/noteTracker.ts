/**
 * Prevents stuck / orphaned notes when a transform remaps note numbers or
 * channels, folds several input notes onto one output note, or changes its
 * mapping while a note is held (e.g. an expression pedal moves mid-note).
 *
 * Rules enforced:
 * 1. A note-off is emitted for the *exact* output that the matching note-on
 *    produced, even if the mapping would resolve differently now.
 * 2. When N input notes fold to the same output note, the output note-off is
 *    only emitted once the *last* of those input notes is released
 *    (reference counting).
 *
 * One tracker instance per transform instance per route.
 */

export interface ResolvedOutput {
  channel: number;
  note: number;
}

const key = (channel: number, note: number) => `${channel}:${note}`;

export class NoteTracker {
  /** source note key -> the output it is currently sounding. */
  private held = new Map<string, ResolvedOutput>();
  /** output note key -> how many held source notes map to it. */
  private refs = new Map<string, number>();

  /**
   * Register a source note-on resolved to `out`.
   * @returns `emit` — whether the caller should send an output note-on now
   *          (false when that output note is already sounding);
   *          `releaseFirst` — an output note-off the caller must send *before*
   *          the note-on, when the same source key was already held on a
   *          different output (retrigger while the mapping changed).
   */
  noteOn(srcChannel: number, srcNote: number, out: ResolvedOutput): {
    emit: boolean;
    releaseFirst?: ResolvedOutput;
  } {
    const k = key(srcChannel, srcNote);
    let releaseFirst: ResolvedOutput | undefined;

    const prev = this.held.get(k);
    if (prev) {
      if (prev.channel === out.channel && prev.note === out.note) {
        // Same key retriggered onto the same output: keep ref count as-is,
        // let the caller re-send the note-on (natural retrigger).
        return { emit: true };
      }
      // Mapping changed under a held key: release the old output first.
      releaseFirst = this.releaseRef(prev) ? prev : undefined;
    }

    this.held.set(k, out);
    const emit = this.acquireRef(out);
    return { emit, releaseFirst };
  }

  /**
   * Resolve a source note-off.
   * @returns the output that was sounding and whether the caller should send an
   *          output note-off now (only when the last referencing source note
   *          released), or `null` if this source note was not tracked.
   */
  noteOff(srcChannel: number, srcNote: number): { out: ResolvedOutput; emit: boolean } | null {
    const k = key(srcChannel, srcNote);
    const out = this.held.get(k);
    if (!out) return null;
    this.held.delete(k);
    return { out, emit: this.releaseRef(out) };
  }

  /** The output a held source note is currently sounding, if any. */
  outputFor(srcChannel: number, srcNote: number): ResolvedOutput | undefined {
    return this.held.get(key(srcChannel, srcNote));
  }

  /** Every output note currently sounding, for panic / all-notes-off. */
  activeOutputs(): ResolvedOutput[] {
    const seen = new Set<string>();
    const list: ResolvedOutput[] = [];
    for (const out of this.held.values()) {
      const k = key(out.channel, out.note);
      if (!seen.has(k)) {
        seen.add(k);
        list.push(out);
      }
    }
    return list;
  }

  clear(): void {
    this.held.clear();
    this.refs.clear();
  }

  private acquireRef(out: ResolvedOutput): boolean {
    const k = key(out.channel, out.note);
    const next = (this.refs.get(k) ?? 0) + 1;
    this.refs.set(k, next);
    return next === 1; // first reference -> caller should emit note-on
  }

  private releaseRef(out: ResolvedOutput): boolean {
    const k = key(out.channel, out.note);
    const next = (this.refs.get(k) ?? 1) - 1;
    if (next <= 0) {
      this.refs.delete(k);
      return true; // last reference gone -> caller should emit note-off
    }
    this.refs.set(k, next);
    return false;
  }
}
