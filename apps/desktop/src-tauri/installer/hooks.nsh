; نصّ صفحة الترحيب في مثبّت ويندوز (docs/decisions 0005 §٢٥٨).
; يُضمَّن هذا الملف في أول قالب Tauri (installer.nsi) قبل صفحاته، فيقرأ MUI_PAGE_WELCOME هذا النص.
; سطران بالعربية ثم سطران بالإنجليزية: لغة المثبّت يختارها المستخدم، والنص الثابت يخدم اللغتين بلا
; ملفات لغة مخصّصة (تلك تستبدل ملفات Tauri كلها وتنكسر مع كل ترقية له).
; الإرشاد المفصّل — المزايا وخطوات تهيئة الجهاز — في شاشة الترحيب داخل التطبيق عند أول تشغيل.
; الملف UTF-8 مع BOM عمداً: بلا BOM يقرؤه NSIS بترميز النظام فتفسد الحروف العربية.
!define /ifndef MUI_WELCOMEPAGE_TEXT "فيزانو بلص: نقطة بيع ومخزون وذمم تعمل بلا إنترنت.$\r$\nبعد التثبيت ادخل بحسابك واختر الطابعة وافتح الوردية.$\r$\n$\r$\nVezano Plus: point of sale, inventory and customer ledger that work offline.$\r$\nAfter installing: sign in, choose your printer, open a shift."
