import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isToken } from '@/lib/interviews/tokens';
import { slotDay, slotDayRange } from '@/lib/quroosh/guests';
import { splitTitle, WRITTEN_TITLES } from '@/lib/quroosh/guestTitles';
import { COUNTRIES, DEFAULT_COUNTRY } from '@/lib/quroosh/phones';
import { createQurooshClient, isQurooshConfigured } from '@/lib/supabase/quroosh';
import { BookingForm, type CountryOption, type SlotOption } from './BookingForm';
import {
  BODY_TEXT,
  BookedNotice,
  Highlight,
  InfoRow,
  IntroText,
  InviteColumn,
  InviteHero,
  Panel,
  type InfoItem,
} from './InvitationCard';

/** A personal link: never in a search engine. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Invitation = {
  name: string;
  role: string;
  cancelled: boolean;
  slot_id: string | null;
  starts_at: string | null;
  booked_at: string | null;
};

/** The title catalogs of both languages, which the New invitation form wrote names with. */
async function titleCatalogs() {
  const [ar, en] = await Promise.all(
    (['ar', 'en'] as const).map((locale) => getTranslations({ locale, namespace: 'quroosh.guests.new.titles' })),
  );
  return {
    /** Every written title, to split off a saved name. */
    all: [ar, en].flatMap((t) => WRITTEN_TITLES.map((key) => t(`${key}.text`))),
    /** The titles that make the Arabic invitation line feminine (كمتحدثة). */
    feminine: [ar('ustadha.text'), ar('doctor_f.text')],
  };
}

/**
 * A guest's invitation (Quroosh 0005): /quroosh/invite/<token>, no account.
 * It is built like the printed speaker card (InvitationCard, and the frame
 * in this route group's layout), one centred column:
 *
 *   the logo, "دعوة للمشاركة كمتحدث" (كمتحدثة when the saved name starts
 *   with سعادة الأستاذة or سعادة الدكتورة), the greeting, the title small
 *   with a slash and the name large in mint; then, before booking, the
 *   intro paragraph, the mint box, the info row (the days on offer,
 *   Riyadh), the VIP transport panel, and the form.
 *
 * Nothing about the session itself (topic, length): it differs per speaker.
 * The parts shown only before booking are passed to BookingForm, which drops
 * them the moment the guest has booked, so the page reads at once as it will
 * on a later visit: the hero, the info row with their day, the confirmation.
 *
 * The name is the one the managers saved, title included. When it starts
 * with one of the New invitation form's titles, the title is split off and
 * shown small above the name; otherwise the whole name is shown large. It is
 * never shortened.
 *
 * The token is the only key; the Quroosh database's `invitation()` answers
 * with this guest's name and booking, and `open_slots()` with the free days.
 * Neither returns anyone's phone or another guest.
 *
 *   unknown link  the card's top without a name, and a message
 *   cancelled     says the invitation is no longer active
 *   booked        their day, no form: only a manager changes a booking
 *   otherwise     the free days and the form
 *
 * Slots are days, shown as the day only, on the club's clock whatever the
 * guest's own time zone; a day is offered until the day before.
 */
export default async function QurooshInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('quroosh.invite');
  const logoName = (await getTranslations('quroosh'))('name');
  const place: InfoItem = { icon: 'place', text: t('place') };

  const db = isToken(token) && isQurooshConfigured() ? createQurooshClient() : null;
  let invitation: Invitation | undefined;
  if (db) {
    // Before 0005 is applied the function is missing: the link reads as unknown.
    const { data } = await db.rpc('invitation', { p_token: token });
    invitation = (data as Invitation[] | null)?.[0];
  }
  if (!db || !invitation) {
    return (
      <InviteColumn>
        <InviteHero logoName={logoName} subtitle={t('title')} />
        <Panel>
          <p className={`text-center ${BODY_TEXT}`}>{t('notFound')}</p>
        </Panel>
      </InviteColumn>
    );
  }

  const titles = await titleCatalogs();
  const { title, name } = splitTitle(invitation.name, titles.all);
  const feminine = titles.feminine.some((written) => invitation.name.startsWith(`${written} `));
  const hero = (
    <InviteHero
      logoName={logoName}
      subtitle={t(feminine ? 'titleFemale' : 'title')}
      greeting={t('greeting')}
      title={title}
      name={name}
    />
  );

  if (invitation.cancelled) {
    return (
      <InviteColumn>
        {hero}
        <InfoRow items={[place]} />
        <Panel>
          <p className={`text-center ${BODY_TEXT}`}>{t('cancelled')}</p>
        </Panel>
      </InviteColumn>
    );
  }

  if (invitation.slot_id && invitation.starts_at) {
    const day = slotDay(invitation.starts_at, locale);
    return (
      <InviteColumn>
        {hero}
        <InfoRow items={[{ icon: 'calendar', text: day }, place]} />
        <BookedNotice title={t('booked.title')} day={day} thanks={t('booked.next')} change={t('booked.change')} />
      </InviteColumn>
    );
  }

  const { data } = await db.rpc('open_slots', { p_token: token });
  const open = (data ?? []) as { id: string; starts_at: string }[];
  const slots: SlotOption[] = open.map((slot) => ({ id: slot.id, day: slotDay(slot.starts_at, locale) }));
  const range = open.length > 0 ? slotDayRange(open[0].starts_at, open[open.length - 1].starts_at, locale) : undefined;

  /** Before booking only: the intro, the mint box, the info row, the transport panel. */
  const lead = (
    <>
      <IntroText>{t('intro')}</IntroText>
      <Highlight>{t('highlight')}</Highlight>
      <InfoRow items={range ? [{ icon: 'calendar', text: range }, place] : [place]} />
      <Panel title={t('vip.title')}>
        <p className={BODY_TEXT}>{t('vip.body')}</p>
      </Panel>
    </>
  );

  if (slots.length === 0) {
    return (
      <InviteColumn>
        {hero}
        {lead}
        <Panel>
          <p className={`text-center ${BODY_TEXT}`}>{t('noSlots')}</p>
        </Panel>
      </InviteColumn>
    );
  }

  const names = new Intl.DisplayNames([locale === 'ar' ? 'ar' : 'en'], { type: 'region' });
  const countries: CountryOption[] = COUNTRIES.map(([iso, dial]) => ({ iso, dial, name: names.of(iso) ?? iso })).sort(
    (a, b) =>
      a.iso === DEFAULT_COUNTRY ? -1 : b.iso === DEFAULT_COUNTRY ? 1 : a.name.localeCompare(b.name, locale),
  );

  return (
    <InviteColumn>
      {hero}
      <BookingForm token={token} locale={locale} slots={slots} countries={countries} lead={lead} place={place} />
    </InviteColumn>
  );
}
