import type { Tip } from '@local-events/contracts';

import { foundTipClock, foundTipDay } from '@/lib/tip-clock';

import { DateAsk } from './date-ask';
import { EndAsk } from './end-ask';
import { LinkAsk } from './link-ask';
import { PriceAsk } from './price-ask';
import { TextAsk } from './text-ask';
import { TimeAsk } from './time-ask';

type AskKey = NonNullable<Tip['messages'][number]['key']>;

export function AskControl({
  askKey,
  options,
  answer,
  locked,
  locale,
  startsAt,
  endsAt,
  title,
  place,
  priceLabel,
  link,
  description,
  onSend,
  onEdit,
  warning,
  onDismissWarning,
}: {
  askKey: AskKey;
  options: Tip['messages'][number]['options'];
  answer: string | null;
  locked: boolean;
  locale: string;
  startsAt: string | null;
  endsAt: string | null;
  title: string | null;
  place: string | null;
  priceLabel: string | null;
  link: string | null;
  description: string | null;
  onSend: (body: string) => void;
  onEdit: () => void;
  warning: string | null;
  onDismissWarning: () => void;
}) {
  const startDay = foundTipDay(startsAt);
  const endDay = foundTipDay(endsAt) ?? startDay;
  const startClock = foundTipClock(startsAt);
  const endClock = foundTipClock(endsAt) ?? startClock;
  if (askKey === 'link') {
    return (
      <LinkAsk
        options={options}
        seed={link}
        answer={answer}
        locked={locked}
        onSend={onSend}
        onEdit={onEdit}
      />
    );
  }
  if (askKey === 'price') {
    return (
      <PriceAsk
        options={options}
        seed={priceLabel}
        answer={answer}
        locked={locked}
        onSend={onSend}
        onEdit={onEdit}
      />
    );
  }
  if (askKey === 'startDate' || askKey === 'date') {
    return (
      <DateAsk
        prefix={askKey === 'date' ? 'date' : 'startDate'}
        options={options}
        answer={answer}
        locked={locked}
        locale={locale}
        seedDay={startDay}
        onSend={onSend}
        onEdit={onEdit}
      />
    );
  }
  if (askKey === 'endDate') {
    return (
      <DateAsk
        prefix="endDate"
        options={options}
        answer={answer}
        locked={locked}
        locale={locale}
        seedDay={endDay}
        onSend={onSend}
        onEdit={onEdit}
      />
    );
  }
  if (askKey === 'startTime' || askKey === 'endTime') {
    return (
      <TimeAsk
        prefix={askKey}
        options={options}
        answer={answer}
        locked={locked}
        seedClock={askKey === 'endTime' ? endClock : startClock}
        onSend={onSend}
        onEdit={onEdit}
      />
    );
  }
  if (askKey === 'end') {
    return (
      <EndAsk
        options={options}
        answer={answer}
        locked={locked}
        locale={locale}
        seedDay={endDay}
        seedClock={endClock}
        onSend={onSend}
        onEdit={onEdit}
      />
    );
  }
  return (
    <TextAsk
      prefix={
        askKey === 'title' || askKey === 'place' || askKey === 'description' ? askKey : undefined
      }
      icon={askKey === 'place' ? 'place' : undefined}
      options={options}
      seed={askKey === 'title' ? title : askKey === 'place' ? place : description}
      answer={answer}
      locked={locked}
      onSend={onSend}
      onEdit={onEdit}
      warning={warning}
      onDismissWarning={onDismissWarning}
    />
  );
}
