import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type AnimatedRef,
} from 'react-native-reanimated';

import { space } from '@/theme/tokens';

type ScrollRef = AnimatedRef<Animated.ScrollView>;

export const ChatScroll = createContext<ScrollRef | null>(null);

const EASE = Easing.bezier(0.23, 1, 0.32, 1);
const GROW_MS = 280;
const FADE_MS = 200;
const STEP_MS = 160;

/** Grows a gap, then fades each new piece in. Later pieces wait for the one before. */
export function ChatArrival({
  pieces,
  reserve = false,
}: {
  pieces: ReactNode[];
  /** Hold the full height in the scroll layout while the clip is still opening. */
  reserve?: boolean;
}) {
  const scrollRef = useContext(ChatScroll);
  const latest = useRef(pieces);
  latest.current = pieces;
  const shown = useRef(0);
  const [batches, setBatches] = useState<Array<[number, number]>>([]);

  useEffect(() => {
    const all = latest.current;
    if (all.length <= shown.current) return;
    const start = shown.current;
    shown.current = all.length;
    setBatches((current) => [...current, [start, all.length]]);
  }, [pieces.length]);

  return (
    <>
      {batches.map(([start, end], index) => (
        <GrowFade
          key={index}
          pieces={pieces.slice(start, end)}
          scrollRef={scrollRef}
          reserve={reserve}
        />
      ))}
    </>
  );
}

function GrowFade({
  pieces,
  scrollRef,
  reserve,
}: {
  pieces: ReactNode[];
  scrollRef: ScrollRef | null;
  reserve: boolean;
}) {
  const reduced = useReducedMotion();
  const [measured, setMeasured] = useState(0);
  const [grown, setGrown] = useState(false);
  const measuredRef = useRef(0);
  const height = useSharedValue(0);
  const frame = useAnimatedStyle(() => ({ height: height.value }));

  useAnimatedReaction(
    () => height.value,
    (current, previous) => {
      if (!scrollRef || previous == null || current === previous) return;
      scrollTo(scrollRef, 0, 1_000_000, false);
    },
  );

  useEffect(() => {
    if (measured <= 0 || grown) return;
    height.value = withTiming(
      measured,
      { duration: reduced ? 0 : GROW_MS, easing: EASE },
      (finished) => {
        if (finished) runOnJS(setGrown)(true);
      },
    );
  }, [grown, height, measured, reduced]);

  function note(next: number) {
    if (next <= measuredRef.current) return;
    measuredRef.current = next;
    setMeasured(next);
  }

  const revealed = (
    <View style={{ gap: space.md, flexShrink: 0 }}>
      {pieces.map((piece, index) => (
        <Animated.View
          key={index}
          entering={
            reduced
              ? FadeIn.duration(80)
              : FadeIn.duration(FADE_MS)
                  .delay(index * STEP_MS)
                  .easing(EASE)
          }
        >
          {piece}
        </Animated.View>
      ))}
    </View>
  );

  // After the clip opens, drop the animated height. A later "No" adds controls
  // inside this block; a stuck animated height keeps them out of the scroll range.
  return (
    <View
      collapsable={false}
      style={
        !grown && reserve && measured > 0
          ? { height: measured, overflow: 'visible' }
          : { overflow: 'visible' }
      }
    >
      {grown ? null : (
        <View
          collapsable={false}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', left: 0, right: 0, opacity: 0 }}
          onLayout={(event) => note(Math.ceil(event.nativeEvent.layout.height))}
        >
          <View style={{ gap: space.md }}>{pieces}</View>
        </View>
      )}
      {grown ? revealed : <Animated.View style={[{ overflow: 'hidden' }, frame]} />}
    </View>
  );
}

/** A block that was hidden and then opened, such as the picker after Nej. */
export function LateReveal({ open, children }: { open: boolean; children: ReactNode }) {
  const initial = useRef(open);
  if (!open) return null;
  if (initial.current) return children;
  return <ChatArrival pieces={[children]} reserve />;
}
