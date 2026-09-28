/**
 * ועד בית חורון: סימון מיילים לבדיקה, שמירת קבצים ממיילים רלוונטיים, ויומן כניסות לאתר הוועד.
 * פרויקט Apps Script נפרד, שאינו קשור לדאשבורד המשרד.
 *
 * איך זה עובד (שני שלבים):
 * 1. הסקריפט מסמן בתווית "ועד/לבדיקה" כל מייל שעשוי לעסוק בוועד (סינון רחב). הוא לא שומר ממנו כלום.
 * 2. Claude קורא את המיילים שסומנו, ומסמן כל אחד "ועד/רלוונטי" או "ועד/לא רלוונטי".
 * 3. הסקריפט שומר לדרייב קבצים מצורפים רק ממיילים שסומנו "ועד/רלוונטי", ומסמן אותם "ועד/נשמר".
 * המיילים עצמם לא נמחקים ולא מסומנים כנקראו. מתווספות להם תוויות בלבד.
 *
 * setup()             : הרצה אחת. יוצר תיקייה, גיליון כניסות ותוויות.
 * intakeBeitHoron()   : טריגר שעתי. מסמן מיילים חדשים לבדיקה ושומר קבצים ממיילים רלוונטיים.
 * backfillBeitHoron() : הרצה ידנית אחת. מסמן לבדיקה מיילים משנתיים וחצי אחורה. ממשיך לבד עד הסוף.
 * backfillStatus()    : מציג את התקדמות הסריקה ההיסטורית.
 * וואטסאפ            : קובץ ייצוא צ'אט (txt או zip) ששומרים בתיקייה "ועד בית חורון/וואטסאפ" מומר כל שעה
 *                       למסמכי Google בשם "וואטסאפ - <שם השיחה> - חלק NN (<מתאריך> עד <תאריך>)" (ייצוא חדש מחליף את הקודמים),
 *                       והמקור עובר לתת התיקייה "מקור".
 * convertWhatsAppNow(): הרצה ידנית של המרת הוואטסאפ, בלי לחכות לטריגר השעתי.
 * cleanupNoise()      : מעביר מיילים רועשים (קבלות, ארנונה, פנסיה וכו') מ"ועד/לבדיקה" ל"ועד/לא רלוונטי". רץ גם כל שעה.
 * כללי סינון.json   : קובץ בתיקיית ועד בית חורון ש-Claude מעדכן עם שולחים נוספים שלמד שאינם רלוונטיים.
 * doPost(e)           : מקבל רישום כניסה מאתר הוועד ורושם שורה בגיליון.
 */

var ROOT_NAME = 'ועד בית חורון';
var INBOX_NAME = 'קליטה';
var LOG_NAME = 'יומן כניסות לאתר הוועד';
var QUEUE_NAME = 'תור קליטה.json';
var L_CHECK = 'ועד/לבדיקה';
var L_REL = 'ועד/רלוונטי';
var L_IRR = 'ועד/לא רלוונטי';
var L_SAVED = 'ועד/נשמר';
var WA_NAME = 'וואטסאפ';
var WA_DOC_PREFIX = 'וואטסאפ - ';

// כתובות של גורמים שקשורים לוועד. מייל מהם או אליהם מסומן לבדיקה.
var BH_ADDRESSES = [
  'bhmazkir@gmail.com', 'mazkirut.bethoron@gmail.com', 'bethoron@013.net', 'bethoron@013net.net',
  'avishem1@walla.co.il', 'avishem1@walla.com', 'dashma1971@gmail.com', 'a.a.noam@walla.co.il',
  'golan.betty@gmail.com', 'mira.sivan18@gmail.com', 'y.pikel.law@gmail.com', 'nir@urbanics.co.il',
  'Adielnoy@gmail.com', 'binyamin.org.il', 'klitabethoron@gmail.com', 'communityhoron@gmail.com'
];
// מילים שמסמנות מייל לבדיקה גם משולח לא מוכר. Claude מחליט אחר כך אם הוא באמת רלוונטי.
var BH_WORDS = ['"בית חורון"', '"בית-חורון"', '"ישיבת ועד"', '"ישיבת וועד"', '"ועד מקומי"', '"כפר שיתופי"', '"ועד הנהלה"', 'האגודה'];
// שולחים ותוויות שלעולם אינם ענייני ועד: קבלות, ארנונה אישית, פנסיה וביטוח, בית ספר, עבודה במשרד המשפטים.
// מייל מהם אינו מסומן לבדיקה, ו-cleanupNoise() מעביר את מה שכבר סומן לתווית "ועד/לא רלוונטי".
var NOISE_FROM = [
  'anthropic.com', 'eprsys.co.il', 'amitimins.co.il', 'fnx.co.il', 'accounts.google.com', 'payments-noreply@google.com',
  'ksp.co.il', 'cardcom.co.il', '019mobile.co.il', 'schoolapps.co.il', 'aacpa.co.il', 'we-sure.co.il',
  'justice.gov.il', 'padormail.co.il', '6cn.co.il'
];
var NOISE_LABELS = ['פנסיה נקלט', 'תלוש נקלט', 'עמיתים נקלט', 'מסלקה נקלט', 'Tasks/Inbox', 'Dashboard/Inbox'];

var FILTER_FILE = 'כללי סינון.json';

// רשימת הרעש = הרשימה הקבועה שכאן + מה ש-Claude למד ושמר בקובץ "כללי סינון.json" בתיקיית ועד בית חורון.
// כך אפשר לדייק את הסינון בלי להדביק מחדש את הקוד.
function noiseList_() {
  var extra = [];
  try {
    var rootId = PropertiesService.getScriptProperties().getProperty('ROOT_ID');
    var it = DriveApp.getFolderById(rootId).getFilesByName(FILTER_FILE);
    while (it.hasNext()) {
      var j = JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
      extra = extra.concat((j.noiseFrom || []).filter(function (a) { return /^[\w.+-]*@?[\w-]+(\.[\w-]+)+$/.test(a); }));
    }
  } catch (e) { Logger.log('כללי סינון: ' + e.message); }
  var seen = {}, out = [];
  NOISE_FROM.concat(extra).forEach(function (a) { a = a.toLowerCase(); if (!seen[a]) { seen[a] = true; out.push(a); } });
  return out.slice(0, 200);
}

function noiseQuery_() {
  return '(' + noiseList_().map(function (a) { return 'from:' + a; }).join(' OR ') + ' OR ' +
    NOISE_LABELS.map(lq_).join(' OR ') + ')';
}

/** הרצה ידנית: מעביר מיילים רועשים שכבר סומנו "ועד/לבדיקה" לתווית "ועד/לא רלוונטי". */
function cleanupNoise(deadline) {
  var check = getOrCreateLabel_(L_CHECK), irr = getOrCreateLabel_(L_IRR);
  var q = lq_(L_CHECK) + ' ' + noiseQuery_(), total = 0;
  deadline = (typeof deadline === 'number') ? deadline : Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    var threads = GmailApp.search(q, 0, 100);
    if (!threads.length) break;
    irr.addToThreads(threads);
    check.removeFromThreads(threads);
    total += threads.length;
  }
  Logger.log('הועברו ל"ועד/לא רלוונטי": ' + total + ' שרשורים.');
  return total;
}

var SAVE_MIME = /pdf|msword|wordprocessingml|spreadsheetml|ms-excel|opendocument/i;

function setup() {
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_NAME);
  var inbox = getOrCreateFolder_(root, INBOX_NAME);
  var wa = getOrCreateFolder_(root, WA_NAME);
  getOrCreateFolder_(wa, 'מקור');
  var props = PropertiesService.getScriptProperties();
  var logId = props.getProperty('LOG_SHEET_ID');
  var ss;
  if (logId) { try { ss = SpreadsheetApp.openById(logId); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(LOG_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    var sh = ss.getSheets()[0];
    sh.setName('כניסות');
    sh.appendRow(['זמן', 'שם', 'מזהה', 'דפדפן']);
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  props.setProperties({ ROOT_ID: root.getId(), INBOX_ID: inbox.getId(), WA_ID: wa.getId(), LOG_SHEET_ID: ss.getId() });
  [L_CHECK, L_REL, L_IRR, L_SAVED].forEach(getOrCreateLabel_);
  Logger.log('תיקייה: ' + root.getUrl());
  Logger.log('גיליון כניסות: ' + ss.getUrl());
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var id = String(body.id || '').slice(0, 40);
    var name = String(body.n || '').slice(0, 80);
    if (!/^m-[a-z0-9-]+$/.test(id)) return ContentService.createTextOutput('ignored');
    var lock = LockService.getScriptLock();
    lock.tryLock(5000);
    var sh = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID')).getSheets()[0];
    sh.appendRow([new Date(), name, id, String(body.ua || '').slice(0, 120)]);
    lock.releaseLock();
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error');
  }
}

function doGet() {
  return ContentService.createTextOutput('ועד בית חורון: פעיל');
}

/** טריגר שעתי: מסמן לבדיקה מיילים מהיומיים האחרונים, ושומר קבצים ממיילים שסומנו רלוונטיים. */
function intakeBeitHoron() {
  var deadline = Date.now() + 4 * 60 * 1000;
  var marked = markCandidates_(candidateQuery_() + ' newer_than:2d', 0, 100);
  var wa = 0;
  try { wa = convertWhatsApp_(Date.now() + 2 * 60 * 1000); } catch (e) { Logger.log('וואטסאפ: ' + e.message); }
  var saved = saveRelevant_(deadline);
  try { cleanupNoise(Math.min(deadline, Date.now() + 30 * 1000)); } catch (e) { Logger.log('ניקוי רעש: ' + e.message); }
  Logger.log('סומנו לבדיקה: ' + marked + ' שרשורים. נשמרו קבצים מ-' + saved + ' הודעות רלוונטיות. הומרו ' + wa + ' ייצואי וואטסאפ.');
}

/** הרצה ידנית אחת: מסמן לבדיקה מיילים משנתיים וחצי אחורה. ממשיך לבד כל דקה עד שמסיים. */
function backfillBeitHoron() {
  var props = PropertiesService.getScriptProperties();
  var deadline = Date.now() + 4 * 60 * 1000;
  var since = props.getProperty('BF2_SINCE');
  if (!since) {
    var d = new Date(); d.setMonth(d.getMonth() - 30);
    since = Utilities.formatDate(d, 'Asia/Jerusalem', 'yyyy/MM/dd');
    props.setProperty('BF2_SINCE', since);
    props.setProperty('BF2_COUNT', '0');
  }
  // מחפש רק מיילים שעוד לא סומנו, ולכן אין צורך לזכור מיקום ואין כפילויות
  var q = candidateQuery_() + ' after:' + since;
  var total = Number(props.getProperty('BF2_COUNT') || 0), finished = false;
  while (Date.now() < deadline) {
    var n = markCandidates_(q, 0, 100);
    total += n;
    if (n === 0) { finished = true; break; }
  }
  props.setProperty('BF2_COUNT', String(total));
  clearBackfillTriggers_();
  if (finished) {
    props.setProperty('BF2_DONE', new Date().toISOString());
    Logger.log('הסריקה ההיסטורית הסתיימה. סומנו לבדיקה ' + total + ' שרשורים מאז ' + since + '.');
  } else {
    ScriptApp.newTrigger('backfillBeitHoron').timeBased().after(60 * 1000).create();
    Logger.log('סומנו עד כה ' + total + ' שרשורים. ממשיך אוטומטית בעוד דקה.');
  }
}

function backfillStatus() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('מאז: ' + p.getProperty('BF2_SINCE') + ' | סומנו לבדיקה: ' + p.getProperty('BF2_COUNT') +
    ' | הסתיים: ' + (p.getProperty('BF2_DONE') || 'עדיין לא'));
}

// ---------- פנימי ----------

function candidateQuery_() {
  var who = BH_ADDRESSES.map(function (a) { return 'from:' + a + ' OR to:' + a + ' OR cc:' + a; }).join(' OR ');
  return '(' + who + ' OR ' + BH_WORDS.join(' OR ') + ' OR subject:ועד)' +
    ' -' + lq_(L_CHECK) + ' -' + lq_(L_REL) + ' -' + lq_(L_IRR) +
    ' -from:calendar-notification@google.com -from:nevopublishing.co.il -category:promotions -category:social -in:chats' +
    ' -' + noiseQuery_();
}

// מסמן לבדיקה עד max שרשורים. מחזיר כמה סומנו.
function markCandidates_(q, start, max) {
  var threads = GmailApp.search(q, start, max);
  if (!threads.length) return 0;
  var label = getOrCreateLabel_(L_CHECK);
  for (var i = 0; i < threads.length; i += 100) label.addToThreads(threads.slice(i, i + 100));
  return threads.length;
}

// שומר קבצים מצורפים ממיילים שסומנו רלוונטיים.
function saveRelevant_(deadline) {
  var props = PropertiesService.getScriptProperties();
  var inboxId = props.getProperty('INBOX_ID');
  if (!inboxId) { setup(); inboxId = props.getProperty('INBOX_ID'); }
  var inbox = DriveApp.getFolderById(inboxId);
  var savedLabel = getOrCreateLabel_(L_SAVED);
  var queue = readQueue_(inbox);
  var known = {};
  queue.items.forEach(function (it) { known[it.messageId] = true; });
  var added = 0;
  // שרשורים רלוונטיים שעוד לא נשמרו, ושרשורים רלוונטיים שקיבלו הודעה חדשה
  var lists = [
    GmailApp.search(lq_(L_REL) + ' has:attachment -' + lq_(L_SAVED), 0, 30),
    GmailApp.search(lq_(L_REL) + ' has:attachment newer_than:3d', 0, 30)
  ];
  lists.forEach(function (threads) {
    threads.forEach(function (th) {
      if (Date.now() > deadline) return;
      th.getMessages().forEach(function (msg) {
        if (known[msg.getId()]) return;
        var files = [];
        msg.getAttachments({ includeInlineImages: false }).forEach(function (att) {
          try {
            if (!SAVE_MIME.test(att.getContentType())) return;
            var f = inbox.createFile(att.copyBlob()).setName(stamp_(msg.getDate()) + ' ' + att.getName());
            f.setDescription(JSON.stringify({ threadId: th.getId(), messageId: msg.getId(), subject: msg.getSubject(), from: msg.getFrom() }));
            files.push({ name: f.getName(), id: f.getId(), mimeType: att.getContentType(), url: f.getUrl() });
          } catch (e) { Logger.log('דילוג על קובץ: ' + att.getName() + ' (' + e.message + ')'); }
        });
        known[msg.getId()] = true;
        if (!files.length) return;
        queue.items.push({
          threadId: th.getId(), messageId: msg.getId(), subject: msg.getSubject(), from: msg.getFrom(),
          date: msg.getDate().toISOString(), savedAt: new Date().toISOString(), files: files, processed: false
        });
        added++;
      });
      th.addLabel(savedLabel);
      queue.items = queue.items.slice(-5000);
      writeQueue_(inbox, queue);
    });
  });
  return added;
}

// ממיר ייצואי וואטסאפ (txt או zip) למסמכי Google שאפשר לקרוא
// ייצוא וואטסאפ ארוך מדי למסמך Google אחד, ולכן הוא מפוצל לחלקים של כ-45 אלף תווים.
// כל חלק הוא מסמך "וואטסאפ - <שם השיחה> - חלק NN (<מתאריך> עד <תאריך>)". נשמרות רק הודעות מ-WA_SINCE.
var WA_CHUNK = 45000;
var WA_SINCE = '2024-03-01';

/** הרצה ידנית: ממיר עכשיו את ייצואי הוואטסאפ שבתיקייה ומציג מה נעשה. */
function convertWhatsAppNow() {
  clearTriggers_('convertWhatsAppNow');
  var n = convertWhatsApp_(Date.now() + 4.5 * 60 * 1000);
  var job = PropertiesService.getScriptProperties().getProperty('WA_JOB');
  if (job) {
    ScriptApp.newTrigger('convertWhatsAppNow').timeBased().after(60 * 1000).create();
    var j = JSON.parse(job);
    Logger.log('וואטסאפ "' + j.chat + '": נוצרו ' + j.done + ' מתוך ' + j.parts + ' חלקים. ממשיך אוטומטית בעוד דקה.');
  } else {
    Logger.log('הומרו ' + n + ' ייצואי וואטסאפ. ההמרה הושלמה.');
  }
}

function clearTriggers_(fn) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t); });
}

function waClean_(s) { return String(s).replace(/[‎‏‪-‮⁦-⁩﻿]/g, ''); }

function waChatName_(name) {
  var s = waClean_(name).replace(/\.(txt|zip)$/i, '').trim();
  s = s.replace(/^WhatsApp Chat (with|-)\s*/i, '')
       .replace(/^(צ['׳]?אט|שיחת) WhatsApp עם\s*/, '')
       .replace(/\s*\(\d+\)$/, '').trim();
  return s || 'ללא שם';
}

// תאריך הודעה בפורמט yyyy-mm-dd, או null אם השורה היא המשך של הודעה קודמת. יום לפני חודש, כמקובל בישראל.
function waDate_(line) {
  var m = waClean_(line).match(/^\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),/);
  if (!m) return null;
  var y = m[3].length === 2 ? '20' + m[3] : m[3];
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}

function waChunks_(text) {
  var lines = text.split(/\r?\n/), chunks = [], cur = [], len = 0, first = null, last = null, keep = false;
  function flush() {
    if (cur.length) chunks.push({ first: first, last: last, text: cur.join('\n') });
    cur = []; len = 0; first = null;
  }
  lines.forEach(function (line) {
    var d = waDate_(line);
    if (d) {
      keep = d >= WA_SINCE;
      if (keep && len >= WA_CHUNK) flush();
      if (keep) { if (!first) first = d; last = d; }
    }
    if (keep) { cur.push(line); len += line.length + 1; }
  });
  flush();
  return chunks;
}

// מנקה תווים שמסמכי Google לא מקבלים (תווי בקרה ותווים שבורים).
function waSanitize_(t) {
  return String(t)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
    .replace(/\r\n?/g, '\n');
}

// יוצר מסמך Google עם הטקסט. אם השירות נכשל, כותב את הטקסט בקטעים קטנים יותר ומנסה שוב.
function waWriteDoc_(docName, text) {
  text = waSanitize_(text);
  var doc = DocumentApp.create(docName), id = doc.getId();
  try {
    doc.getBody().setText(text);
    doc.saveAndClose();
    return id;
  } catch (e) {
    Logger.log('כתיבה למסמך "' + docName + '" נכשלה (' + e.message + '). מנסה בקטעים.');
  }
  Utilities.sleep(2000);
  doc = DocumentApp.openById(id);
  var body = doc.getBody();
  body.setText('');
  var lines = text.split('\n'), buf = [], len = 0;
  function flush() {
    if (!buf.length) return;
    body.appendParagraph(buf.join('\n'));
    buf = []; len = 0;
  }
  for (var i = 0; i < lines.length; i++) {
    buf.push(lines[i]); len += lines[i].length + 1;
    if (len >= 5000) flush();
  }
  flush();
  doc.saveAndClose();
  return id;
}

function convertWhatsApp_(deadline) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 0; // המרה אחרת כבר רצה
  try { return convertWhatsAppLocked_(deadline); } finally { lock.releaseLock(); }
}

function convertWhatsAppLocked_(deadline) {
  deadline = deadline || Date.now() + 3 * 60 * 1000;
  var props = PropertiesService.getScriptProperties();
  var waId = props.getProperty('WA_ID');
  if (!waId) { setup(); waId = props.getProperty('WA_ID'); }
  var wa = DriveApp.getFolderById(waId);
  var archive = getOrCreateFolder_(wa, 'מקור');
  // המרה שהתחילה ולא הסתיימה ממשיכה מהחלק שבו נעצרה
  var job = props.getProperty('WA_JOB') ? JSON.parse(props.getProperty('WA_JOB')) : null;
  var files = [];
  if (job) {
    try { files.push(DriveApp.getFileById(job.fileId)); } catch (e) { props.deleteProperty('WA_JOB'); job = null; }
  }
  if (!job) {
    var it = wa.getFiles();
    while (it.hasNext()) { var f0 = it.next(); if (f0.getMimeType() !== MimeType.GOOGLE_DOCS) files.push(f0); }
  }
  var n = 0;
  for (var k = 0; k < files.length; k++) {
    if (Date.now() > deadline) break;
    var f = files[k], mime = f.getMimeType(), name = f.getName(), text = null;
    if (/\.zip$/i.test(name) || /zip/i.test(mime)) {
      var best = null;
      Utilities.unzip(f.getBlob()).forEach(function (b) {
        if (/\.txt$/i.test(b.getName()) && (!best || b.getBytes().length > best.getBytes().length)) best = b;
      });
      if (best) text = best.getDataAsString('UTF-8');
    } else if (/\.txt$/i.test(name) || /text\/plain/i.test(mime)) {
      text = f.getBlob().getDataAsString('UTF-8');
    }
    if (text === null) continue;
    var chat = waChatName_(name);
    var chunks = waChunks_(text);
    if (!job) {
      // ייצוא חדש: מחיקת החלקים הקודמים של אותה שיחה (מסמכים שהסקריפט יצר בלבד)
      var docs = wa.getFilesByType(MimeType.GOOGLE_DOCS);
      while (docs.hasNext()) {
        var d = docs.next(), dn = waClean_(d.getName());
        if (dn.indexOf(WA_DOC_PREFIX) !== 0) continue;
        var dc = waChatName_(dn.slice(WA_DOC_PREFIX.length).replace(/\s+-\s+חלק \d+.*$/, ''));
        if (dc === chat) d.setTrashed(true);
      }
      job = { fileId: f.getId(), chat: chat, exportedAt: new Date().toISOString(), done: 0, parts: chunks.length };
      props.setProperty('WA_JOB', JSON.stringify(job));
    }
    for (var i = job.done; i < chunks.length; i++) {
      if (Date.now() > deadline) return n;
      var c = chunks[i], part = ('0' + (i + 1)).slice(-2);
      var docName = WA_DOC_PREFIX + chat + ' - חלק ' + part + ' (' + c.first + ' עד ' + c.last + ')';
      var id = waWriteDoc_(docName, c.text);
      var file = DriveApp.getFileById(id);
      file.moveTo(wa);
      file.setDescription(JSON.stringify({ chat: chat, part: i + 1, parts: chunks.length, first: c.first, last: c.last, exportedAt: job.exportedAt, source: name }));
      job.done = i + 1;
      props.setProperty('WA_JOB', JSON.stringify(job));
    }
    f.moveTo(archive);
    props.deleteProperty('WA_JOB');
    Logger.log('וואטסאפ "' + chat + '": ' + chunks.length + ' חלקים, מ-' + (chunks[0] ? chunks[0].first : '-') + ' עד ' + (chunks.length ? chunks[chunks.length - 1].last : '-'));
    job = null;
    n++;
  }
  return n;
}

function lq_(name) { return 'label:' + name.replace(/[\/ ]/g, '-'); }

function clearBackfillTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backfillBeitHoron') ScriptApp.deleteTrigger(t);
  });
}
function readQueue_(folder) {
  var it = folder.getFilesByName(QUEUE_NAME);
  if (!it.hasNext()) return { items: [] };
  try { var j = JSON.parse(it.next().getBlob().getDataAsString('UTF-8')); return j.items ? j : { items: j }; }
  catch (e) { return { items: [] }; }
}
function writeQueue_(folder, queue) {
  var it = folder.getFilesByName(QUEUE_NAME);
  var text = JSON.stringify(queue, null, 1);
  if (it.hasNext()) it.next().setContent(text);
  else folder.createFile(QUEUE_NAME, text, 'application/json');
}
function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
function stamp_(d) {
  return Utilities.formatDate(d, 'Asia/Jerusalem', 'yyyy-MM-dd');
}