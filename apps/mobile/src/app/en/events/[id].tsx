import { Redirect, useLocalSearchParams } from 'expo-router';

/** Maps web locale-prefixed share URLs onto the native event route. */
export default function EnEventDeepLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (typeof id !== 'string') return null;
  return <Redirect href={`/events/${id}`} />;
}
