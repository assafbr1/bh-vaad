/**
 * בקרת תקינות: ועד בית חורון, גרסה 1.4 (28.9.2026)
 *
 * קובץ נפרד בפרויקט "סקריפט הקליטה ועד בית חורון". אין לשנות את הקוד הקיים.
 * הטריגר השעתי מפעיל מעכשיו את intakeWithHeartbeat במקום intakeBeitHoron.
 * הפונקציה מריצה את הקליטה הרגילה ורושמת "דופק" בגיליון "יומן כניסות לאתר הוועד",
 * בלשונית "דופק": מתי רצה, אם הצליחה, ומה הייתה השגיאה. ריצת הלילה וריצת הצהריים
 * של Claude קוראות את הלשונית: אם אין דופק יותר משעתיים, אסף מקבל התראה.
 * בנוסף, בכשל בקוד הקליטה נשלח לאסף מייל מיד (לכל היותר אחד לשש שעות).
 * כשל הרשאה (Authorization is required) מונע את הריצה כולה, ולכן לא נרשם דופק;
 * גם זה מזוהה, כי הדופק מפסיק.
 */

var HEALTH_SHEET_ID = '1Q5n79EMrGYIFoNBr4rNG6O_IjaSTJD24GVGn7c3VPQ4';
var HEALTH_TAB = 'דופק';
var HEALTH_ALERT_TO = 'assafbr1@gmail.com';
var HEALTH_MAX_ROWS = 200;
var HEALTH_ALERT_GAP_MS = 6 * 60 * 60 * 1000;

/** הפונקציה שהטריגר השעתי מפעיל. */
function intakeWithHeartbeat() {
  var t0 = Date.now();
  var status = 'ok', details = '';
  try {
    var r = intakeBeitHoron();
    if (typeof r === 'string') details = r;
  } catch (e) {
    status = 'error';
    details = String((e && e.stack) || (e && e.message) || e);
    writeHeartbeat_('intakeBeitHoron', status, details, t0);
    alertOnce_(details);
    throw e;
  }
  writeHeartbeat_('intakeBeitHoron', status, details, t0);
}

/** להרצה ידנית אחת אחרי ההתקנה: מאשר הרשאות ורושם דופק בדיקה. */
function healthSelfTest() {
  var t0 = Date.now();
  writeHeartbeat_('healthSelfTest', 'ok', 'בדיקה ידנית של בקרת התקינות', t0);
  return 'נרשם דופק בדיקה בלשונית "' + HEALTH_TAB + '"';
}

function writeHeartbeat_(fn, status, details, t0) {
  try {
    var ss = SpreadsheetApp.openById(HEALTH_SHEET_ID);
    var sh = ss.getSheetByName(HEALTH_TAB);
    if (!sh) {
      sh = ss.insertSheet(HEALTH_TAB);
      sh.getRange(1, 1, 1, 6).setValues([['זמן', 'פונקציה', 'סטטוס', 'פרטים', 'משך (שניות)', 'זמן ISO']]);
      sh.setFrozenRows(1);
    }
    var now = new Date();
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 6).setValues([[
      now, fn, status, String(details || '').slice(0, 500),
      Math.round((Date.now() - t0) / 1000), now.toISOString()
    ]]);
    sh.getRange(2, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    var last = sh.getLastRow();
    if (last > HEALTH_MAX_ROWS + 1) sh.deleteRows(HEALTH_MAX_ROWS + 2, last - HEALTH_MAX_ROWS - 1);
  } catch (e) {
    console.error('רישום הדופק נכשל: ' + e);
  }
}

function alertOnce_(details) {
  try {
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('HEALTH_LAST_ALERT') || 0);
    if (Date.now() - last < HEALTH_ALERT_GAP_MS) return;
    props.setProperty('HEALTH_LAST_ALERT', String(Date.now()));
    MailApp.sendEmail({
      to: HEALTH_ALERT_TO,
      subject: 'תקלה בסקריפט הקליטה ועד בית חורון',
      body: 'סקריפט הקליטה נכשל בריצה השעתית.\n\nהשגיאה:\n' + String(details || '').slice(0, 1500) +
        '\n\nמה לעשות: לפתוח את הפרויקט ב-Apps Script, לבחור בסרגל העליון את intakeWithHeartbeat וללחוץ "הפעלה". ' +
        'אם נפתח חלון הרשאות, לאשר. אם השגיאה חוזרת, לשלוח את הצילום ל-Claude.\n\n' +
        'הודעה זו נשלחת לכל היותר אחת לשש שעות. פרטי כל הריצות בלשונית "' + HEALTH_TAB + '" של יומן הכניסות.'
    });
  } catch (e) {
    console.error('שליחת ההתראה נכשלה: ' + e);
  }
}
