import type { UserPreferencesResponse } from '@local-events/contracts';
import { areaNotificationsEnabled } from '@local-events/domain';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Host, Slider } from '@expo/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
  type PressableProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CenteredSwitch } from '@/components/native/centered-switch';
import { accentSliderTint } from '@/components/native/location-menu-modifiers';
import { AppText } from '@/components/ui/app-text';
import { BackPill } from '@/components/ui/back-pill';
import { PrimaryButton } from '@/components/ui/primary-button';
import { TagGroupList } from '@/components/ui/tag-group-list';
import { setDiscoveryRadiusForPlace } from '@/lib/discovery-radius-store';
import { DISCOVERY_RADIUS_STOPS_M, resolveDiscoveryRadiusM } from '@/lib/discovery-radius';
import { listTags } from '@/lib/events';
import { ensureIdentity, type StoredIdentity } from '@/lib/identity';
import type { HomeTag } from '@/lib/tag-groups';
import { deleteArea, getPreferences, updateSavedArea } from '@/lib/preferences';
import {
  getDiscoveryPlaceId,
  NEARBY_PLACE_ID,
  setDiscoveryPlaceId,
} from '@/lib/use-discovery-point';
import { colors } from '@/theme/colors';
import { radius, space } from '@/theme/tokens';

const STOPS_KM = DISCOVERY_RADIUS_STOPS_M.map((meters) => meters / 1_000);
const LAST_INDEX = STOPS_KM.length - 1;

function indexForMeters(meters: number | null | undefined): number {
  const snapped = resolveDiscoveryRadiusM(meters);
  const index = DISCOVERY_RADIUS_STOPS_M.indexOf(snapped);
  return index === -1 ? 0 : index;
}

function RadiusSlider({
  title,
  hint,
  index,
  onChange,
  width,
}: {
  title: string;
  hint: string;
  index: number;
  onChange: (index: number) => void;
  width: number;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={{
        gap: space.sm,
        marginHorizontal: space.xl,
        padding: space.lg,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
      }}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}
      >
        <AppText variant="subtitle">{title}</AppText>
        <AppText variant="subtitle" style={{ fontWeight: '700' }}>
          {t('preferences.radiusKm', { km: STOPS_KM[index] })}
        </AppText>
      </View>
      <AppText variant="caption">{hint}</AppText>
      <Host style={{ width: width - space.lg * 2, height: 36 }}>
        <Slider
          value={index}
          min={0}
          max={LAST_INDEX}
          step={1}
          modifiers={accentSliderTint()}
          onValueChange={(next) => {
            onChange(Math.min(LAST_INDEX, Math.max(0, Math.round(next))));
          }}
        />
      </Host>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="caption">{t('preferences.radiusKm', { km: 0 })}</AppText>
        <AppText variant="caption">{t('preferences.radiusKm', { km: 100 })}</AppText>
      </View>
    </View>
  );
}

const NAME_FIELD_HEIGHT = 52;

function RoundIconButton({
  label,
  sf,
  md,
  tint,
  backgroundColor,
  borderColor,
  onPress,
  onPressIn,
  decorative = false,
}: {
  label: string;
  sf: string;
  md: keyof typeof MaterialIcons.glyphMap;
  tint: string;
  backgroundColor: string;
  borderColor?: string;
  onPress: () => void;
  onPressIn?: PressableProps['onPressIn'];
  /** Same action as a neighboring control, so it stays out of the accessibility tree. */
  decorative?: boolean;
}) {
  return (
    <Pressable
      accessible={!decorative}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      accessibilityRole={decorative ? undefined : 'button'}
      accessibilityLabel={decorative ? undefined : label}
      onPressIn={onPressIn}
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor,
        borderWidth: borderColor ? 1 : 0,
        borderColor,
      }}
    >
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name={sf as never} size={18} tintColor={tint} weight="semibold" />
      ) : (
        <MaterialIcons name={md} size={20} color={tint} />
      )}
    </Pressable>
  );
}

function SettingSwitch({
  title,
  hint,
  value,
  disabled = false,
  onValueChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.md,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="subtitle">{title}</AppText>
        <AppText variant="caption">{hint}</AppText>
      </View>
      <CenteredSwitch value={value} disabled={disabled} onValueChange={onValueChange} />
    </View>
  );
}

function AreaEditor({
  area,
  identity,
  tags,
  sliderWidth,
}: {
  area: UserPreferencesResponse['areas'][number];
  identity: StoredIdentity;
  tags: HomeTag[];
  sliderWidth: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const nameRef = useRef<TextInput>(null);
  const nameBeforeEdit = useRef(area.name);
  const nameAction = useRef<'commit' | 'cancel' | null>(null);
  const [name, setName] = useState(area.name);
  const [editingName, setEditingName] = useState(false);
  const [tagIds, setTagIds] = useState(area.tagIds);
  const [notify, setNotify] = useState(() => areaNotificationsEnabled(area));
  const [searchIndex, setSearchIndex] = useState(() =>
    indexForMeters(area.searchRadiusM ?? area.radiusM),
  );
  const [notifyIndex, setNotifyIndex] = useState(() => indexForMeters(area.radiusM));
  const [active, setActive] = useState(area.active);
  const notificationsOn = areaNotificationsEnabled({ notify, tagIds });
  const circle = area.center != null && area.radiusM != null;

  const save = useMutation({
    mutationFn: async () => {
      const searchRadiusM = DISCOVERY_RADIUS_STOPS_M[searchIndex] ?? DISCOVERY_RADIUS_STOPS_M[0]!;
      const notifyRadiusM = DISCOVERY_RADIUS_STOPS_M[notifyIndex] ?? DISCOVERY_RADIUS_STOPS_M[0]!;
      return updateSavedArea(identity, area.id, {
        name: name.trim(),
        tagIds,
        searchRadiusM,
        notify: notificationsOn,
        active,
        ...(notificationsOn && circle && area.center
          ? { center: area.center, radiusM: notifyRadiusM }
          : {}),
      });
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData<UserPreferencesResponse>(
        ['preferences', identity.userId],
        (current) => {
          if (!current) return current;
          return {
            ...current,
            areas: current.areas.map((item) => (item.id === updated.id ? updated : item)),
          };
        },
      );
      if (updated.searchRadiusM != null) {
        void setDiscoveryRadiusForPlace(updated.id, updated.searchRadiusM);
      }
      router.back();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await deleteArea(identity, area.id);
    },
    onSuccess: async () => {
      if (getDiscoveryPlaceId() === area.id) setDiscoveryPlaceId(NEARBY_PLACE_ID);
      router.back();
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });

  function confirmDelete() {
    Alert.alert(t('profile.areaDeleteTitle'), t('profile.areaDeleteMessage', { name: area.name }), [
      { text: t('preferences.resetCancel'), style: 'cancel' },
      {
        text: t('profile.areaDelete'),
        style: 'destructive',
        onPress: () => {
          remove.mutate();
        },
      },
    ]);
  }

  useEffect(() => {
    if (editingName) nameRef.current?.focus();
  }, [editingName]);

  function startNameEdit() {
    nameBeforeEdit.current = name;
    nameAction.current = null;
    setEditingName(true);
  }

  function commitNameEdit() {
    nameAction.current = 'commit';
    const trimmed = name.trim();
    setName(trimmed.length > 0 ? trimmed : nameBeforeEdit.current);
    setEditingName(false);
    nameRef.current?.blur();
  }

  function revertNameEdit() {
    nameAction.current = 'cancel';
    setName(nameBeforeEdit.current);
    setEditingName(false);
    nameRef.current?.blur();
  }

  function blurNameEdit() {
    setTimeout(() => {
      if (nameAction.current === 'commit') return;
      setName(nameBeforeEdit.current);
      setEditingName(false);
    }, 0);
  }

  const busy = save.isPending || remove.isPending;
  const canSave = name.trim().length > 0 && name.trim().length <= 80 && !busy;

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.xl,
        }}
      >
        {editingName ? (
          <TextInput
            ref={nameRef}
            value={name}
            onChangeText={setName}
            placeholder={t('profile.areaNamePlaceholder')}
            placeholderTextColor={colors.inkFaint}
            maxLength={80}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={commitNameEdit}
            onBlur={blurNameEdit}
            style={{
              flex: 1,
              minHeight: NAME_FIELD_HEIGHT,
              paddingHorizontal: space.lg,
              backgroundColor: colors.card,
              borderRadius: radius.lg,
              borderCurve: 'continuous',
              borderWidth: 1.5,
              borderColor: colors.accent,
              paddingVertical: 0,
              textAlignVertical: 'center',
              fontSize: 16,
              color: colors.ink,
            }}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.areaEditA11y', { name })}
            onPress={startNameEdit}
            style={{
              flex: 1,
              minHeight: NAME_FIELD_HEIGHT,
              paddingHorizontal: space.lg,
              justifyContent: 'center',
              backgroundColor: colors.card,
              borderRadius: radius.lg,
              borderCurve: 'continuous',
              borderWidth: 1.5,
              borderColor: colors.card,
            }}
          >
            <AppText variant="body" numberOfLines={1}>
              {name}
            </AppText>
          </Pressable>
        )}
        {editingName ? (
          <>
            <RoundIconButton
              label={t('profile.areaNameDone')}
              sf="checkmark"
              md="check"
              tint={colors.primary}
              backgroundColor={colors.accent}
              onPressIn={() => {
                nameAction.current = 'commit';
              }}
              onPress={commitNameEdit}
            />
            <RoundIconButton
              label={t('profile.areaNameCancel')}
              sf="xmark"
              md="close"
              tint={colors.ink}
              backgroundColor={colors.card}
              borderColor={colors.line}
              onPressIn={() => {
                nameAction.current = 'cancel';
              }}
              onPress={revertNameEdit}
            />
          </>
        ) : (
          <RoundIconButton
            label={t('profile.areaEditName')}
            sf="pencil"
            md="edit"
            tint={colors.ink}
            backgroundColor={colors.accentSoft}
            decorative
            onPress={startNameEdit}
          />
        )}
      </View>

      <RadiusSlider
        title={t('events.searchRadius')}
        hint={t('events.searchRadiusHint')}
        index={searchIndex}
        onChange={setSearchIndex}
        width={sliderWidth}
      />

      <View style={{ gap: space.md, paddingHorizontal: space.xl }}>
        <TagGroupList
          showHeading={true}
          tags={tags}
          selectedIds={tagIds}
          onChange={(ids) => {
            setTagIds(ids);
            if (ids.length === 0) setNotify(false);
          }}
        />
        <AppText variant="caption">{t('profile.areaTagsHint')}</AppText>
      </View>

      <View
        style={{
          gap: space.lg,
          marginHorizontal: space.xl,
          padding: space.lg,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
        }}
      >
        <SettingSwitch
          title={t('profile.areaActive')}
          hint={t('profile.areaActiveHint')}
          value={active}
          onValueChange={setActive}
        />
        <SettingSwitch
          title={t('profile.areaNotify')}
          hint={t(tagIds.length === 0 ? 'profile.areaNotifyNeedsTags' : 'profile.areaNotifyHint')}
          value={notificationsOn}
          disabled={tagIds.length === 0}
          onValueChange={setNotify}
        />
      </View>

      {notificationsOn && circle ? (
        <RadiusSlider
          title={t('profile.areaNotifyRadius')}
          hint={t('profile.areaNotifyRadiusHint')}
          index={notifyIndex}
          onChange={setNotifyIndex}
          width={sliderWidth}
        />
      ) : null}
      {notificationsOn && !circle ? (
        <AppText variant="caption" style={{ paddingHorizontal: space.xl }}>
          {t('profile.areaNotifyShape')}
        </AppText>
      ) : null}

      {save.isError ? (
        <AppText variant="caption" style={{ color: colors.danger, paddingHorizontal: space.xl }}>
          {t('profile.areaSaveError')}
        </AppText>
      ) : null}
      <View style={{ paddingHorizontal: space.xl }}>
        <PrimaryButton
          label={t('profile.areaSave')}
          loading={save.isPending}
          disabled={!canSave}
          onPress={() => {
            if (editingName) {
              const trimmed = name.trim();
              nameAction.current = 'commit';
              setName(trimmed.length > 0 ? trimmed : nameBeforeEdit.current);
              setEditingName(false);
            }
            save.mutate();
          }}
        />
      </View>

      <View style={{ gap: space.md, paddingHorizontal: space.xl, paddingTop: space.lg }}>
        <AppText variant="caption">{t('profile.areaDeleteNote')}</AppText>
        {remove.isError ? (
          <AppText variant="caption" style={{ color: colors.danger }}>
            {t('profile.areaDeleteError')}
          </AppText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.areaDelete')}
          disabled={busy}
          onPress={confirmDelete}
          style={{
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.xl,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: colors.danger,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <AppText variant="subtitle" style={{ color: colors.danger, fontWeight: '700' }}>
            {t('profile.areaDelete')}
          </AppText>
        </Pressable>
      </View>
    </>
  );
}

export default function EditSavedAreaScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string }>();
  const areaId = Array.isArray(params.id) ? params.id[0] : params.id;
  const sliderWidth = width - space.xl * 2;

  const identity = useQuery({
    queryKey: ['identity', locale],
    queryFn: () => ensureIdentity(locale),
  });
  const preferences = useQuery({
    queryKey: ['preferences', identity.data?.userId],
    enabled: identity.isSuccess,
    queryFn: () => getPreferences(identity.data!),
  });
  const tags = useQuery({
    queryKey: ['tags', 'all'],
    queryFn: () => listTags({ upcoming: false }),
  });

  const area = preferences.data?.areas.find((item) => item.id === areaId);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md }}>
        <BackPill />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ gap: space.xl, paddingBottom: insets.bottom + space.xxxl }}
      >
        {identity.isError || preferences.isError ? (
          <AppText variant="caption" style={{ color: colors.danger, paddingHorizontal: space.xl }}>
            {t('profile.areasLoadError')}
          </AppText>
        ) : null}
        {preferences.isSuccess && !area ? (
          <AppText variant="caption" style={{ paddingHorizontal: space.xl }}>
            {t('profile.areaMissing')}
          </AppText>
        ) : null}
        {area && identity.data ? (
          <AreaEditor
            key={area.id}
            area={area}
            identity={identity.data}
            tags={tags.data?.items ?? []}
            sliderWidth={sliderWidth}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
