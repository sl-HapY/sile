# «Sile» — کلاینت انتقال فایل مدرن (جایگزین FileZilla)

## تصمیم‌های کلیدی فنی
- **Tauri 2 (Rust)** به‌عنوان هسته دسکتاپ — نصب‌کننده سبک و نتیو.
- **React 18 + TypeScript + Vite** برای فرانت‌اند.
- **دیزاین Material 3 اختصاصی** (توکن‌های M3، ripple، light/dark + رنگ accent قابل‌انتخاب) + **lucide-react** برای آیکون‌ها.
- **CodeMirror 6** برای ادیتور کد داخلی + رنگ‌آمیزی سینتکس ده‌ها زبان.
- **پروتکل‌ها در Rust**: FTP/FTPS با `suppaftp`، SFTP با `russh`، فایل‌سیستم محلی، WebDAV اختیاری.
- زبان رابط: فقط انگلیسی.

## امکانات
1. Dual-pane browser (Local | Remote)، تب‌های چندگانه، درخت پوشه، breadcrumb، status bar، log console.
2. مرورگر فایل با لیست/گرید، drag & drop دوطرفه، rename/delete/copy/move/new، context menu.
3. موتور انتقال: صف انتقال، progress سرعت/ETA، pause/resume/cancel، retry خودکار، انتقال بازگشتی پوشه، حفظ timestamp.
4. پریویو: عکس (zoom/pan/rotate)، **مدیاپلیر داخلی** برای ویدیو/صدا، PDF، Markdown، hex view برای باینری، متنی با highlight.
5. **ادیتور کد**: تب‌های چندگانه، جستجو/جایگزینی، ذخیره مستقیم روی سرور ریموت.
6. Site Manager (رمزهای عبور رمزنگاری‌شده)، Bookmarks، Quick Connect.
7. اضافه‌ها: Command Palette (Ctrl+K)، جستجوی بازگشتی ریموت، ادیتور chmod، checksum (MD5/SHA256)، مقایسه و Sync پوشه‌ها.

## نصب‌کننده و خروجی EXE (طبق درخواست شما)
- در پایان، `npm run tauri build` را اجرا می‌کنم و **فایل نصب‌کننده EXE (NSIS installer) ویندوز** را در مسیر `E:\Sile\src-tauri\target\release\bundle\nsis\Sile_<version>_x64-setup.exe` تحویل می‌دهم.
- پیکربندی NSIS داخل Tauri تنظیم می‌شود (نصب‌کننده با شورتکات دسکتاپ و منوی استارت، حذف نصب از Control Panel).
- در README مسیر خروجی و دستور build برای لینوکس (deb + AppImage) هم مستند می‌شود.

## اجرا
پروژه را از صفر در `E:\Sile` می‌سازم، فازبه‌فاز پیاده‌سازی می‌کنم، در پایان build می‌گیرم و مسیر فایل EXE را به شما اعلام می‌کنم. (توجه: برای گرفتن exe باید Rust toolchain روی سیستم نصب باشد؛ اگر نصب نبود، آن را با rustup نصب می‌کنم.)