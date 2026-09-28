/**
 * ועד בית חורון: קליטת רישומים מאתר הצפייה. גרסה 3.1 (28.9.2026).
 * קובץ זה מחליף את כל התוכן של פרויקט ה-Apps Script "סקריפט הרישום ועד בית חורון".
 *
 * שלושה סוגי רישום:
 *   1. כניסה לאתר: נרשמת בגיליון הראשון של "יומן כניסות לאתר הוועד".
 *   2. דיווח התקדמות (type = 'progress'): נרשם בקובץ נפרד, "עדכוני התקדמות מאתר הוועד".
 *   3. סימון דחיפות (גרסה 1.3): דיווח התקדמות שהטקסט שלו מתחיל ב-"#דחוף " או "#לא-דחוף ".
 *      נרשם כמו כל דיווח, ובנוסף נשמר ברשימה זמנית שהאתר קורא מיד (?urgent=1), ונשלח מייל לאסף.
 *      הריצה הלילית או ריצת הצהריים מאמתת את החתימה ומקבעת את הסימון בנתונים.
 *
 * בדיקה בדפדפן: <כתובת הסקריפט>/exec מחזירה "bh-log v3"; <כתובת הסקריפט>/exec?urgent=1 מחזירה את רשימת הדחיפות.
 */
var BH_LOGIN_SHEET_ID = '1Q5n79EMrGYIFoNBr4rNG6O_IjaSTJD24GVGn7c3VPQ4';       // יומן כניסות לאתר הוועד
var BH_PROGRESS_SHEET_ID = '1JnY5Wo6yGX-t1VN93nVeL8DbhuljIZqPiSWkOfh7sOw';    // עדכוני התקדמות מאתר הוועד
var BH_PROGRESS_HEADER = ['זמן קבלה', 'זמן שליחה', 'מזהה', 'שם', 'מזהה משימה', 'משימה', 'סטטוס', 'בקשת סגירה', 'עדכון', 'חתימה'];
var BHV_URGENT_MAIL = 'assafbr1@gmail.com';   // כתובת המייל שמקבלת הודעה על כל סימון דחיפות

function doGet(e) {
  if (e && e.parameter && e.parameter.urgent) {
    var list = PropertiesService.getScriptProperties().getProperty('bhv_urgent') || '{}';
    return ContentService.createTextOutput(list).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput('bh-log v3.1');
}

function doPost(e) {
  try { bhvUrgentHook(e); } catch (err) {}
  var raw = (e && e.postData && e.postData.contents) || '';
  if (raw.length > 6000) return ContentService.createTextOutput('too long');
  var body = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch (err) {
    return ContentService.createTextOutput('bad request');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.type === 'progress') {
      bhWriteProgress_(body);
    } else {
      bhWriteLogin_(body);
    }
    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}

// דיווח התקדמות: שורה חדשה בקובץ הנפרד, כל התאים כטקסט
function bhWriteProgress_(body) {
  var ss = SpreadsheetApp.openById(BH_PROGRESS_SHEET_ID);
  var sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(BH_PROGRESS_HEADER);
    sh.setFrozenRows(1);
  }
  var row = [
    Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm:ss'),
    bhSafe_(body.t, 40),
    bhSafe_(body.id, 40),
    bhSafe_(body.n, 80),
    bhSafe_(body.task, 80),
    bhSafe_(body.title, 200),
    bhSafe_(body.status, 20),
    body.close ? 'כן' : '',
    bhSafe_(body.text, 2000),
    bhSafe_(body.sig, 80)
  ];
  var r = sh.getLastRow() + 1;
  var range = sh.getRange(r, 1, 1, row.length);
  range.setNumberFormat('@');   // טקסט בלבד: אין המרה לתאריך או למספר
  range.setValues([row]);
}

// כניסה לאתר: רישום בגיליון הראשון של יומן הכניסות
function bhWriteLogin_(body) {
  var ss = SpreadsheetApp.openById(BH_LOGIN_SHEET_ID);
  var log = ss.getSheets()[0];
  log.appendRow([new Date(), bhSafe_(body.n, 80), bhSafe_(body.id, 40), bhSafe_(body.ua, 200)]);
}

// מונע הזרקת נוסחאות לגיליון וחותך טקסט ארוך
function bhSafe_(v, max) {
  var s = String(v == null ? '' : v).slice(0, max || 500);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// ═══════════════════════════════════════════════════════════════
//  דחיפות מיידית (גרסה 1.3, 28.9.2026)
// ═══════════════════════════════════════════════════════════════

// נקרא מתוך doPost. אם טקסט העדכון מתחיל ב-"#דחוף " או "#לא-דחוף ",
// הסימון נשמר ברשימה זמנית שהאתר קורא מיד, ונשלח מייל לאסף.
function bhvUrgentHook(e) {
  if (!e || !e.postData || !e.postData.contents) return;
  var b = JSON.parse(e.postData.contents);
  if (b.type !== 'progress' || !b.task) return;
  var m = String(b.text || '').match(/^#(דחוף|לא-דחוף)\s*/);
  if (!m) return;
  var on = m[1] === 'דחוף';
  var props = PropertiesService.getScriptProperties();
  var list = {};
  try { list = JSON.parse(props.getProperty('bhv_urgent') || '{}'); } catch (err) { list = {}; }
  // ניקוי רשומות ישנות מ-60 יום
  var cutoff = Date.now() - 60 * 864e5;
  Object.keys(list).forEach(function (k) {
    var t = new Date(list[k].t).getTime();
    if (!t || t < cutoff) delete list[k];
  });
  var when = b.t || new Date().toISOString();
  list[String(b.task)] = { u: on ? 1 : 0, t: when, by: String(b.n || '').slice(0, 60) };
  props.setProperty('bhv_urgent', JSON.stringify(list));

  var text = String(b.text || '').slice(m[0].length).trim();
  var subject = (on ? 'דחוף: ' : 'הוסר סימון דחוף: ') + (b.title || b.task);
  var body = (b.n || 'חבר ועד') + (on ? ' סימן/ה כדחופה את המשימה' : ' הסיר/ה את סימון הדחיפות מהמשימה') +
    ': ' + (b.title || b.task) + '\n' +
    (text ? 'עדכון: ' + text + '\n' : '') +
    'זמן: ' + when + '\n' +
    'הסימון כבר מוצג באתר הוועד. הוא ייקלט בלוח העריכה בריצה הבאה.';
  try { MailApp.sendEmail(BHV_URGENT_MAIL, subject, body); }
  catch (err) { console.error('bhv mail failed: ' + err); }
}

// בדיקה ידנית: בחר את הפונקציה הזו בתפריט הפונקציות ולחץ "הפעלה".
// אם השליחה נכשלת, השגיאה תופיע ביומן הביצוע. אם היא מצליחה, יגיע מייל "בדיקת מייל מסקריפט הרישום".
function bhvTestMail() {
  MailApp.sendEmail(BHV_URGENT_MAIL, 'בדיקת מייל מסקריפט הרישום', 'אם קיבלת את המייל הזה, שליחת המיילים מהסקריפט עובדת.');
  console.log('נשלח מייל בדיקה אל ' + BHV_URGENT_MAIL);
}