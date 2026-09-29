import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * Returns a callback whose identity never changes but which always calls the
 * latest function it was given.
 *
 * <p>This exists to make an effect's dependency list honest *and* stable at
 * the same time. `LiveVideo`'s camera/peer-connection effect depends on a
 * chain of callbacks, and today it is safe only because every caller happens
 * to wrap its handlers in `useCallback`. A single inline arrow passed from a
 * parent would restart the camera and the peer connection on every parent
 * render. Latching the function in a ref converts that from a rule everyone
 * has to remember into something structurally impossible.
 *
 * <p>The alternative — suppressing `react-hooks/exhaustive-deps` and omitting
 * the callbacks from the dependency list — would hide the same hazard behind a
 * lie about what the effect reads. This keeps the list truthful.
 *
 * <p>The ref is written in `useInsertionEffect` rather than during render or
 * in a layout effect: it is the earliest commit-phase hook, so the latest
 * function is installed before any other effect in the same commit can invoke
 * it. Writing during render would be unsafe under concurrent rendering, where
 * a render can be discarded.
 *
 * <p>Do not call the returned function during render. It is for event
 * handlers and effects, where the latest committed value is what is wanted.
 */
export function useEventCallback<Args extends unknown[], Result>(
  callback: ((...args: Args) => Result) | undefined,
): (...args: Args) => Result | undefined {
  const ref = useRef<((...args: Args) => Result) | undefined>(callback);

  useInsertionEffect(() => {
    ref.current = callback;
  }, [callback]);

  return useCallback((...args: Args) => ref.current?.(...args), []);
}
