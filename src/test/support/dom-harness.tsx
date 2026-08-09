/**
 * The browser APIs jsdom does not implement, in the smallest form the webview
 * suites actually need.
 *
 * `.tsx` rather than `.ts` on purpose: the root tsconfig compiles
 * `src/test/**\/*.ts` with an ES2023 lib and no DOM, so a DOM-typed helper has
 * to sit outside that glob and be reached only from the `.test.tsx` suites the
 * webview tsconfig owns.
 */

/** A `ResizeObserver` whose callbacks fire when the test says so, not the layout engine. */
export class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  /** Report `width` for `target`, as the real observer would after a relayout. */
  emit(target: Element, width: number): void {
    this.callback(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, width, 0),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this,
    );
  }

  /** The observer and element behind the first observation matching `match`. */
  static observationOf(
    match: (target: Element) => boolean,
  ): { observer: TestResizeObserver; target: Element } | undefined {
    return TestResizeObserver.instances
      .flatMap((observer) => [...observer.observed].map((target) => ({ observer, target })))
      .find(({ target }) => match(target));
  }
}

export function installResizeObserver(): void {
  TestResizeObserver.instances.length = 0;
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  });
}

const capturedPointers = new WeakMap<Element, Set<number>>();

/**
 * Pointer capture, which jsdom leaves unimplemented.
 *
 * Every drag in this codebase guards its move handler on `hasPointerCapture`,
 * so without this a `pointermove` is indistinguishable from a capture that was
 * stolen and nothing under test would ever move.
 */
export function installPointerCapture(): void {
  Element.prototype.setPointerCapture = function (this: Element, pointerId: number): void {
    const ids = capturedPointers.get(this) ?? new Set<number>();
    ids.add(pointerId);
    capturedPointers.set(this, ids);
  };
  Element.prototype.releasePointerCapture = function (this: Element, pointerId: number): void {
    capturedPointers.get(this)?.delete(pointerId);
  };
  Element.prototype.hasPointerCapture = function (this: Element, pointerId: number): boolean {
    return capturedPointers.get(this)?.has(pointerId) ?? false;
  };
}

/**
 * A pointer event jsdom will dispatch and React will read.
 *
 * jsdom has no `PointerEvent` constructor; React only reads properties off the
 * native event, so a `MouseEvent` carrying a `pointerId` is indistinguishable
 * to everything under test. `lostpointercapture` bubbles in the Pointer Events
 * spec, so the default here matches a real browser.
 */
export function pointerEvent(
  type: string,
  init: { clientX?: number; pointerId?: number; button?: number } = {},
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  return event;
}

/**
 * The browser revoking a capture it granted.
 *
 * Order matters and is the spec's: capture is already gone by the time
 * `lostpointercapture` is delivered, so a handler cannot tell the difference
 * between this and its own release.
 */
export function losePointerCapture(element: Element, pointerId = 1): void {
  element.releasePointerCapture(pointerId);
  element.dispatchEvent(pointerEvent('lostpointercapture', { pointerId }));
}

/**
 * jsdom reports every element as 0×0. A drag that converts pixels to time
 * divides by the measured track, so the track has to claim a width.
 */
export function stubClientWidth(element: Element, width: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
}
