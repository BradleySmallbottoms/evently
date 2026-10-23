import { createContext, useContext, type ReactNode } from 'react';

const OnboardingVisibleContext = createContext(false);

/** Home stays mounted under the onboarding cover. Screens read that here. */
export function OnboardingVisibleProvider({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <OnboardingVisibleContext.Provider value={visible}>
      {children}
    </OnboardingVisibleContext.Provider>
  );
}

export function useOnboardingVisible(): boolean {
  return useContext(OnboardingVisibleContext);
}
