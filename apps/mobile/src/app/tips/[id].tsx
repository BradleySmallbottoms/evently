import { useLocalSearchParams } from 'expo-router';

import { TipFlow } from './_components/tip-flow';

export default function TipScreen() {
  const { id, photo } = useLocalSearchParams<{ id: string; photo?: string }>();
  if (!id) return null;
  return <TipFlow id={id} photo={typeof photo === 'string' ? photo : undefined} resume />;
}
