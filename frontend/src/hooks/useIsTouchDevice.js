// frontend/src/hooks/useIsTouchDevice.js
// (a) The `typeof window.matchMedia === 'function'` guard is NOT redundant:
// this repo's jsdom test environment has no global `matchMedia` mock, and
// this hook is now used by TerminalShortcutsFab.jsx, which mounts unmocked
// in AppV2.test.jsx — without the guard, that test file would throw instead
// of the fab just rendering null.
// (b) Deliberately one-shot: computed once in useEffect, with no `change`
// listener, unlike the sibling useMediaQuery.js which does subscribe to
// changes. This preserves exact parity with the original inline detection
// logic in IpadToolbar.jsx — a device's pointer/touch capability essentially
// never changes at runtime, so reactivity isn't needed here.
import { useEffect, useState } from 'react';

export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const coarse = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    const hasTouch = 'ontouchstart' in window;
    setIsTouch(coarse || hasTouch);
  }, []);

  return isTouch;
}
