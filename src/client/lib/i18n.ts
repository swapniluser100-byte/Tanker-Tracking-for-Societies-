import { useCallback, useEffect, useState } from 'react';
import { formatClock } from '../../shared/format';

export type Lang = 'en' | 'mr';

const en = {
  appName: 'JalSetu',
  navWater: 'Water',
  navSchedule: 'Schedule',
  navCosts: 'Costs',
  navNotices: 'Notices',
  switchLang: 'मराठी',
  switchLangLabel: 'Switch to Marathi',
  signOut: 'Sign out',
  loading: 'Loading…',
  retry: 'Try again',
  flat: 'Flat {flat}',
  wing: '{wing} wing',
  waterOn: 'Water is ON',
  waterOff: 'Water is OFF',
  until: 'until {time}',
  nextOnToday: 'Next: today {time}',
  nextOnTomorrow: 'Next: tomorrow {time}',
  tankEmpty: 'Overhead tank is nearly empty — pumping soon',
  overheadTank: 'Overhead tank',
  hoursLeft: 'about {h} hours of water left',
  lowWarning: 'Water is low. Please use carefully.',
  todaysTimings: "Today's timings",
  releaseWindow: 'Water to flats',
  pmcSupply: '{authority} supply',
  pmcCame: '{authority} water came at {time}',
  pmcNotCame: 'PMC supply did not come today',
  pmcNotToday: 'No PMC supply today (alternate day)',
  pmcNext: 'Next PMC supply: {day} {time}',
  tankerOnTheWay: 'Tanker on the way',
  tankerEta: 'Expected by {time}',
  tankerScheduled: 'Tanker expected {time}',
  tankerLitres: '{litres}',
  myShare: 'My water share this month',
  perFlatSoFar: 'per flat so far',
  tankersThisMonth: '{n} tankers · {litres} received',
  reportNoWater: 'Report no water',
  reportLeakage: 'Report leakage',
  reportTitleNoWater: 'Report: no water',
  reportTitleLeakage: 'Report: leakage',
  reportDetails: 'Details (optional)',
  reportPlaceholderNoWater: 'e.g. No water in kitchen since 7 AM',
  reportPlaceholderLeakage: 'e.g. Pipe leaking near B-wing parking',
  send: 'Send report',
  cancel: 'Cancel',
  reported: 'Reported. The committee has been notified.',
  alreadyReported: 'Already reported from your flat — the committee is on it.',
  myReports: 'My reports',
  statusOpen: 'Open',
  statusInProgress: 'Being fixed',
  statusResolved: 'Resolved',
  notices: 'Notices',
  noNotices: 'No notices right now.',
  seeAll: 'See all',
  scheduleTitle: 'Water schedule',
  releaseTimings: 'Water released to flats',
  releaseHint: 'Daily, from the overhead tank',
  pmcThisWeek: 'PMC / PCMC supply this week',
  noSupply: 'No supply',
  today: 'Today',
  tomorrow: 'Tomorrow',
  recentSupply: 'Recent municipal supply',
  came: 'Came',
  didNotCome: 'Did not come',
  minLate: '{n} min late',
  onTime: 'On time',
  reliability: 'Came on {pct}% of supply days in the last 30 days · average delay {delay} min',
  costsTitle: 'Water costs',
  societySpend: 'Society tanker spend this month',
  yourShare: 'Your share (per flat)',
  splitAcross: 'Split equally across {n} flats',
  last6: 'Your share — last 6 months',
  month: 'Month',
  share: 'Share',
  tankers: 'Tankers',
  installApp: 'Install app',
  installHint: 'Add JalSetu to your home screen',
  offline: 'You are offline. Showing the last saved information.',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

type Dict = { [K in keyof typeof en]: (typeof en)[K] extends string[] ? string[] : string };

const mr: Dict = {
  appName: 'जलसेतू',
  navWater: 'पाणी',
  navSchedule: 'वेळापत्रक',
  navCosts: 'खर्च',
  navNotices: 'सूचना',
  switchLang: 'English',
  switchLangLabel: 'इंग्रजीत बदला',
  signOut: 'बाहेर पडा',
  loading: 'लोड होत आहे…',
  retry: 'पुन्हा प्रयत्न करा',
  flat: 'सदनिका {flat}',
  wing: '{wing} विंग',
  waterOn: 'पाणी चालू आहे',
  waterOff: 'पाणी बंद आहे',
  until: '{time} पर्यंत',
  nextOnToday: 'पुढे: आज {time}',
  nextOnTomorrow: 'पुढे: उद्या {time}',
  tankEmpty: 'ओव्हरहेड टाकी जवळजवळ रिकामी आहे — लवकरच पंप सुरू होईल',
  overheadTank: 'ओव्हरहेड टाकी',
  hoursLeft: 'सुमारे {h} तास पुरेल इतके पाणी',
  lowWarning: 'पाणी कमी आहे. कृपया जपून वापरा.',
  todaysTimings: 'आजच्या वेळा',
  releaseWindow: 'सदनिकांना पाणी',
  pmcSupply: '{authority} पुरवठा',
  pmcCame: '{authority} चे पाणी {time} ला आले',
  pmcNotCame: 'आज महापालिकेचे पाणी आले नाही',
  pmcNotToday: 'आज महापालिकेचा पुरवठा नाही (एक दिवसाआड)',
  pmcNext: 'पुढील महापालिका पुरवठा: {day} {time}',
  tankerOnTheWay: 'टँकर येत आहे',
  tankerEta: 'अंदाजे {time} पर्यंत पोहोचेल',
  tankerScheduled: 'टँकर अपेक्षित {time}',
  tankerLitres: '{litres}',
  myShare: 'या महिन्यातील माझा पाणी खर्च',
  perFlatSoFar: 'प्रति सदनिका आतापर्यंत',
  tankersThisMonth: '{n} टँकर · {litres} मिळाले',
  reportNoWater: 'पाणी नाही — कळवा',
  reportLeakage: 'गळती कळवा',
  reportTitleNoWater: 'तक्रार: पाणी नाही',
  reportTitleLeakage: 'तक्रार: गळती',
  reportDetails: 'तपशील (ऐच्छिक)',
  reportPlaceholderNoWater: 'उदा. सकाळी ७ पासून स्वयंपाकघरात पाणी नाही',
  reportPlaceholderLeakage: 'उदा. बी-विंग पार्किंगजवळ पाइप गळत आहे',
  send: 'तक्रार पाठवा',
  cancel: 'रद्द करा',
  reported: 'तक्रार नोंदवली. समितीला कळवले आहे.',
  alreadyReported: 'तुमच्या सदनिकेतून आधीच कळवले आहे — समिती काम करत आहे.',
  myReports: 'माझ्या तक्रारी',
  statusOpen: 'प्रलंबित',
  statusInProgress: 'काम सुरू',
  statusResolved: 'सोडवली',
  notices: 'सूचना',
  noNotices: 'सध्या कोणतीही सूचना नाही.',
  seeAll: 'सर्व पहा',
  scheduleTitle: 'पाण्याचे वेळापत्रक',
  releaseTimings: 'सदनिकांना पाणी सोडण्याच्या वेळा',
  releaseHint: 'दररोज, ओव्हरहेड टाकीतून',
  pmcThisWeek: 'या आठवड्यातील महापालिका पुरवठा',
  noSupply: 'पुरवठा नाही',
  today: 'आज',
  tomorrow: 'उद्या',
  recentSupply: 'अलीकडील महापालिका पुरवठा',
  came: 'आले',
  didNotCome: 'आले नाही',
  minLate: '{n} मिनिटे उशिरा',
  onTime: 'वेळेवर',
  reliability: 'गेल्या ३० दिवसांत {pct}% पुरवठ्याच्या दिवशी पाणी आले · सरासरी उशीर {delay} मिनिटे',
  costsTitle: 'पाण्याचा खर्च',
  societySpend: 'या महिन्यातील सोसायटीचा टँकर खर्च',
  yourShare: 'तुमचा वाटा (प्रति सदनिका)',
  splitAcross: '{n} सदनिकांमध्ये समान विभागणी',
  last6: 'तुमचा वाटा — गेले ६ महिने',
  month: 'महिना',
  share: 'वाटा',
  tankers: 'टँकर',
  installApp: 'ॲप इन्स्टॉल करा',
  installHint: 'जलसेतू होम स्क्रीनवर जोडा',
  offline: 'तुम्ही ऑफलाइन आहात. शेवटची जतन केलेली माहिती दाखवत आहोत.',
  weekdays: ['रवि', 'सोम', 'मंगळ', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
};

const dicts: Record<Lang, Dict> = { en: en as Dict, mr };
export type TKey = { [K in keyof Dict]: Dict[K] extends string ? K : never }[keyof Dict];

const STORAGE_KEY = 'jalsetu-lang';

function readLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mr' ? 'mr' : 'en';
  } catch {
    return 'en';
  }
}

/** Marathi clock: '06:00' → 'सकाळी 6:00', '19:30' → 'रात्री 7:30'. */
export function clockFor(lang: Lang, hhmm: string): string {
  if (lang === 'en') return formatClock(hhmm);
  const [h, m] = hhmm.split(':').map(Number);
  const part = h < 12 ? 'सकाळी' : h < 16 ? 'दुपारी' : h < 19 ? 'संध्याकाळी' : 'रात्री';
  return `${part} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
}

export function useLang() {
  const [lang, setLangState] = useState<Lang>(readLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = 'en'; };
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }, []);
  const t = useCallback(
    (key: TKey, vars: Record<string, string | number> = {}) =>
      (dicts[lang][key] as string).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)),
    [lang],
  );
  return { lang, setLang, t, weekdays: dicts[lang].weekdays, clock: (hhmm: string) => clockFor(lang, hhmm) };
}
