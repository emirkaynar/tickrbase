import { useEffect, useRef, useState } from "preact/hooks";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

type Refs = {
  containerRef: { current: HTMLDivElement | null };
  chartRef: { current: IChartApi | null };
  seriesRef: { current: ISeriesApi<any> | null };
};

/** Public viewport events are evidence only while a genuine navigation gesture is active. */
export function useChartNavigation(
  id: string,
  { containerRef, chartRef, seriesRef }: Refs,
  isViewReady: () => boolean,
  resetRevision: number,
) {
  const [navigated, setNavigated] = useState(false);
  const clearGestureRef = useRef<() => void>(() => {});
  useEffect(() => {
    clearGestureRef.current();
    setNavigated(false);
  }, [resetRevision]);

  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    if (!container || !chart) return;
    let frame: number | null = null;
    let recentUntil = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    const touches = new Map<number, { x: number; y: number }>();
    let moved = false;
    const snapshot = () => {
      const series = seriesRef.current;
      if (chartRef.current !== chart || !series || !isViewReady()) return null;
      const scale = series.priceScale();
      return {
        series,
        logical: chart.timeScale().getVisibleLogicalRange(),
        price: scale.getVisibleRange(),
        automatic: scale.options().autoScale,
      };
    };
    let before = snapshot();
    const clear = () => {
      pointers.clear();
      touches.clear();
      moved = false;
      recentUntil = 0;
      before = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    clearGestureRef.current = clear;
    const changed = (
      a: { from: number; to: number } | null,
      b: { from: number; to: number } | null,
    ) =>
      a !== null &&
      b !== null &&
      (Math.abs(a.from - b.from) > 1e-4 || Math.abs(a.to - b.to) > 1e-4);
    const sample = () => {
      if (frame !== null || (!moved && performance.now() > recentUntil)) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const after = snapshot();
        if (
          before &&
          after &&
          before.series === after.series &&
          (moved || performance.now() <= recentUntil) &&
          (changed(before.logical, after.logical) ||
            (!after.automatic &&
              (before.automatic || changed(before.price, after.price))))
        ) {
          setNavigated(true);
        }
        before = after;
      });
    };
    const isCanvasInput = (event: Event) =>
      event.isTrusted && event.target instanceof HTMLCanvasElement;
    const down = (event: PointerEvent) => {
      if (!isCanvasInput(event)) {
        clear();
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!pointers.size && !touches.size) {
        before = snapshot();
        moved = false;
        recentUntil = 0;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };
    const move = (event: PointerEvent) => {
      const start = pointers.get(event.pointerId);
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 2)
        moved = true;
      if (moved) sample();
    };
    const up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (moved) {
        recentUntil = performance.now() + 250;
        sample();
      }
      if (!pointers.size && !touches.size) moved = false;
    };
    // LWC handles native touch events. Keep tracking even if the browser cancels
    // its parallel pointer stream when a touch becomes a pan/pinch.
    const touchStart = (event: TouchEvent) => {
      if (!isCanvasInput(event)) return;
      if (!touches.size && !pointers.size) {
        before = snapshot();
        moved = false;
        recentUntil = 0;
      }
      for (const touch of event.changedTouches) {
        touches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }
    };
    const touchMove = (event: TouchEvent) => {
      for (const touch of event.changedTouches) {
        const start = touches.get(touch.identifier);
        if (
          start &&
          Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 2
        )
          moved = true;
      }
      if (moved) sample();
    };
    const touchEnd = (event: TouchEvent) => {
      for (const touch of event.changedTouches)
        touches.delete(touch.identifier);
      if (moved) {
        recentUntil = performance.now() + 250;
        sample();
      }
      if (!pointers.size && !touches.size) moved = false;
    };
    const wheel = (event: WheelEvent) => {
      if (!isCanvasInput(event) || (!event.deltaX && !event.deltaY)) return;
      if (performance.now() > recentUntil) before = snapshot();
      recentUntil = performance.now() + 250;
      sample();
    };
    container.addEventListener("pointerdown", down, true);
    container.addEventListener("keydown", clear, true);
    container.addEventListener("touchstart", touchStart, {
      capture: true,
      passive: true,
    });
    container.addEventListener("touchmove", touchMove, {
      capture: true,
      passive: true,
    });
    container.addEventListener("touchend", touchEnd, true);
    container.addEventListener("touchcancel", touchEnd, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    container.addEventListener("wheel", wheel, {
      capture: true,
      passive: true,
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(sample);
    return () => {
      clear();
      clearGestureRef.current = () => {};
      container.removeEventListener("pointerdown", down, true);
      container.removeEventListener("keydown", clear, true);
      container.removeEventListener("touchstart", touchStart, true);
      container.removeEventListener("touchmove", touchMove, true);
      container.removeEventListener("touchend", touchEnd, true);
      container.removeEventListener("touchcancel", touchEnd, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      container.removeEventListener("wheel", wheel, true);
      if (chartRef.current === chart)
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(sample);
    };
  }, [id, containerRef, chartRef, seriesRef, isViewReady]);
  return navigated;
}
