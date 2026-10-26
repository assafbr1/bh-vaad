# הנחיות המשימות המתוזמנות של דאשבורד התיקים (26.10.2026)

## הועבר (26.10.2026, 14:20 UTC)

ההוראות המלאות וההנחיה המקוצרת של הסנכרון הלילי עברו למאגר הפרטי `assafbr1/skills-backup`, תיקיית `tasks`, לפי החלטת אסף (שם יושבות כל ההנחיות של המשימות המתוזמנות):

- `skills-backup/tasks/sync-nightly-prompt.txt`: ההוראות המלאות (בלי הסיסמה). sha ffa88a33f91d861233866f8fcd5498bf316dc2c7. המשימה טוענת מהנתיב הזה.
- `skills-backup/tasks/sync-nightly-boot.txt`: עותק ההנחיה המקוצרת (מקום שמור במקום הסיסמה).

הקבצים `tikim-nightly.txt` ו-`boot-tikim-nightly.txt` שכאן הם עותקים ישנים ואינם בשימוש; אין לערוך אותם. (הטקסט המלא זהה כרגע לקובץ ב-skills-backup, אבל המשימה קוראת רק משם.)

## סנכרון לילי (trig_01AmoC2ycZWkUVaa1ytt9CqJ, 00:30 UTC כל יום)

מבנה ההנחיה המקוצרת, כמו ריצות ועד בית חורון: ההנחיה השמורה במשימה טוענת את ההוראות המלאות מ-main של skills-backup ופועלת רק אם ה-git hash-object של הקובץ זהה ל-sha שבהנחיה המקוצרת. הסיסמה של אתר הגיבוי כתובה רק במשימה עצמה.

שינוי בהוראות: עורכים את `tasks/sync-nightly-prompt.txt` ב-skills-backup ודוחפים ל-main; מחשבים git hash-object; מעדכנים את ה-sha (בשני המקומות) ב-`tasks/sync-nightly-boot.txt`, דוחפים, ושולחים ב-update_trigger את הטקסט המלא שלו עם הסיסמה האמיתית במקום המקום השמור. אחרי כל שינוי: בדיקת טעינה בסוכן נפרד (טעינת הקובץ ואימות ה-hash) וריצה ידנית.

חלק א של הריצה (אתר הגיבוי) דוחף פרוסות של 10,000 תווים ו-data.enc.sha256 לענף build-YYYYMMDD-tikim במאגר הציבורי assafbr1/tikim-dashboard, והפעולה publish-build שם מאחה, מאמתת ומפרסמת את data.enc.txt ל-main. הכלים: tools/make_data_parts.py ו-tools/verify_site_data.py באותו מאגר. המשימה רצה על claude-opus-5-5 (מ-26.10.2026).

## בניית קוד אתר הגיבוי (trig_015QkJiiawndy8cgyAJ31jzv, שבת 23:30 UTC)

ההנחיה קצרה ושמורה במשימה עצמה (אין כאן עותק). מ-26.10.2026: build_site.py מהפרויקט כמו קודם, ואחריו tools/make_app_parts.py מפצל את site.html לפרוסות app.b64.part-NN.txt עם app.b64.sha256 ו-app.manifest.json; הכל נדחף לענף build-YYYYMMDD-app, ו-publish-build מפענח, בודק HTML, בודק בדפדפן (tools/browser_check.py) ומפרסם ל-main. index.html של האתר טוען לפי ה-manifest. אימות: tools/verify_site_app.py. המשימה רצה על claude-opus-5-5 (מ-26.10.2026).
