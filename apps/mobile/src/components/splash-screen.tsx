import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Path } from 'react-native-svg';

type AppSplashProps = {
  /** Called once the intro has settled. The cover stays up until home data is ready. */
  onIntroEnd: () => void;
};

const AnimatedView = Animated.View;
const AnimatedSvg = Animated.createAnimatedComponent(Svg);

function EventlyLandscape() {
  return (
    <View pointerEvents="none" style={styles.landscape}>
      <Svg width="100%" height="100%" viewBox="0 0 400 240" preserveAspectRatio="xMidYMax slice">
        <Defs>
          <SvgGradient id="hillPeach" x1="0" y1="0" x2="0.8" y2="1">
            <Stop offset="0%" stopColor="#FFE4CA" />
            <Stop offset="100%" stopColor="#FFC69E" />
          </SvgGradient>
          <SvgGradient id="hillOrange" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#FFB17E" />
            <Stop offset="100%" stopColor="#F9825B" />
          </SvgGradient>
          <SvgGradient id="hillGreen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#9AAA91" />
            <Stop offset="100%" stopColor="#506F65" />
          </SvgGradient>
        </Defs>

        <Path
          d="M0 65 C65 82 95 128 160 135 C230 142 290 80 400 75 L400 240 L0 240 Z"
          fill="url(#hillPeach)"
        />
        <Path
          d="M0 145 C70 115 105 165 170 178 C245 195 300 130 400 145 L400 240 L0 240 Z"
          fill="url(#hillOrange)"
        />
        <Path
          d="M0 178 C75 170 125 205 205 220 C285 235 335 185 400 180 L400 240 L0 240 Z"
          fill="url(#hillGreen)"
        />
      </Svg>
    </View>
  );
}

export default function AppSplash({ onIntroEnd }: AppSplashProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const onIntroEndRef = useRef(onIntroEnd);
  useEffect(() => {
    onIntroEndRef.current = onIntroEnd;
  }, [onIntroEnd]);

  const [pinScale] = useState(() => new Animated.Value(0.55));
  const [pinOpacity] = useState(() => new Animated.Value(0));
  const [calendarScale] = useState(() => new Animated.Value(0.7));
  const [calendarOpacity] = useState(() => new Animated.Value(0));
  const [titleOpacity] = useState(() => new Animated.Value(0));
  const [titleY] = useState(() => new Animated.Value(10));
  const [dateValues] = useState(() => Array.from({ length: 6 }, () => new Animated.Value(0)));

  useEffect(() => {
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      onIntroEndRef.current();
    };

    if (reduced) {
      pinOpacity.setValue(1);
      pinScale.setValue(1);
      calendarOpacity.setValue(1);
      calendarScale.setValue(1);
      titleOpacity.setValue(1);
      titleY.setValue(0);
      for (const value of dateValues) value.setValue(1);
      finish();
      return;
    }

    const dateAnimation = Animated.stagger(
      65,
      dateValues.map((value) =>
        Animated.spring(value, {
          toValue: 1,
          damping: 12,
          stiffness: 200,
          useNativeDriver: true,
        }),
      ),
    );

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(pinOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(pinScale, {
          toValue: 1,
          damping: 9,
          stiffness: 160,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(calendarScale, {
          toValue: 1,
          damping: 11,
          stiffness: 180,
          useNativeDriver: true,
        }),
        Animated.timing(calendarOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]),
      dateAnimation,
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(titleY, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(350),
    ]);

    animation.start(({ finished }) => {
      if (finished) finish();
    });

    return () => animation.stop();
  }, [
    reduced,
    pinOpacity,
    pinScale,
    calendarOpacity,
    calendarScale,
    dateValues,
    titleOpacity,
    titleY,
  ]);

  return (
    <View pointerEvents="none" style={styles.container}>
      <EventlyLandscape />

      <View style={styles.content}>
        <AnimatedView
          style={[
            styles.illustration,
            {
              opacity: pinOpacity,
              transform: [{ scale: pinScale }],
            },
          ]}
        >
          <AnimatedSvg width={190} height={190} viewBox="0 0 100 100" style={styles.pin}>
            <Defs>
              <SvgGradient id="pinGradient" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor="#FF9463" />
                <Stop offset="55%" stopColor="#F65352" />
                <Stop offset="100%" stopColor="#D82D4C" />
              </SvgGradient>
            </Defs>
            <Path
              d="M50 98 C43 88 8 58 8 38 C8 17 26 3 50 3 C74 3 92 17 92 38 C92 58 57 88 50 98 Z"
              fill="url(#pinGradient)"
            />
          </AnimatedSvg>

          <AnimatedView
            style={[
              styles.calendar,
              {
                opacity: calendarOpacity,
                transform: [{ scale: calendarScale }],
              },
            ]}
          >
            <View style={styles.calendarHeader}>
              <View style={styles.ring} />
              <View style={styles.ring} />
            </View>

            <View style={styles.dateGrid}>
              {dateValues.map((value, index) => (
                <AnimatedView
                  key={index}
                  style={[
                    styles.date,
                    index === 4 && styles.selectedDate,
                    {
                      opacity: value,
                      transform: [
                        {
                          scale: value.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.5, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
          </AnimatedView>
        </AnimatedView>

        <AnimatedView
          style={[
            styles.brand,
            {
              opacity: titleOpacity,
              transform: [{ translateY: titleY }],
            },
          ]}
        >
          <Text style={styles.title}>{t('splash.title')}</Text>
          <Text style={styles.subtitle}>{t('splash.subtitle')}</Text>
        </AnimatedView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8F0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  landscape: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
    zIndex: 0,
  },
  content: {
    alignItems: 'center',
    zIndex: 1,
  },
  illustration: {
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  pin: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  calendar: {
    position: 'absolute',
    top: 43,
    width: 116,
    height: 102,
    borderRadius: 15,
    backgroundColor: '#FFF8F0',
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#9D293D',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  calendarHeader: {
    height: 32,
    backgroundColor: '#FFE0C9',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  ring: {
    width: 9,
    height: 23,
    borderRadius: 6,
    backgroundColor: '#302F31',
    marginTop: -12,
  },
  dateGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
    alignContent: 'space-evenly',
    paddingHorizontal: 8,
  },
  date: {
    width: 23,
    height: 21,
    borderRadius: 6,
    backgroundColor: '#E8D5C5',
    margin: 2,
  },
  selectedDate: {
    backgroundColor: '#FF6959',
  },
  brand: {
    alignItems: 'center',
  },
  title: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: '#302B2A',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 7,
    color: '#84766E',
  },
});
