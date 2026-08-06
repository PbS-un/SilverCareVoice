/**
 * localize.ts — AI 回覆語言化（T1.4）
 *
 * DeepSeek 路徑由 system prompt 直接要求按選定語言作答（見 server／Edge
 * Function）；本地 Local Hybrid Engine 與 client 側 safety／gate 模板為
 * 繁體中文，此模組以「全句模板匹配」做 best-effort 翻譯：
 *  - 只翻譯已知、確定性的模板（引擎／門控字串），動態數字用佔位補回；
 *  - 無匹配時原句保留（graceful fallback，絕不 crash、絕不影響 AI pipeline）；
 *  - zh-HK 一律原句直出。
 */
import type { AppLocale } from '../../i18n';

type TemplateFn = (m: RegExpMatchArray) => string;

interface Rule {
  id: string;
  re: RegExp;
}

const RULES: Rule[] = [
  { id: 'bp-ask-full', re: /^好呀，你上壓同下壓係幾多？你話我知兩個數，我即刻幫你記。$/ },
  { id: 'bp-ask-systolic', re: /^收到，上壓 (\d+)。咁下壓係幾多呀？$/ },
  { id: 'bp-ask-diastolic', re: /^收到，下壓 (\d+)。咁上壓係幾多呀？$/ },
  { id: 'bp-unreasonable', re: /^呢兩個數好似唔太合理喎，可以再講一次上壓同下壓嗎？$/ },
  { id: 'bp-ask-which', re: /^收到 (\d+)，呢個係上壓定下壓呀？你話我知兩個數，我即刻幫你記。$/ },
  { id: 'bp-cancel', re: /^好呀，咁唔記血壓先。之後量完再話我知就得㗎喇。$/ },
  { id: 'bp-recorded-gate', re: /^收到，記低咗你而家血壓 (\d+)\/(\d+)。(有啲幾高喎，坐低休息先，覺得唔舒服要話家人知呀。)?(有啲數值要留意，休息吓遲啲再量多次啦。)?$/ },
  { id: 'bp-recorded-engine', re: /^收到，你而家血壓 (\d+)\/(\d+)，我幫你記低咗。?(休息吓，遲啲再量多次啦。)?(你有啲頭暈，起身慢啲、坐穩先呀。)?$/ },
  { id: 'bp-severe-engine', re: /^你血壓 (\d+)\/(\d+) 幾高喎，即刻坐低休息先。如果仲覺得唔舒服，記得叫家人幫手或者睇醫生呀。$/ },
  { id: 'glucose-recorded', re: /^收到，你血糖 ([0-9.]+)，我幫你記低咗。?(有啲低喎，食少少嘢先，唔好暈親呀。)?(有啲高喎，飲多啲水，留意吓呀。)?$/ },
  { id: 'heart-recorded', re: /^收到，你心跳每分鐘 (\d+) 下，我幫你記低咗。?(如果覺得心悒或者唔舒服，記得話我知呀。)?$/ },
  { id: 'weight-recorded', re: /^收到，你體重 ([0-9.]+) 公斤，我幫你記低咗。$/ },
  { id: 'saved-default', re: /^收到，我幫你記低咗。$/ },
  { id: 'symptom-empty', re: /^聽到你有啲唔舒服，我幫你記低咗。如果持續唔舒服，記得話我知或者睇醫生呀。$/ },
  { id: 'symptom-list', re: /^聽到你有啲唔舒服，(.+?)要留意吓㗎。(.+)$/ },
  { id: 'med-taken', re: /^好嘅，你食咗(.+?)，我幫你記低咗。$/ },
  { id: 'med-unknown', re: /^好嘅，你食咗藥。你食嘅係邊一種呀？(.*)$/ },
  { id: 'med-late', re: /^收到，你遲咗食(.+?)，我幫你記低咗，之後記得按時食呀。$/ },
  { id: 'med-missed', re: /^唔緊要，漏咗食(.+?)我幫你記低咗。記得之後按時食藥呀。$/ },
  { id: 'med-recorded', re: /^好嘅，記低咗你(食咗|漏咗食|遲咗食)「(.+?)」(?:（(.+?)）)?。$/ },
  { id: 'med-not-found', re: /^搵唔到「(.+?)」喺你嘅藥物名單入面喎，要唔要幫你新增呢隻藥？$/ },
  { id: 'med-which-candidates', re: /^你講嘅係邊一種藥呀？係咪(.+?)$/ },
  { id: 'med-single-candidate', re: /^你係咪講緊「(.+?)」呀？$/ },
  { id: 'med-no-records', re: /^你而家未有藥物記錄喎。你可以用「記錄食藥」加咗藥先，再話我知你食咗啦。$/ },
  { id: 'med-cancel', re: /^好呀，咁唔記食藥先。$/ },
  { id: 'med-new-created', re: /^好嘅，已經幫你新增咗「(.+?)」，仲記低咗你(.+?)佢。$/ },
  { id: 'med-new-cancel', re: /^好呀，咁唔新增呢隻藥先。$/ },
  { id: 'appt-confirm-gate', re: /^好嘅，幫你記低覆診：(.+)。啱唔啱呀？$/ },
  { id: 'appt-confirm-engine', re: /^好嘅，幫你記低(.+)覆診，啱唔啱呀？$/ },
  { id: 'appt-ask-date-location', re: /^好呀，去(.+?)係幾號呀？你話我知，我幫你記低。$/ },
  { id: 'appt-ask-date', re: /^好呀，覆診係幾號呀？你話我知，我幫你記低。$/ },
  { id: 'appt-ask-full', re: /^好呀，幾時去？去邊間醫院呀？你話我知，我幫你記低。$/ },
  { id: 'appt-ask-date2', re: /^幾號去呀？你講「下星期三」或者「八月十二號」咁，我幫你記低。$/ },
  { id: 'appt-saved', re: /^好嘅，記低咗你覆診：(.+)。$/ },
  { id: 'appt-none', re: /^你而家冇未到期嘅覆診預約喎。如果約咗新的，話我知幫你記低呀。$/ },
  { id: 'appt-next', re: /^你下次覆診係(.+)，喺(.+)。(.+。)?$/ },
  { id: 'appt-more', re: /^之後仲有 (\d+) 個預約。$/ },
  { id: 'appt-edit-form', re: /^好呀，咁你喺表單度改一改啦。$/ },
  { id: 'appt-no-date-form', re: /^好呀，不過仲未知道邊一日覆診喎，你喺表單度補返啦。$/ },
  { id: 'health-history', re: /^我幫你搵吓你嘅健康紀錄先。$/ },
  { id: 'policy', re: /^我幫你搵吓相關資訊先。$/ },
  { id: 'family-contact', re: /^好嘅，我幫你聯絡(.+?)先。$/ },
  { id: 'family-status', re: /^我幫你睇吓(.+?)嘅近況先。$/ },
  { id: 'general-health', re: /^你呢個問題好好，我幫你搵吓相關資訊先。$/ },
  { id: 'unknown', re: /^我明白你嘅情況，已經幫你記低。如果有唔舒服記得話我知。$/ },
  { id: 'bp-rest-context', re: /^你啱啱講嘅血壓情況要留意，建議坐低休息吓，遲啲再量多次。$/ },
  { id: 'safety-local', re: /^(.+?)要小心，建議即刻聯絡家人或者搵醫療協助。$/ },
  { id: 'safety-client', re: /^(.+?)係緊急情況，請即刻坐低休息，馬上聯絡家人或者照顧者幫手。$/ },
  { id: 'emergency', re: /^我聽到你好唔舒服，而家幫你搵緊急協助，請保持冷靜、坐低休息先。$/ },
  { id: 'family-no-contact', re: /^而家未有家人聯絡資料喺度。你可以話我知家人電話，我幫你記低。$/ },
  { id: 'family-notified', re: /^我已經通知咗你嘅(.+?)喇，佢會盡快跟進，你唔使擔心。$/ },
  { id: 'family-contact-card', re: /^呢度係你家人嘅聯絡資料，撳個掣就可以打俾佢。$/ },
  { id: 'family-status-following', re: /^你嘅(.+?)而家跟進緊你嘅情況：(.+?)，共有 (\d+) 項跟進事項。你唔使太擔心呀。$/ },
  { id: 'family-status-nothing', re: /^你嘅(.+?)而家冇未處理嘅跟進事項，你唔使太擔心。如果想佢，可以叫我幫你聯絡佢呀。$/ },
];

const DETAILED_RULES: Rule[] = [
  { id: 'detail-bp-high', re: /^收縮壓 ≥180 或舒張壓 ≥110 屬偏高，建議稍後再量度並留意身體狀況。$/ },
  { id: 'detail-safety', re: /^檢測到高風險徵狀，已標記為緊急情況。$/ },
  { id: 'detail-emergency', re: /^長者主動求助，已標記為緊急情況。$/ },
  { id: 'detail-med-consult', re: /^如有疑問應否補服藥物，請諮詢醫生意見。$/ },
  { id: 'detail-topic', re: /^問題主題：(.+)$/ },
  { id: 'detail-safety-999', re: /^如果情況持續或者加重，請即刻致電緊急求助電話（澳門 999），保持冷靜等待救援。$/ },
  { id: 'detail-dizzy-bp', re: /^頭暈加上血壓偏高（(\d+)\/(\d+)），建議休息並稍後再量度血壓。$/ },
  { id: 'detail-30d-bp', re: /^最近三十日共 (\d+) 次血壓記錄，平均約 (\d+)\/(\d+) mmHg。$/ },
  { id: 'detail-kb-fallback', re: /^詳細資料整理緊，你可以打就近衛生中心或者社工查詢，佢哋會幫到你。$/ },
];

const TREND_WORDS: Record<string, string> = {
  平穩: 'stable',
  大致平穩: 'mostly stable',
  有上升趨勢: 'showing an upward trend',
  有下降趨勢: 'showing a downward trend',
};

const TREND_CN: Record<string, string> = {
  平穩: '平稳',
  大致平穩: '大致平稳',
  有上升趨勢: '呈上升趋势',
  有下降趨勢: '呈下降趋势',
};

const TREND_MAP: Record<string, string> = {
  平穩: 'stable',
  大致平穩: 'mostly stable',
  有上升趨勢: 'showing an upward trend',
  有下降趨勢: 'showing a downward trend',
};

const T: Record<AppLocale, Record<string, TemplateFn>> = {
  'zh-HK': {},
  'zh-CN': {
    'bp-ask-full': () => '好的，您的上压和下压分别是多少？告诉我两个数字，我马上帮您记录。',
    'bp-ask-systolic': (m) => `收到，上压 ${m[1]}。那下压是多少呢？`,
    'bp-ask-diastolic': (m) => `收到，下压 ${m[1]}。那上压是多少呢？`,
    'bp-unreasonable': () => '这两个数字好像不太合理，可以再告诉我一次上压和下压吗？',
    'bp-ask-which': (m) => `收到 ${m[1]}，这是上压还是下压呢？告诉我两个数字，我马上帮您记录。`,
    'bp-cancel': () => '好的，那先不记录血压。量完之后再告诉我就可以了。',
    'bp-recorded-gate': (m) =>
      `收到，已记录您现在的血压 ${m[1]}/${m[2]}。${m[3] ? '有点偏高，坐下休息，不舒服要告诉家人。' : ''}${m[4] ? '有些数值需要留意，休息一下迟点再量一次。' : ''}`,
    'bp-recorded-engine': (m) =>
      `收到，您现在的血压 ${m[1]}/${m[2]}，已帮您记录。${m[3] ? '休息一下，迟点再量一次。' : ''}${m[4] ? '您有点头晕，起身慢一点、坐稳先。' : ''}`,
    'bp-severe-engine': (m) =>
      `您的血压 ${m[1]}/${m[2]} 有点高，请立刻坐下休息。如果还是不舒服，记得叫家人帮忙或者看医生。`,
    'glucose-recorded': (m) =>
      `收到，您的血糖 ${m[1]}，已帮您记录。${m[2] ? '有点偏低，先吃点东西，不要晕倒。' : ''}${m[3] ? '有点偏高，多喝水，留意一下。' : ''}`,
    'heart-recorded': (m) =>
      `收到，您的心跳每分钟 ${m[1]} 下，已帮您记录。${m[2] ? '如果觉得心闷或不舒服，记得告诉我。' : ''}`,
    'weight-recorded': (m) => `收到，您的体重 ${m[1]} 公斤，已帮您记录。`,
    'saved-default': () => '收到，已帮您记录。',
    'symptom-empty': () => '听到您有点不舒服，已帮您记录。如果持续不舒服，记得告诉我或者看医生。',
    'symptom-list': (m) => `听到您有点不舒服，${m[1]}要留意一下。${m[2]}`,
    'med-taken': (m) => `好的，您服用了${m[1]}，已帮您记录。`,
    'med-unknown': (m) => `好的，您吃了药。您吃的是哪一种呢？${m[1]}`,
    'med-late': (m) => `收到，您迟了吃${m[1]}，已帮您记录，之后记得按时吃。`,
    'med-missed': (m) => `没关系，漏吃了${m[1]}，已帮您记录。记得之后按时吃药。`,
    'med-recorded': (m) =>
      `好的，已记录您${m[1] === '食咗' ? '服用' : m[1] === '漏咗食' ? '漏服' : '迟服'}了「${m[2]}」${m[3] ? `（${m[3]}）` : ''}。`,
    'med-not-found': (m) => `在您的药物名单里找不到「${m[1]}」，需要帮您新增这个药吗？`,
    'med-which-candidates': (m) => `您说的是哪一种药呢？是${m[1]}？`,
    'med-single-candidate': (m) => `您是不是在说「${m[1]}」？`,
    'med-no-records': () => '您目前还没有药物记录。可以用「记录吃药」先加药，再告诉我您吃了。',
    'med-cancel': () => '好的，那先不记录吃药。',
    'med-new-created': (m) => `好的，已帮您新增「${m[1]}」，并记录您${m[2]}它。`,
    'med-new-cancel': () => '好的，那先不新增这个药。',
    'appt-confirm-gate': (m) => `好的，帮您记录复诊：${m[1]}。对吗？`,
    'appt-confirm-engine': (m) => `好的，帮您记录${m[1]}复诊，对吗？`,
    'appt-ask-date-location': (m) => `好的，去${m[1]}是哪天呢？告诉我，我帮您记录。`,
    'appt-ask-date': () => '好的，复诊是哪天呢？告诉我，我帮您记录。',
    'appt-ask-full': () => '好的，什么时候去？去哪家医院呢？告诉我，我帮您记录。',
    'appt-ask-date2': () => '哪天去呢？您说「下星期三」或者「八月十二号」这样的，我帮您记录。',
    'appt-saved': (m) => `好的，已记录您的复诊：${m[1]}。`,
    'appt-none': () => '您目前没有未到期的复诊预约。如果约了新的，告诉我帮您记录。',
    'appt-next': (m) => `您下次复诊是${m[1]}，在${m[2]}。${m[3] ?? ''}`,
    'appt-more': (m) => `之后还有 ${m[1]} 个预约。`,
    'appt-edit-form': () => '好的，那请在表单里改一改。',
    'appt-no-date-form': () => '好的，不过还不知道是哪一天复诊，请在表单里补上。',
    'health-history': () => '我帮您找一下您的健康记录。',
    'policy': () => '我帮您找一下相关信息。',
    'family-contact': (m) => `好的，我帮您联系${m[1]}。`,
    'family-status': (m) => `我帮您看一下${m[1]}的近况。`,
    'general-health': () => '您这个问题很好，我帮您找一下相关信息。',
    'unknown': () => '我明白您的情况，已帮您记录。如果不舒服记得告诉我。',
    'bp-rest-context': () => '您刚才提到的血压情况需要留意，建议先坐下休息，迟点再量一次。',
    'safety-local': (m) => `${m[1]}要小心，建议立刻联系家人或者寻求医疗协助。`,
    'safety-client': (m) => `${m[1]}是紧急情况，请立刻坐下休息，马上联系家人或者照顾者帮忙。`,
    'emergency': () => '我听到您很不舒服，现在帮您寻求紧急协助，请保持冷静、先坐下休息。',
    'family-no-contact': () => '目前没有家人的联系资料。您可以告诉我家人电话，我帮您记录。',
    'family-notified': (m) => `我已经通知了您的${m[1]}，他会尽快跟进，您不用担心。`,
    'family-contact-card': () => '这是您家人的联系资料，按一下按钮就可以打给他。',
    'family-status-following': (m) =>
      `您的${m[1]}正在跟进您的情况：${m[2]}，共有 ${m[3]} 项跟进事项。您不用担心。`,
    'family-status-nothing': (m) =>
      `您的${m[1]}目前没有未处理的跟进事项，您不用担心。如果想他，可以叫我帮您联系。`,
    'detail-bp-high': () => '收缩压 ≥180 或舒张压 ≥110 属于偏高，建议稍后再测量并留意身体状况。',
    'detail-safety': () => '检测到高风险症状，已标记为紧急情况。',
    'detail-emergency': () => '长者主动求助，已标记为紧急情况。',
    'detail-med-consult': () => '如有疑问是否应该补服药物，请咨询医生意见。',
    'detail-topic': (m) => `问题主题：${m[1]}`,
    'detail-safety-999': () => '如果情况持续或加重，请立即拨打紧急求助电话（澳门 999），保持冷静等待救援。',
    'detail-dizzy-bp': (m) => `头晕加上血压偏高（${m[1]}/${m[2]}），建议休息并稍后再测量血压。`,
    'detail-30d-bp': (m) => `最近三十天共 ${m[1]} 次血压记录，平均约 ${m[2]}/${m[3]} mmHg。`,
    'detail-kb-fallback': () => '详细资料整理中，您可以到就近卫生中心或者社工查询，他们会帮到您。',
  },
  pt: {
    'bp-ask-full': () => 'Certo, quais são as suas pressões máxima e mínima? Diga-me os dois números e eu registo já.',
    'bp-ask-systolic': (m) => `Recebido, máxima ${m[1]}. E qual é a mínima?`,
    'bp-ask-diastolic': (m) => `Recebido, mínima ${m[1]}. E qual é a máxima?`,
    'bp-unreasonable': () => 'Esses números parecem pouco razoáveis. Pode dizer-me novamente a máxima e a mínima?',
    'bp-ask-which': (m) => `Recebi ${m[1]}. É a máxima ou a mínima? Diga-me os dois números e eu registo já.`,
    'bp-cancel': () => 'Certo, então não registamos a tensão por agora. Quando medir, avise-me.',
    'bp-recorded-gate': (m) =>
      `Recebido, registei a sua tensão atual ${m[1]}/${m[2]}.${m[3] ? ' Está um pouco alta; sente-se e descanse, avise a família se não se sentir bem.' : ''}${m[4] ? ' Alguns valores precisam de atenção; descanse e meça novamente mais tarde.' : ''}`,
    'bp-recorded-engine': (m) =>
      `Recebido, a sua tensão é ${m[1]}/${m[2]}, já registei.${m[3] ? ' Descanse e meça novamente mais tarde.' : ''}${m[4] ? ' Sente um pouco de tontura; levante-se devagar e fique sentado primeiro.' : ''}`,
    'bp-severe-engine': (m) =>
      `A sua tensão ${m[1]}/${m[2]} está bastante alta. Sente-se e descanse já. Se ainda não se sentir bem, peça ajuda à família ou vá ao médico.`,
    'glucose-recorded': (m) =>
      `Recebido, a sua glicemia é ${m[1]}, já registei.${m[2] ? ' Está um pouco baixa; coma qualquer coisa para não desmaiar.' : ''}${m[3] ? ' Está um pouco alta; beba mais água e fique atento.' : ''}`,
    'heart-recorded': (m) =>
      `Recebido, o seu ritmo cardíaco é ${m[1]} batimentos por minuto, já registei.${m[2] ? ' Se sentir aperto no peito ou desconforto, avise-me.' : ''}`,
    'weight-recorded': (m) => `Recebido, o seu peso é ${m[1]} kg, já registei.`,
    'saved-default': () => 'Recebido, já registei.',
    'symptom-empty': () => 'Percebo que não se sente bem; já registei. Se continuar, avise-me ou vá ao médico.',
    'symptom-list': (m) => `Percebo que não se sente bem. ${m[1]} merece atenção. ${m[2]}`,
    'med-taken': (m) => `Certo, tomou ${m[1]}, já registei.`,
    'med-unknown': (m) => `Certo, tomou o medicamento. Qual é que foi? ${m[1]}`,
    'med-late': (m) => `Recebido, tomou ${m[1]} com atraso, já registei. Lembre-se de tomar a horas.`,
    'med-missed': (m) => `Sem problema, registei que não tomou ${m[1]}. Lembre-se de tomar a horas daqui em diante.`,
    'med-recorded': (m) =>
      `Certo, registei que ${m[1] === '食咗' ? 'tomou' : m[1] === '漏咗食' ? 'não tomou' : 'tomou com atraso'} «${m[2]}»${m[3] ? ` (${m[3]})` : ''}.`,
    'med-not-found': (m) => `Não encontrei «${m[1]}» na sua lista de medicamentos. Quer que adicione este medicamento?`,
    'med-which-candidates': (m) => `Qual medicamento quer dizer? É ${m[1]}?`,
    'med-single-candidate': (m) => `Está a falar de «${m[1]}»?`,
    'med-no-records': () => 'Ainda não tem registos de medicamentos. Pode usar «Registar medicação» para adicionar primeiro, e depois dizer-me que tomou.',
    'med-cancel': () => 'Certo, então não registamos a medicação por agora.',
    'med-new-created': (m) => `Certo, adicionei «${m[1]}» e registei que ${m[2]}.`,
    'med-new-cancel': () => 'Certo, então não adicionamos este medicamento por agora.',
    'appt-confirm-gate': (m) => `Certo, registo a consulta: ${m[1]}. Está correto?`,
    'appt-confirm-engine': (m) => `Certo, registo a consulta ${m[1]}. Está correto?`,
    'appt-ask-date-location': (m) => `Certo, para quando é a consulta em ${m[1]}? Diga-me e eu registo.`,
    'appt-ask-date': () => 'Certo, para quando é a consulta? Diga-me e eu registo.',
    'appt-ask-full': () => 'Certo, quando? Em que hospital? Diga-me e eu registo.',
    'appt-ask-date2': () => 'Para que dia? Diga por exemplo «quarta-feira que vem» ou «12 de agosto» e eu registo.',
    'appt-saved': (m) => `Certo, registei a sua consulta: ${m[1]}.`,
    'appt-none': () => 'Não tem consultas futuras marcadas. Se marcar uma nova, diga-me e eu registo.',
    'appt-next': (m) => `A sua próxima consulta é ${m[1]}, em ${m[2]}. ${m[3] ?? ''}`,
    'appt-more': (m) => `Ainda tem ${m[1]} consulta(s) marcada(s).`,
    'appt-edit-form': () => 'Certo, então altere no formulário.',
    'appt-no-date-form': () => 'Certo, mas ainda não sei em que dia é a consulta. Preencha no formulário.',
    'health-history': () => 'Vou procurar os seus registos de saúde.',
    'policy': () => 'Vou procurar essa informação.',
    'family-contact': (m) => `Certo, vou contactar ${m[1]} por si.`,
    'family-status': (m) => `Vou ver como está ${m[1]}.`,
    'general-health': () => 'Boa pergunta. Vou procurar essa informação.',
    'unknown': () => 'Percebo a sua situação e já registei. Se não se sentir bem, avise-me.',
    'bp-rest-context': () => 'A sua tensão arterial mencionada anteriormente merece atenção. Sugiro que se sente e descanse, e meça novamente mais tarde.',
    'safety-local': (m) => `${m[1]} requer cuidado. Contacte já a família ou procure ajuda médica.`,
    'safety-client': (m) => `${m[1]} é uma emergência. Sente-se e descanse já, e contacte a família ou um cuidador.`,
    'emergency': () => 'Percebo que não se sente bem. Vou pedir ajuda de emergência; mantenha a calma e sente-se a descansar.',
    'family-no-contact': () => 'Ainda não há contactos da família. Diga-me o telefone da família e eu registo.',
    'family-notified': (m) => `Já notifiquei ${m[1]}. Ele(a) vai acompanhar em breve, não se preocupe.`,
    'family-contact-card': () => 'Estes são os contactos da sua família. Toque no botão para ligar.',
    'family-status-following': (m) =>
      `${m[1]} está a acompanhar a sua situação: ${m[2]}, com ${m[3]} item(ns) de acompanhamento. Não se preocupe.`,
    'family-status-nothing': (m) =>
      `${m[1]} não tem acompanhamentos pendentes. Não se preocupe. Se quiser falar com ele(a), posso contactar por si.`,
    'detail-bp-high': () => 'Máxima ≥180 ou mínima ≥110 é elevado; sugere-se medir novamente mais tarde e vigiar o estado de saúde.',
    'detail-safety': () => 'Detetados sintomas de alto risco, marcados como urgente.',
    'detail-emergency': () => 'O idoso pediu ajuda, marcado como urgente.',
    'detail-med-consult': () => 'Em caso de dúvida sobre tomar ou não o medicamento, consulte o médico.',
    'detail-topic': (m) => `Tema: ${m[1]}`,
    'detail-safety-999': () => 'Se a situação continuar ou piorar, ligue já para a emergência (Macau 999) e mantenha a calma a aguardar.',
    'detail-dizzy-bp': (m) => `Tontura com tensão elevada (${m[1]}/${m[2]}); sugere-se descanso e nova medição mais tarde.`,
    'detail-30d-bp': (m) => `Nos últimos 30 dias houve ${m[1]} medições de tensão, média ≈ ${m[2]}/${m[3]} mmHg.`,
    'detail-kb-fallback': () => 'Estamos a preparar a informação detalhada. Pode perguntar no centro de saúde ou ao assistente social mais próximo, eles ajudarão.',
  },
  en: {
    'bp-ask-full': () => 'OK, what are your upper and lower blood pressure numbers? Tell me both and I will record them right away.',
    'bp-ask-systolic': (m) => `Got it, upper ${m[1]}. What is the lower number?`,
    'bp-ask-diastolic': (m) => `Got it, lower ${m[1]}. What is the upper number?`,
    'bp-unreasonable': () => 'Those numbers do not look quite right. Can you tell me the upper and lower numbers again?',
    'bp-ask-which': (m) => `I got ${m[1]} — is that the upper or the lower number? Tell me both and I will record them.`,
    'bp-cancel': () => 'OK, we will skip the blood pressure for now. Tell me after you measure it.',
    'bp-recorded-gate': (m) =>
      `Got it, I recorded your current blood pressure ${m[1]}/${m[2]}.${m[3] ? ' It is a bit high — sit down and rest, and tell your family if you feel unwell.' : ''}${m[4] ? ' Some values need attention; rest and measure again later.' : ''}`,
    'bp-recorded-engine': (m) =>
      `Got it, your blood pressure is ${m[1]}/${m[2]} — recorded.${m[3] ? ' Rest, and measure again a bit later.' : ''}${m[4] ? ' You feel a little dizzy — stand up slowly and stay seated first.' : ''}`,
    'bp-severe-engine': (m) =>
      `Your blood pressure ${m[1]}/${m[2]} is quite high. Sit down and rest right away. If you still feel unwell, ask family for help or see a doctor.`,
    'glucose-recorded': (m) =>
      `Got it, your blood glucose is ${m[1]} — recorded.${m[2] ? ' It is a bit low; have a small snack so you do not faint.' : ''}${m[3] ? ' It is a bit high; drink more water and keep an eye on it.' : ''}`,
    'heart-recorded': (m) =>
      `Got it, your heart rate is ${m[1]} beats per minute — recorded.${m[2] ? ' If you feel chest tightness or discomfort, let me know.' : ''}`,
    'weight-recorded': (m) => `Got it, your weight is ${m[1]} kg — recorded.`,
    'saved-default': () => 'Got it, recorded.',
    'symptom-empty': () => 'I hear that you are not feeling well; I have recorded it. If it continues, let me know or see a doctor.',
    'symptom-list': (m) => `I hear that you are not feeling well. ${m[1]} needs attention. ${m[2]}`,
    'med-taken': (m) => `OK, you took ${m[1]} — recorded.`,
    'med-unknown': (m) => `OK, you took your medication. Which one was it? ${m[1]}`,
    'med-late': (m) => `Got it, you took ${m[1]} late — recorded. Remember to take it on time from now on.`,
    'med-missed': (m) => `No problem, I recorded that you missed ${m[1]}. Remember to take it on time.`,
    'med-recorded': (m) =>
      `OK, I recorded that you ${m[1] === '食咗' ? 'took' : m[1] === '漏咗食' ? 'missed' : 'took late'} “${m[2]}”${m[3] ? ` (${m[3]})` : ''}.`,
    'med-not-found': (m) => `I could not find “${m[1]}” in your medication list. Shall I add this medication?`,
    'med-which-candidates': (m) => `Which medication do you mean? Is it ${m[1]}?`,
    'med-single-candidate': (m) => `Do you mean “${m[1]}”?`,
    'med-no-records': () => 'You have no medication records yet. Use “Log medication” to add one first, then tell me you took it.',
    'med-cancel': () => 'OK, we will skip logging medication for now.',
    'med-new-created': (m) => `OK, I added “${m[1]}” and recorded that you ${m[2]} it.`,
    'med-new-cancel': () => 'OK, we will skip adding this medication for now.',
    'appt-confirm-gate': (m) => `OK, I will record the appointment: ${m[1]}. Is that right?`,
    'appt-confirm-engine': (m) => `OK, I will record the appointment ${m[1]}. Is that right?`,
    'appt-ask-date-location': (m) => `OK, what day is the appointment at ${m[1]}? Tell me and I will record it.`,
    'appt-ask-date': () => 'OK, what day is the appointment? Tell me and I will record it.',
    'appt-ask-full': () => 'OK, when? Which hospital? Tell me and I will record it.',
    'appt-ask-date2': () => 'Which day? Say something like “next Wednesday” or “August 12” and I will record it.',
    'appt-saved': (m) => `OK, I recorded your appointment: ${m[1]}.`,
    'appt-none': () => 'You have no upcoming appointments. If you book a new one, tell me and I will record it.',
    'appt-next': (m) => `Your next appointment is ${m[1]}, at ${m[2]}. ${m[3] ?? ''}`,
    'appt-more': (m) => `You have ${m[1]} more appointment(s) after that.`,
    'appt-edit-form': () => 'OK, please adjust it in the form.',
    'appt-no-date-form': () => 'OK, but we still do not know the appointment day. Please fill it in the form.',
    'health-history': () => 'Let me look up your health records.',
    'policy': () => 'Let me look that up for you.',
    'family-contact': (m) => `OK, I will contact ${m[1]} for you.`,
    'family-status': (m) => `Let me check on ${m[1]} for you.`,
    'general-health': () => 'That is a good question. Let me look that up for you.',
    'unknown': () => 'I understand your situation and have recorded it. Let me know if you feel unwell.',
    'bp-rest-context': () => 'The blood pressure situation you mentioned needs attention. Please sit down and rest, and measure again later.',
    'safety-local': (m) => `${m[1]} requires care. Please contact family right away or seek medical help.`,
    'safety-client': (m) => `${m[1]} is an emergency. Please sit down and rest now, and contact family or a caregiver right away.`,
    'emergency': () => 'I can hear you are not feeling well. I will get emergency help now — stay calm and sit down to rest.',
    'family-no-contact': () => 'There are no family contacts yet. You can tell me the family phone number and I will record it.',
    'family-notified': (m) => `I have notified ${m[1]}. They will follow up soon — do not worry.`,
    'family-contact-card': () => 'Here are your family contacts. Tap a button to call.',
    'family-status-following': (m) =>
      `${m[1]} is following up on your situation: ${m[2]}, with ${m[3]} item(s) to follow up. Do not worry.`,
    'family-status-nothing': (m) =>
      `${m[1]} has no pending follow-ups right now, so do not worry. If you want to reach them, I can contact them for you.`,
    'detail-bp-high': () => 'Systolic ≥180 or diastolic ≥110 is high; suggested to measure again later and watch how you feel.',
    'detail-safety': () => 'High-risk symptoms detected; marked as urgent.',
    'detail-emergency': () => 'Senior requested help; marked as urgent.',
    'detail-med-consult': () => 'If unsure whether to take a missed dose, please ask the doctor.',
    'detail-topic': (m) => `Topic: ${m[1]}`,
    'detail-safety-999': () => 'If the situation persists or worsens, call emergency services right away (Macau 999) and stay calm.',
    'detail-dizzy-bp': (m) => `Dizziness with high blood pressure (${m[1]}/${m[2]}); suggested to rest and measure again later.`,
    'detail-30d-bp': (m) => `In the last 30 days there were ${m[1]} blood pressure readings, average ≈ ${m[2]}/${m[3]} mmHg.`,
    'detail-kb-fallback': () => 'We are preparing the details. You can ask the nearest health center or social worker; they will help.',
  },
};

/** 症狀建議片段翻譯（symptom-list 模板內嵌）。 */
const SYMPTOM_ADVICE: Record<string, { 'zh-CN': string; pt: string; en: string }> = {
  頭暈: { 'zh-CN': '坐下休息一下，起身的时候慢一点。', pt: 'Sente-se e descanse; levante-se devagar.', en: 'Sit down and rest; stand up slowly.' },
  頭痛: { 'zh-CN': '休息一下，先喝点水。', pt: 'Descanse e beba um pouco de água.', en: 'Rest and drink some water.' },
  發燒: { 'zh-CN': '多喝水，如果一直发烧要去看医生。', pt: 'Beba mais água; se a febre persistir, vá ao médico.', en: 'Drink more water; see a doctor if the fever continues.' },
  嘔吐: { 'zh-CN': '慢慢喝少量温水，吐得厉害要去看医生。', pt: 'Beba um pouco de água morna devagar; se vomitar muito, vá ao médico.', en: 'Sip warm water slowly; see a doctor if vomiting is severe.' },
  肚瀉: { 'zh-CN': '多喝水补充水分，腹泻不止要看医生。', pt: 'Beba mais água; se a diarreia continuar, vá ao médico.', en: 'Drink plenty of water; see a doctor if diarrhea continues.' },
  肚痛: { 'zh-CN': '如果痛得厉害要去看医生。', pt: 'Se a dor for forte, vá ao médico.', en: 'See a doctor if the pain is severe.' },
  胃痛: { 'zh-CN': '吃清淡一点，痛得久要去看医生。', pt: 'Coma leve; se a dor durar, vá ao médico.', en: 'Eat lightly; see a doctor if it lasts.' },
  口渴: { 'zh-CN': '先喝点水，如果经常口渴要留意血糖。', pt: 'Beba água; se sentir sede com frequência, vigie a glicemia.', en: 'Drink water; if often thirsty, watch your blood glucose.' },
  眼矇: { 'zh-CN': '先让眼睛休息，看东西模糊要去看医生。', pt: 'Descanse os olhos; se a visão ficar turva, vá ao médico.', en: 'Rest your eyes; see a doctor if vision is blurry.' },
  腳腫: { 'zh-CN': '先坐下抬高脚，肿得久要去看医生。', pt: 'Sente-se e eleve os pés; se o inchaço durar, vá ao médico.', en: 'Sit down and elevate your feet; see a doctor if swelling lasts.' },
  疲勞: { 'zh-CN': '先休息一下，不要太操劳。', pt: 'Descanse primeiro; não se esforce demais.', en: 'Rest first; do not overdo it.' },
  失眠: { 'zh-CN': '睡前放松一下，少喝茶。', pt: 'Relaxe antes de dormir e beba menos chá.', en: 'Relax before bed and drink less tea.' },
  心悸: { 'zh-CN': '坐下休息，如果经常心慌要去看医生。', pt: 'Sente-se e descanse; se sentir palpitações com frequência, vá ao médico.', en: 'Sit down and rest; see a doctor if palpitations persist.' },
  咳嗽: { 'zh-CN': '先喝点温水，咳得久要去看医生。', pt: 'Beba água morna; se a tosse durar, vá ao médico.', en: 'Drink warm water; see a doctor if the cough lasts.' },
  麻痺: { 'zh-CN': '手脚麻痹要留意，持续的话要去看医生。', pt: 'Preste atenção à dormência; se persistir, vá ao médico.', en: 'Watch numbness; see a doctor if it continues.' },
  氣促: { 'zh-CN': '坐下慢慢喘口气，持续气促要去看医生。', pt: 'Sente-se e respire devagar; se a falta de ar continuar, vá ao médico.', en: 'Sit down and breathe slowly; see a doctor if shortness of breath continues.' },
};

function applyRules(
  text: string,
  rules: Rule[],
  templates: Record<string, TemplateFn>,
): string | null {
  for (const rule of rules) {
    const m = rule.re.exec(text);
    if (m) {
      const fn = templates[rule.id];
      if (fn) return fn(m);
    }
  }
  return null;
}

/** 翻譯 Local Hybrid／gate／safety 的已知模板（無匹配時原句保留）。 */
export function localizeFallbackAnswer(answer: string, locale: AppLocale): string {
  if (locale === 'zh-HK' || !answer) return answer;
  const templates = T[locale] ?? {};
  const hit = applyRules(answer, RULES, templates);
  if (hit !== null) return hit;

  // health_history 動態句（「最近七日…」系列）＋ 趨勢詞
  const trendHit = TREND_WORDS[answer];
  if (trendHit && locale === 'en') return trendHit;

  const localized = answer
    .replace(/最近七日未有(.+?)記錄喎/g, (_s, label) =>
      locale === 'zh-CN' ? `最近七天没有${label}记录` : locale === 'pt' ? `Sem registos de ${label} nos últimos 7 dias` : `No ${label} records in the last 7 days`,
    )
    .replace(/最近七日你平均血壓約 (\d+)\/(\d+) mmHg，(平穩|大致平穩|有上升趨勢|有下降趨勢)/g, (_s, sys, dia, trend) => {
      const trendZh = TREND_MAP[String(trend)] ?? String(trend);
      if (locale === 'zh-CN') return `最近七天您的平均血压约 ${sys}/${dia} mmHg，${TREND_CN[String(trend)] ?? String(trend)}`;
      if (locale === 'pt') return `Nos últimos 7 dias a sua tensão média foi ≈ ${sys}/${dia} mmHg, ${trendZh}`;
      return `Your average blood pressure over the last 7 days is about ${sys}/${dia} mmHg, ${trendZh}`;
    })
    .replace(/最近七日你平均心跳每分鐘約 ([0-9.]+) 下，(平穩|大致平穩|有上升趨勢|有下降趨勢)/g, (_s, rate, trend) => {
      const trendZh = TREND_MAP[String(trend)] ?? String(trend);
      if (locale === 'zh-CN') return `最近七天您平均心跳约每分钟 ${rate} 下，${TREND_CN[String(trend)] ?? String(trend)}`;
      if (locale === 'pt') return `Nos últimos 7 dias o seu ritmo cardíaco médio foi ≈ ${rate} bpm, ${trendZh}`;
      return `Your average heart rate over the last 7 days is about ${rate} bpm, ${trendZh}`;
    })
    .replace(/最近七日你平均(.+?)約 ([0-9.]+)(.*?)，(平穩|大致平穩|有上升趨勢|有下降趨勢)/g, (_s, label, val, unit, trend) => {
      const trendZh = TREND_MAP[String(trend)] ?? String(trend);
      if (locale === 'zh-CN') return `最近七天您的平均${label}约 ${val}${unit}，${TREND_CN[String(trend)] ?? String(trend)}`;
      if (locale === 'pt') return `Nos últimos 7 dias a sua ${label} média foi ≈ ${val}${unit}, ${trendZh}`;
      return `Your average ${label} over the last 7 days is about ${val}${unit}, ${trendZh}`;
    })
    .replace(/。要記得按時量度同記低呀。$/, locale === 'zh-CN' ? '。要记得按时测量并记录。' : locale === 'pt' ? '. Lembre-se de medir e registar a horas.' : '. Remember to measure and record on time.');

  if (localized !== answer) return localized;

  // symptom-list 內嵌建議片段翻譯
  const symptom = RULES.find((r) => r.id === 'symptom-list')?.re.exec(answer);
  if (symptom) {
    const adviceZh = symptom[2];
    const advice = SYMPTOM_ADVICE[adviceZh]?.[locale];
    if (advice) {
      const prefix =
        locale === 'zh-CN'
          ? `听到您有点不舒服，${symptom[1]}要留意一下。`
          : locale === 'pt'
            ? `Percebo que não se sente bem. ${symptom[1]} merece atenção. `
            : `I hear that you are not feeling well. ${symptom[1]} needs attention. `;
      return `${prefix}${advice}`;
    }
  }
  return answer;
}

/** 翻譯補充說明（無匹配時原句保留）。 */
export function localizeFallbackDetailed(
  detailedAnswer: string | undefined,
  locale: AppLocale,
): string | undefined {
  if (!detailedAnswer || locale === 'zh-HK') return detailedAnswer;
  const templates = T[locale] ?? {};
  return applyRules(detailedAnswer, DETAILED_RULES, templates) ?? detailedAnswer;
}
