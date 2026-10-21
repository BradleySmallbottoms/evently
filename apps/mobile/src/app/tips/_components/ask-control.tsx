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
  onSend,
  onEdit,
}: {
  askKey: AskKey;
  options: Tip['messages'][number]['options'];
  answer: string | null;
  locked: boolean;
  locale: string;
  startsAt: string | null;
  endsAt: string | null;
  onSend: (body: string) => void;
  onEdit: () => void;
}) {
  const startDay = foundTipDay(startsAt);
  const endDay = foundTipDay(endsAt) ?? startDay;
  const startClock = foundTipClock(startsAt);
  const endClock = foundTipClock(endsAt) ?? startClock;
  if (askKey === 'link') {
    return (
      <LinkAsk options={options} answer={answer} locked={locked} onSend={onSend} onEdit={onEdit} />
    );
  }
  if (askKey === 'price') {
    return <PriceAsk answer={answer} locked={locked} onSend={onSend} onEdit={onEdit} />;
  }
  if (askKey === 'startDate' || askKey === 'date') {
    return (
      <DateAsk
        prefix={askKey === 'date' ? 'date' : 'startDate'}
        options={[]}
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
      icon={askKey === 'place' ? 'place' : undefined}
      answer={answer}
      locked={locked}
      onSend={onSend}
      onEdit={onEdit}
    />
  );
}
