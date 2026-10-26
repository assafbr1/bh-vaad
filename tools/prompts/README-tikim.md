# הנחיות המשימות המתוזמנות של דאשבורד התיקים (26.10.2026)

## סנכרון לילי (trig_01AmoC2ycZWkUVaa1ytt9CqJ, 00:30 UTC כל יום)

עבר למבנה ההנחיה המקוצרת, כמו ריצות ועד בית חורון:

- `boot-tikim-nightly.txt`: ההנחיה המקוצרת השמורה במשימה. העותק כאן זהה לנוסח השמור, למעט סיסמת ההצפנה של אתר הגיבוי, שכתובה רק במשימה עצמה וכאן מופיע במקומה מקום שמור.
- `tikim-nightly.txt`: ההוראות המלאות (בלי הסיסמה). הריצה טוענת אותן מ-main ופועלת רק אם ה-git hash-object של הקובץ זהה ל-sha שבהנחיה המקוצרת.

שינוי בהוראות: עורכים את `tikim-nightly.txt` ודוחפים ל-main; מחשבים git hash-object; מעדכנים את ה-sha (בשני המקומות) ב-`boot-tikim-nightly.txt`, דוחפים, ושולחים ב-update_trigger את הטקסט המלא שלו עם הסיסמה האמיתית במקום המקום השמור.

חלק א של הריצה (אתר הגיבוי) דוחף פרוסות של 10,000 תווים ו-data.enc.sha256 לענף build-YYYYMMDD-tikim במאגר הציבורי assafbr1/tikim-dashboard, והפעולה publish-build שם מאחה, מאמתת ומפרסמת את data.enc.txt ל-main. הכלים: tools/make_data_parts.py ו-tools/verify_site_data.py באותו מאגר.

## בניית קוד אתר הגיבוי (trig_015QkJiiawndy8cgyAJ31jzv, שבת 23:30 UTC)

ההנחיה קצרה ושמורה במשימה עצמה (אין כאן עותק). מ-26.10.2026: build_site.py מהפרויקט כמו קודם, ואחריו tools/make_app_parts.py מפצל את site.html לפרוסות app.b64.part-NN.txt עם app.b64.sha256 ו-app.manifest.json; הכל נדחף לענף build-YYYYMMDD-app, ו-publish-build מפענח, בודק HTML, בודק בדפדפן (tools/browser_check.py) ומפרסם ל-main. index.html של האתר טוען לפי ה-manifest. אימות: tools/verify_site_app.py.
