import "./page-title.css";

/**
 * عنوان صفحة المشغّل (0005 §٢١٢): عناوين الإطارات المرسومة جملتان بشرطة — «الاسم — السياسة».
 * الكلمات لا تُختصر (نصوص مرسومة)، لكن ما بعد الشرطة سطرٌ ثانوي أصغر داخل العنوان نفسه، فيبقى اسم
 * الصفحة قصيراً بصرياً والنص كاملاً لقارئ الشاشة والمواصفات.
 */
export function PageTitle({ text }: { text: string }) {
  const i = text.indexOf(" — ");
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="plt-title__sub">
        <span className="visually-hidden">— </span>
        {text.slice(i + 3)}
      </span>
    </>
  );
}
